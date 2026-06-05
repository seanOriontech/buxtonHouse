"""Per-room detail dashboard for Communal Living.

Mirrors `/usage/apartment-detail` but for a single communal room. Electricity
only (no per-room water meters in Communal Living). Returns:
  - occupancy + report-date metadata
  - budget summary (allowance, MTD spend, % consumed, projected depletion)
  - electricity card with opening + closing readings, yesterday + MTD kWh, cost
  - any active budget flags

Date support: `on` accepts a past SAST date. Defaults to today. When given,
"closing reading" is the last reading at the END of that day.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.communal_detail import (
    CommunalRoomBudget,
    CommunalRoomDetailResponse,
    CommunalRoomFlag,
    ElectricityCard,
)
from app.services import apartment_data as ad
from app.services import influx as influx_svc
from app.services import room_data as rd

router = APIRouter(prefix="/usage", tags=["usage"])

LIVING_TYPE = "Communal Living"


async def _accommodation_rate(db: AsyncSession, living_type: str, on: date) -> float | None:
    row = (await db.execute(text("""
        SELECT t.unit_rate
        FROM tariffs t
        JOIN living_types lt ON lt.id = t.living_type_id
        WHERE lt.name = :lt
          AND t.utility_type IS NULL
          AND t.starts_at <= :d
          AND (t.ends_at IS NULL OR t.ends_at >= :d)
        ORDER BY t.starts_at DESC
        LIMIT 1
    """), {"lt": living_type, "d": on})).scalar_one_or_none()
    return float(row) if row is not None else None


def _predict_depletion_date(
    mtd_cost: float,
    monthly_allowance: float,
    days_elapsed: int,
    days_in_month: int,
    today: date,
) -> date | None:
    if mtd_cost >= monthly_allowance or monthly_allowance <= 0:
        return None
    daily_rate = mtd_cost / max(1, days_elapsed)
    if daily_rate <= 0:
        return None
    remaining = monthly_allowance - mtd_cost
    days_until = remaining / daily_rate
    days_remaining = days_in_month - days_elapsed
    if days_until > days_remaining:
        return None
    return today + timedelta(days=int(days_until) + 1)


@router.get("/communal-room-detail", response_model=CommunalRoomDetailResponse)
async def communal_room_detail(
    room_id: str = Query(..., description="Communal room UUID"),
    on: date | None = Query(None, description="Reference date (SAST). Defaults to today."),
    db: AsyncSession = Depends(get_db),
) -> CommunalRoomDetailResponse:
    today_sast = datetime.now(ad.SAST).date()
    ref_date = on or today_sast
    yday = ref_date - timedelta(days=1)
    month_start = ref_date.replace(day=1)
    days_in_month = calendar.monthrange(ref_date.year, ref_date.month)[1]
    days_elapsed = max(1, (ref_date - month_start).days + 1)

    # Influx window endpoints (UTC)
    month_from = ad.sast_midnight_utc(month_start)
    if ref_date >= today_sast:
        closing_to = datetime.now(ad.UTC)
    else:
        closing_to = ad.sast_midnight_utc(ref_date + timedelta(days=1))
    yday_from = ad.sast_midnight_utc(yday)
    yday_to   = ad.sast_midnight_utc(ref_date)

    # Resolve room
    rooms = await rd.load_communal_rooms(db, LIVING_TYPE)
    info = rooms.get(room_id)
    if info is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"communal room {room_id} not found")

    # Meters — include all (parent + child) since communal Comm_* sub-meters
    # all point at Comm_9 and we want the full room consumption.
    meters = await ad.load_meters_for_rooms(db, [room_id], roots_only=False)
    elec_meters = [m for m in meters if m["utility_type"] == "electricity"]
    elec_ids = [m["external_id"] for m in elec_meters]

    tariffs_raw = await ad.load_tariffs(db, ref_date)
    elec_rate = tariffs_raw.get("electricity", {}).get("unit_rate", 0.0)
    _, occ_by_room = await rd.load_occupancy_per_room(db, LIVING_TYPE, ref_date)
    occ_data = occ_by_room.get(info["room_number"], {"occupants": 0, "beds": 0})

    # Snapshot date for header
    snap_date = (await db.execute(text("""
        SELECT MAX(snapshot_date) FROM occupancy_snapshots
        WHERE living_type = :lt AND snapshot_date <= :d
    """), {"lt": LIVING_TYPE, "d": ref_date})).scalar_one_or_none()

    # --- Electricity card ---------------------------------------------------
    if elec_ids:
        mtd_per_meter = influx_svc.consumption_by_meter("energy_meter", month_from, closing_to)
        yday_per_meter = influx_svc.consumption_by_meter("energy_meter", yday_from, yday_to)
        endpoints = influx_svc.meter_endpoints("energy_meter", month_from, closing_to, meter_ids=elec_ids)
        mtd_kwh = sum(mtd_per_meter.get(mid, 0.0) for mid in elec_ids)
        yday_kwh = sum(yday_per_meter.get(mid, 0.0) for mid in elec_ids)
        opening = sum(endpoints[mid]["first"] for mid in elec_ids if mid in endpoints) if endpoints else None
        closing = sum(endpoints[mid]["last"]  for mid in elec_ids if mid in endpoints) if endpoints else None
    else:
        mtd_kwh = yday_kwh = 0.0
        opening = closing = None

    mtd_cost = mtd_kwh * elec_rate
    electricity = ElectricityCard(
        cost_per_kwh=elec_rate,
        opening_reading=opening,
        closing_reading=closing,
        yesterday_kwh=yday_kwh,
        mtd_kwh=mtd_kwh,
        mtd_cost=mtd_cost,
    )

    # --- Budget summary -----------------------------------------------------
    monthly_pp = await _accommodation_rate(db, LIVING_TYPE, ref_date) or 0.0
    monthly_allowance = monthly_pp * occ_data["occupants"]
    eom_forecast = (mtd_cost / days_elapsed) * days_in_month
    pct = (mtd_cost / monthly_allowance * 100.0) if monthly_allowance > 0 else 0.0
    already_over = monthly_allowance > 0 and mtd_cost > monthly_allowance
    forecast_over = monthly_allowance > 0 and not already_over and eom_forecast > monthly_allowance
    occ_safe = max(1, occ_data["occupants"])

    budget = CommunalRoomBudget(
        accommodation_rate_per_person_per_month=monthly_pp if monthly_pp > 0 else None,
        monthly_allowance_total=monthly_allowance,
        monthly_allowance_per_person=monthly_pp,
        mtd_cost_total=mtd_cost,
        mtd_cost_per_person=mtd_cost / occ_safe,
        pct_consumed=pct,
        projected_eom_cost=eom_forecast,
        projected_eom_cost_per_person=eom_forecast / occ_safe,
        projected_depletion_date=_predict_depletion_date(
            mtd_cost, monthly_allowance, days_elapsed, days_in_month, ref_date,
        ),
        already_over=already_over,
        forecast_over=forecast_over,
    )

    # --- Flags --------------------------------------------------------------
    flags: list[CommunalRoomFlag] = []
    if already_over:
        flags.append(CommunalRoomFlag(
            code="budget:over",
            severity="red",
            description=f"Already over monthly allowance — MTD R{mtd_cost:.0f} > cap R{monthly_allowance:.0f}",
        ))
    elif forecast_over:
        flags.append(CommunalRoomFlag(
            code="budget:forecast_over",
            severity="amber",
            description=f"Projected EOM R{eom_forecast:.0f} > cap R{monthly_allowance:.0f}",
        ))
    if budget.projected_depletion_date and not already_over:
        flags.append(CommunalRoomFlag(
            code="budget:depletion",
            severity="amber",
            description=f"Allowance projected to run out on {budget.projected_depletion_date}",
        ))

    return CommunalRoomDetailResponse(
        room_id=room_id,
        room_number=info["room_number"],
        room_name=info["name"],
        room_type=info["room_type"],
        living_type=LIVING_TYPE,
        report_date=ref_date,
        days_in_month=days_in_month,
        days_elapsed_mtd=days_elapsed,
        occupants=occ_data["occupants"],
        beds=occ_data["beds"],
        snapshot_date=snap_date,
        budget=budget,
        electricity=electricity,
        flags=flags,
    )
