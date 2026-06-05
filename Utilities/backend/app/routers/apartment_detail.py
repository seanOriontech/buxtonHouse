"""Per-apartment detail dashboard — everything about ONE apartment in one shot.

Powers the click-through detail page from the Apartment Living sheet. Returns:
  - Occupancy + report-date metadata
  - Budget summary (allowance, MTD spend, % consumed, projected depletion date)
  - Per-utility cards (cold water / hot water / electricity) with opening +
    closing readings, yesterday + MTD consumption, MTD cost
  - Per-bedroom electricity sub-meter table (opening / current / MTD / today)
  - Active anomaly flags for this apartment (spike / leak / DOW)

Date support: `on` accepts a past date (SAST). Defaults to today. When given,
"closing reading" is the last reading at the END of that day (or 'now' if
on == today), and MTD = month_start → on.

Reuses the shared apartment_data + influx helpers so the math agrees with
/usage/apartment-report and /usage/apartment-insights.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.apartment_detail import (
    ApartmentDetailResponse,
    BedroomMeterRow,
    BudgetSummary,
    DetailFlag,
    UtilityCard,
)
from app.services import apartment_data as ad
from app.services import influx as influx_svc

router = APIRouter(prefix="/usage", tags=["usage"])


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


@router.get("/apartment-detail", response_model=ApartmentDetailResponse)
async def apartment_detail(
    apartment_number: int = Query(..., ge=1),
    living_type: str = Query("Apartment Living"),
    on: date | None = Query(None, description="Reference date (SAST). Defaults to today."),
    db: AsyncSession = Depends(get_db),
) -> ApartmentDetailResponse:
    today_sast = datetime.now(ad.SAST).date()
    ref_date = on or today_sast
    yday = ref_date - timedelta(days=1)
    month_start = ref_date.replace(day=1)
    days_in_month = calendar.monthrange(ref_date.year, ref_date.month)[1]
    days_elapsed = max(1, (ref_date - month_start).days + 1)

    # Influx window endpoints (UTC)
    month_from = ad.sast_midnight_utc(month_start)
    # "Closing reading" boundary: end of `ref_date` SAST, or 'now' if today
    if ref_date >= today_sast:
        closing_to = datetime.now(ad.UTC)
    else:
        closing_to = ad.sast_midnight_utc(ref_date + timedelta(days=1))
    yday_from = ad.sast_midnight_utc(yday)
    yday_to   = ad.sast_midnight_utc(ref_date)
    today_from = ad.sast_midnight_utc(ref_date)

    # Resolve apartment
    apartments = await ad.load_apartments(db, living_type)
    apt = next(
        ((apt_id, info) for apt_id, info in apartments.items() if info["apartment_number"] == apartment_number),
        None,
    )
    if apt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"apartment {apartment_number} not found")
    apt_id, info = apt

    # Root meters power the per-utility cards (parent_meter_id IS NULL avoids
    # double counting on apartments with bedroom sub-meters).
    roots_only_meters = await ad.load_meters_for_rooms(db, info["room_ids"], roots_only=True)
    roots_by_util: dict[str, list[str]] = {ut: [] for ut in ad.UTILITY_MAP}
    for m in roots_only_meters:
        ut = m["utility_type"]
        if ut in roots_by_util:
            roots_by_util[ut].append(m["external_id"])

    tariffs_raw = await ad.load_tariffs(db, ref_date)
    snap_date, occ_by_apt = await ad.load_occupancy(db, living_type, ref_date)
    occ = occ_by_apt.get(apartment_number, {"occupants": 0, "beds": 0})

    # --- Per-utility cards ---------------------------------------------------
    utilities: dict[str, UtilityCard] = {}
    mtd_cost_total = 0.0
    # Pre-fetch consumption per measurement (cold+hot share water_data)
    measurements = {m for (m, _, _, _) in ad.UTILITY_MAP.values()}
    mtd_by_meter: dict[str, dict[str, float]] = {}
    yday_by_meter: dict[str, dict[str, float]] = {}
    endpoints_by_meter: dict[str, dict[str, dict[str, float]]] = {}
    for meas in measurements:
        all_ids_for_meas = [m["external_id"] for m in roots_only_meters
                            if ad.UTILITY_MAP[m["utility_type"]][0] == meas]
        if not all_ids_for_meas:
            continue
        mtd_by_meter[meas] = influx_svc.consumption_by_meter(meas, month_from, closing_to)
        yday_by_meter[meas] = influx_svc.consumption_by_meter(meas, yday_from, yday_to)
        endpoints_by_meter[meas] = influx_svc.meter_endpoints(meas, month_from, closing_to, meter_ids=all_ids_for_meas)

    for ut, (meas, display_unit, _raw_unit, is_water) in ad.UTILITY_MAP.items():
        mult = 1000.0 if is_water else 1.0
        raw_rate = tariffs_raw.get(ut, {}).get("unit_rate", 0.0)
        rate_per_display = raw_rate / mult
        ids = roots_by_util[ut]
        mtd_units = sum(mtd_by_meter.get(meas, {}).get(mid, 0.0) for mid in ids) * mult
        yday_units = sum(yday_by_meter.get(meas, {}).get(mid, 0.0) for mid in ids) * mult
        mtd_cost = mtd_units * rate_per_display
        # Opening / closing — sum across this apartment's root meters for the utility
        ep = endpoints_by_meter.get(meas, {})
        opening = None
        closing = None
        if ids:
            firsts = [ep[mid]["first"] for mid in ids if mid in ep]
            lasts  = [ep[mid]["last"]  for mid in ids if mid in ep]
            opening = sum(firsts) * mult if firsts else None
            closing = sum(lasts)  * mult if lasts  else None
        utilities[ut] = UtilityCard(
            utility_type=ut,
            units_label=display_unit,
            cost_per_unit=rate_per_display,
            opening_reading=opening,
            closing_reading=closing,
            yesterday_units=yday_units,
            mtd_units=mtd_units,
            mtd_cost=mtd_cost,
        )
        mtd_cost_total += mtd_cost

    # --- Budget summary ------------------------------------------------------
    monthly_pp = await _accommodation_rate(db, living_type, ref_date) or 0.0
    monthly_allowance = monthly_pp * occ["occupants"]
    eom_forecast = (mtd_cost_total / days_elapsed) * days_in_month
    pct = (mtd_cost_total / monthly_allowance * 100.0) if monthly_allowance > 0 else 0.0
    already_over = monthly_allowance > 0 and mtd_cost_total > monthly_allowance
    forecast_over = monthly_allowance > 0 and not already_over and eom_forecast > monthly_allowance
    occ_safe = max(1, occ["occupants"])

    budget = BudgetSummary(
        accommodation_rate_per_person_per_month=monthly_pp if monthly_pp > 0 else None,
        monthly_allowance_total=monthly_allowance,
        monthly_allowance_per_person=monthly_pp,
        mtd_cost_total=mtd_cost_total,
        mtd_cost_per_person=mtd_cost_total / occ_safe,
        pct_consumed=pct,
        projected_eom_cost=eom_forecast,
        projected_eom_cost_per_person=eom_forecast / occ_safe,
        projected_depletion_date=_predict_depletion_date(
            mtd_cost_total, monthly_allowance, days_elapsed, days_in_month, ref_date,
        ),
        already_over=already_over,
        forecast_over=forecast_over,
    )

    # --- Bedroom sub-meter table (electricity only) --------------------------
    sub_rows = (await db.execute(text("""
        SELECT m.external_id, m.room_id, r.name AS room_name, r.number AS room_number
        FROM meters m
        JOIN rooms  r ON r.id = m.room_id
        WHERE r.parent_room_id = CAST(:apt_id AS uuid)
          AND m.utility_type = 'electricity'
        ORDER BY r.number
    """), {"apt_id": apt_id})).mappings().all()
    sub_ids = [r["external_id"] for r in sub_rows]

    elec_mtd = influx_svc.consumption_by_meter("energy_meter", month_from, closing_to) if sub_ids else {}
    elec_today = influx_svc.consumption_by_meter("energy_meter", today_from, closing_to) if sub_ids else {}
    elec_endpoints = influx_svc.meter_endpoints("energy_meter", month_from, closing_to, meter_ids=sub_ids) if sub_ids else {}
    elec_rate = tariffs_raw.get("electricity", {}).get("unit_rate", 0.0)

    mtd_total = sum(elec_mtd.get(ext, 0.0) for ext in sub_ids)
    today_total = sum(elec_today.get(ext, 0.0) for ext in sub_ids)

    bedrooms: list[BedroomMeterRow] = []
    for r in sub_rows:
        ext = r["external_id"]
        mtd_kwh = elec_mtd.get(ext, 0.0)
        today_kwh = elec_today.get(ext, 0.0)
        ep = elec_endpoints.get(ext, {"first": 0.0, "last": 0.0})
        bedrooms.append(BedroomMeterRow(
            room_id=str(r["room_id"]),
            room_number=r["room_number"],
            room_name=r["room_name"],
            external_id=ext,
            opening_reading=ep["first"],
            current_reading=ep["last"],
            mtd_kwh=mtd_kwh,
            mtd_cost=mtd_kwh * elec_rate,
            mtd_pct=(mtd_kwh / mtd_total * 100.0) if mtd_total > 0 else 0.0,
            today_kwh=today_kwh,
            today_cost=today_kwh * elec_rate,
            today_pct=(today_kwh / today_total * 100.0) if today_total > 0 else 0.0,
        ))

    # --- Flags ---------------------------------------------------------------
    # Lightweight heuristics from the figures we already have. Heavy anomaly
    # detection (spike / leak / DOW) remains on /usage/apartment-anomalies and
    # is queried separately by the frontend if a richer banner is wanted.
    flags: list[DetailFlag] = []
    if already_over:
        flags.append(DetailFlag(
            code="budget:over",
            severity="red",
            description=f"Already over monthly allowance — MTD R{mtd_cost_total:.0f} > cap R{monthly_allowance:.0f}",
        ))
    elif forecast_over:
        flags.append(DetailFlag(
            code="budget:forecast_over",
            severity="amber",
            description=f"Projected EOM R{eom_forecast:.0f} > cap R{monthly_allowance:.0f}",
        ))
    if budget.projected_depletion_date and not already_over:
        flags.append(DetailFlag(
            code="budget:depletion",
            severity="amber",
            description=f"Allowance projected to run out on {budget.projected_depletion_date}",
        ))

    return ApartmentDetailResponse(
        apartment_number=apartment_number,
        living_type=living_type,
        report_date=ref_date,
        days_in_month=days_in_month,
        days_elapsed_mtd=days_elapsed,
        occupants=occ["occupants"],
        beds=occ["beds"],
        snapshot_date=snap_date,
        budget=budget,
        utilities=utilities,
        bedrooms=bedrooms,
        flags=flags,
    )

