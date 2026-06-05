"""Per-room electricity insights for Communal Living.

Same statistical pattern as apartment_insights, but the cohort is the 36
rooms inside Communal Living and the only utility tracked is electricity.
No allowance caps — just heavy-user / forecast flagging.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.communal_insights import (
    CohortStats,
    CommunalInsightsResponse,
    ElectricityFlags,
    ElectricityStats,
    RoomInsight,
)
from app.services import apartment_data as ad   # for sast_midnight_utc, load_meters_for_rooms, load_tariffs
from app.services import influx as influx_svc
from app.services import room_data as rd

router = APIRouter(prefix="/usage", tags=["usage"])

LIVING_TYPE = "Communal Living"


def _percentile(sorted_vals: Sequence[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (pct / 100.0) * (len(sorted_vals) - 1)
    lo = int(k); hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def _rank_percentile(value: float, sorted_vals: Sequence[float]) -> float:
    if not sorted_vals:
        return 0.0
    above = sum(1 for v in sorted_vals if v <= value)
    return (above / len(sorted_vals)) * 100.0


@router.get("/communal-room-insights", response_model=CommunalInsightsResponse)
async def communal_room_insights(
    on: date | None = Query(None, description="Reference date (SAST). Defaults to today."),
    db: AsyncSession = Depends(get_db),
) -> CommunalInsightsResponse:
    ref_date = on or datetime.now(ad.SAST).date()
    yday = ref_date - timedelta(days=1)
    month_start = ref_date.replace(day=1)
    days_in_month = calendar.monthrange(ref_date.year, ref_date.month)[1]
    days_elapsed = max(1, (ref_date - month_start).days + 1)

    mtd_from  = ad.sast_midnight_utc(month_start)
    mtd_to    = ad.sast_midnight_utc(ref_date + timedelta(days=1))
    yday_from = ad.sast_midnight_utc(yday)
    yday_to   = ad.sast_midnight_utc(ref_date)

    rooms = await rd.load_communal_rooms(db, LIVING_TYPE)
    if not rooms:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no rooms for living_type={LIVING_TYPE}")

    room_ids = list(rooms.keys())
    meters = await ad.load_meters_for_rooms(db, room_ids, roots_only=False)
    elec_meters = [m for m in meters if m["utility_type"] == "electricity"]

    snap_date, occ_by_room = await rd.load_occupancy_per_room(db, LIVING_TYPE, ref_date)
    tariffs_raw = await ad.load_tariffs(db, ref_date)
    elec_rate = tariffs_raw.get("electricity", {}).get("unit_rate", 0.0)

    # room_id → list of electricity meter external_ids
    room_to_elec_meters: dict[str, list[str]] = {}
    for m in elec_meters:
        room_to_elec_meters.setdefault(str(m["room_id"]), []).append(m["external_id"])

    # 2 Influx queries (yesterday + MTD) filtered to communal electricity meters
    elec_meter_ids = [m["external_id"] for m in elec_meters]
    per_meter_yday = influx_svc.consumption_by_meter("energy_meter", yday_from, yday_to)
    per_meter_mtd  = influx_svc.consumption_by_meter("energy_meter", mtd_from,  mtd_to)
    # Restrict to communal electricity meters
    yday_units = {rid: sum(per_meter_yday.get(mid, 0.0) for mid in mids)
                  for rid, mids in room_to_elec_meters.items()}
    mtd_units  = {rid: sum(per_meter_mtd.get(mid, 0.0)  for mid in mids)
                  for rid, mids in room_to_elec_meters.items()}

    # Per-person MTD, cohort stats
    per_person_mtd: dict[str, float] = {}
    for rid, info in rooms.items():
        occ = max(1, occ_by_room.get(info["room_number"], {}).get("occupants", 0))
        per_person_mtd[rid] = mtd_units.get(rid, 0.0) / occ

    vals_sorted = sorted(per_person_mtd.values())
    cohort = CohortStats(
        median=_percentile(vals_sorted, 50),
        p75=_percentile(vals_sorted, 75),
        p90=_percentile(vals_sorted, 90),
        p95=_percentile(vals_sorted, 95),
    )

    forecast_mult = days_in_month / days_elapsed

    insights: list[RoomInsight] = []
    for rid, info in rooms.items():
        occ_data = occ_by_room.get(info["room_number"], {})
        occ_count = occ_data.get("occupants", 0)
        occ = max(1, occ_count)
        beds = occ_data.get("beds", info["beds"] or 0)

        units = mtd_units.get(rid, 0.0)
        y_units = yday_units.get(rid, 0.0)
        pp = per_person_mtd.get(rid, 0.0)
        forecast_pp = pp * forecast_mult
        forecast_units = units * forecast_mult

        mtd_cost = units * elec_rate
        eom_cost = forecast_units * elec_rate

        pct_rank = _rank_percentile(pp, vals_sorted)
        top_decile = pct_rank >= 90
        forecast_over = bool(cohort.median > 0 and forecast_pp > cohort.median * 1.5)

        elec = ElectricityStats(
            yesterday_kwh=y_units,
            yesterday_kwh_per_person=y_units / occ,
            mtd_kwh=units,
            mtd_kwh_per_person=pp,
            mtd_cost=mtd_cost,
            mtd_cost_per_person=mtd_cost / occ,
            eom_forecast_kwh_per_person=forecast_pp,
            eom_forecast_cost=eom_cost,
            eom_forecast_cost_per_person=eom_cost / occ,
            percentile_rank=pct_rank,
            cohort_median=cohort.median,
            cohort_p90=cohort.p90,
            flags=ElectricityFlags(top_decile=top_decile, forecast_over_median_15x=forecast_over),
        )

        flags: list[str] = []
        if top_decile:    flags.append("heavy:electricity")
        if forecast_over: flags.append("forecast:electricity")

        # Composite risk score (electricity-only)
        risk = max(pct_rank / 100.0 - 0.5, 0.0) * 2.0
        if cohort.median > 0:
            risk += max(forecast_pp / cohort.median - 1.0, 0.0)

        insights.append(RoomInsight(
            room_id=rid,
            room_number=info["room_number"],
            name=info["name"],
            room_type=info["room_type"],
            occupants=occ_count,
            beds=beds,
            electricity=elec,
            risk_score=risk,
            flags_summary=flags,
        ))

    insights.sort(key=lambda r: (-r.risk_score, r.room_number))

    caveats = [
        f"Cohort N={len(insights)} rooms — percentile rank is noisy at the tails.",
        "EOM forecast assumes constant rate from today to month-end.",
        f"Forecast multiplier: ×{forecast_mult:.2f} (days_in_month={days_in_month}, days_elapsed={days_elapsed}).",
    ]
    if days_elapsed <= 3:
        caveats.append("Days elapsed ≤ 3 — early-month forecasts have high variance.")

    return CommunalInsightsResponse(
        living_type=LIVING_TYPE,
        report_date=ref_date,
        snapshot_date=snap_date,
        days_elapsed_mtd=days_elapsed,
        days_in_month=days_in_month,
        cohort_stats=cohort,
        rooms=insights,
        caveats=caveats,
    )
