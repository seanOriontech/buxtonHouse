"""Per-apartment insights — heavy users, EOM forecast, abuse watchlist.

Builds on the shared loaders in `app/services/apartment_data.py` so the metric
math matches `/usage/apartment-report` exactly.

Statistical methodology:
  - Cohort = apartments within the same living_type.
  - Per-person normalisation = mtd_units / occupants (capped at 1 if 0).
  - EOM forecast = mtd_per_person * (days_in_month / days_elapsed) — assumes a
    constant consumption rate from today to month-end. Early-month forecasts
    are noisier (small denominator); caveat surfaced in the response.
  - Cohort statistics: median / p75 / p90 / p95 of mtd_per_person across the
    cohort. Percentile rank = (rank_among_sorted / N) * 100.
  - Flags:
      top_decile                   percentile_rank >= 90
      forecast_over_median_15x    eom_per_person > cohort_median * 1.5
      over_allowance              eom_per_person > allowance.units_per_person
                                  (only set when an allowance exists for this
                                  living_type × utility)
  - Composite risk score (used to sort the watchlist):
      score = max(rank/100 - 0.5, 0) * 2          # 0..1 above median
            + max(forecast/median - 1, 0)         # >0 if projected above median
            + max(forecast/allowance - 1, 0) * 2  # weighted higher (hard breach)
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.apartment_insights import (
    ApartmentInsight,
    CohortStats,
    CombinedWaterFlags,
    CombinedWaterInsight,
    InsightsResponse,
    UtilityFlags,
    UtilityInsight,
    WaterLimitInfo,
)
from app.models.living_type import LivingType
from app.services import apartment_data as ad
from app.services import influx as influx_svc
from sqlalchemy import select

router = APIRouter(prefix="/usage", tags=["usage"])


def _percentile(sorted_vals: Sequence[float], pct: float) -> float:
    """Linear-interpolated percentile (NumPy `linear` method). pct in 0..100."""
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (pct / 100.0) * (len(sorted_vals) - 1)
    lo = int(k)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = k - lo
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac


def _rank_percentile(value: float, sorted_vals: Sequence[float]) -> float:
    """Where does `value` sit in `sorted_vals` (ascending), as 0..100?"""
    if not sorted_vals:
        return 0.0
    # Use "max rank" so duplicates land on the high side — flags the right
    # apartments as heavy users when several share the same value.
    above = sum(1 for v in sorted_vals if v <= value)
    return (above / len(sorted_vals)) * 100.0


@router.get("/apartment-insights", response_model=InsightsResponse)
async def apartment_insights(
    living_type: str = Query("Apartment Living"),
    on: date | None = Query(None, description="Reference date (SAST). Defaults to today."),
    db: AsyncSession = Depends(get_db),
) -> InsightsResponse:
    ref_date = on or datetime.now(ad.SAST).date()
    yday = ref_date - timedelta(days=1)
    month_start = ref_date.replace(day=1)
    days_in_month = calendar.monthrange(ref_date.year, ref_date.month)[1]
    days_elapsed = max(1, (ref_date - month_start).days + 1)  # include today

    mtd_from  = ad.sast_midnight_utc(month_start)
    mtd_to    = ad.sast_midnight_utc(ref_date + timedelta(days=1))  # include today
    yday_from = ad.sast_midnight_utc(yday)
    yday_to   = ad.sast_midnight_utc(ref_date)

    apartments = await ad.load_apartments(db, living_type)
    if not apartments:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no apartments for living_type={living_type}")

    all_room_ids = [rid for info in apartments.values() for rid in info["room_ids"]]
    meters = await ad.load_meters_for_rooms(db, all_room_ids)
    meter_to_apt = ad.meter_apt_index(apartments, meters)

    meters_by_utility: dict[str, list[dict]] = {ut: [] for ut in ad.UTILITY_MAP}
    for m in meters:
        ut = m["utility_type"]
        if ut in meters_by_utility:
            meters_by_utility[ut].append(m)

    tariffs_raw = await ad.load_tariffs(db, ref_date)
    snap_date, occ_by_apt = await ad.load_occupancy(db, living_type, ref_date)

    # Combined-water limit lives directly on the living_type row now.
    lt_row = (await db.execute(
        select(LivingType).where(LivingType.name == living_type)
    )).scalar_one_or_none()
    water_daily_limit = lt_row.water_daily_litres_per_person if lt_row else None
    water_monthly_limit = water_daily_limit * days_in_month if water_daily_limit else None

    # Per-utility unit multiplier (water Influx is m³ → litres display) +
    # tariff per displayed unit.
    rates_per_display: dict[str, float] = {}
    multipliers: dict[str, float] = {}
    display_units: dict[str, str] = {}
    for ut, (_meas, display_unit, _raw_unit, is_water) in ad.UTILITY_MAP.items():
        mult = 1000.0 if is_water else 1.0
        multipliers[ut] = mult
        display_units[ut] = display_unit
        rates_per_display[ut] = tariffs_raw.get(ut, {}).get("unit_rate", 0.0) / mult

    # Apartment → meter_ids for each utility (one bucket per utility).
    apt_meters_by_utility: dict[str, dict[str, list[str]]] = {ut: {} for ut in ad.UTILITY_MAP}
    for ut, ms in meters_by_utility.items():
        for m in ms:
            apt_id = meter_to_apt.get(m["external_id"])
            if apt_id is None:
                continue
            apt_meters_by_utility[ut].setdefault(apt_id, []).append(m["external_id"])

    # 2 measurements × 2 windows = 4 Influx queries.
    measurements = {meas for (meas, _, _, _) in ad.UTILITY_MAP.values()}
    per_meter_mtd: dict[str, dict[str, float]] = {
        meas: influx_svc.consumption_by_meter(meas, mtd_from, mtd_to)
        for meas in measurements
    }
    per_meter_yday: dict[str, dict[str, float]] = {
        meas: influx_svc.consumption_by_meter(meas, yday_from, yday_to)
        for meas in measurements
    }

    # Units (in display units) per apartment per utility, for each window.
    mtd_units: dict[str, dict[str, float]] = {ut: {} for ut in ad.UTILITY_MAP}
    yday_units: dict[str, dict[str, float]] = {ut: {} for ut in ad.UTILITY_MAP}
    for ut, (meas, _du, _ru, _w) in ad.UTILITY_MAP.items():
        for apt_id, mids in apt_meters_by_utility[ut].items():
            mtd_units[ut][apt_id]  = sum(per_meter_mtd[meas].get(mid, 0.0)  for mid in mids) * multipliers[ut]
            yday_units[ut][apt_id] = sum(per_meter_yday[meas].get(mid, 0.0) for mid in mids) * multipliers[ut]

    # Per-person MTD, then cohort stats per utility.
    per_person_mtd: dict[str, dict[str, float]] = {ut: {} for ut in ad.UTILITY_MAP}
    for ut in ad.UTILITY_MAP:
        for apt_id, info in apartments.items():
            apt_no = info["apartment_number"]
            occ = max(1, occ_by_apt.get(apt_no, {}).get("occupants", 0))
            per_person_mtd[ut][apt_id] = mtd_units[ut].get(apt_id, 0.0) / occ

    cohort_stats: dict[str, CohortStats] = {}
    sorted_per_person: dict[str, list[float]] = {}
    for ut in ad.UTILITY_MAP:
        vals = sorted(per_person_mtd[ut].values())
        sorted_per_person[ut] = vals
        cohort_stats[ut] = CohortStats(
            median=_percentile(vals, 50),
            p75=_percentile(vals, 75),
            p90=_percentile(vals, 90),
            p95=_percentile(vals, 95),
        )

    # Forecast multiplier (constant-rate extrapolation)
    forecast_mult = days_in_month / days_elapsed

    insights: list[ApartmentInsight] = []
    for apt_id, info in apartments.items():
        apt_no = info["apartment_number"]
        occ = max(1, occ_by_apt.get(apt_no, {}).get("occupants", 0))
        beds = occ_by_apt.get(apt_no, {}).get("beds", 0)

        utilities_out: dict[str, UtilityInsight] = {}
        flags_summary: list[str] = []
        total_mtd_cost = 0.0
        total_eom_cost = 0.0
        risk_score = 0.0

        for ut in ad.UTILITY_MAP:
            units = mtd_units[ut].get(apt_id, 0.0)
            y_units = yday_units[ut].get(apt_id, 0.0)
            y_pp = y_units / occ
            pp = per_person_mtd[ut].get(apt_id, 0.0)
            forecast_pp = pp * forecast_mult
            forecast_units = units * forecast_mult
            rate = rates_per_display[ut]

            mtd_cost = units * rate
            eom_cost = forecast_units * rate
            cohort_med = cohort_stats[ut].median
            cohort_p90_v = cohort_stats[ut].p90

            pct_rank = _rank_percentile(pp, sorted_per_person[ut])
            top_decile = pct_rank >= 90
            forecast_over = bool(cohort_med > 0 and forecast_pp > cohort_med * 1.5)

            utilities_out[ut] = UtilityInsight(
                utility_type=ut,
                units_label=display_units[ut],
                yesterday_units=y_units,
                yesterday_units_per_person=y_pp,
                mtd_units=units,
                mtd_units_per_person=pp,
                mtd_cost=mtd_cost,
                mtd_cost_per_person=mtd_cost / occ,
                eom_forecast_units_per_person=forecast_pp,
                eom_forecast_cost=eom_cost,
                eom_forecast_cost_per_person=eom_cost / occ,
                percentile_rank=pct_rank,
                cohort_median=cohort_med,
                cohort_p90=cohort_p90_v,
                flags=UtilityFlags(
                    top_decile=top_decile,
                    forecast_over_median_15x=forecast_over,
                ),
            )

            if top_decile:    flags_summary.append(f"heavy:{ut}")
            if forecast_over: flags_summary.append(f"forecast:{ut}")

            total_mtd_cost += mtd_cost
            total_eom_cost += eom_cost

            # Composite risk score contributions (per-utility cohort signals)
            risk_score += max(pct_rank / 100.0 - 0.5, 0.0) * 2.0
            if cohort_med > 0:
                risk_score += max(forecast_pp / cohort_med - 1.0, 0.0)

        # ----- Combined water (hot + cold) vs the living-type limit -----
        water_yday_pp = (
            utilities_out["cold_water"].yesterday_units_per_person
            + utilities_out["hot_water"].yesterday_units_per_person
        )
        water_mtd_pp = (
            utilities_out["cold_water"].mtd_units_per_person
            + utilities_out["hot_water"].mtd_units_per_person
        )
        water_forecast_pp = water_mtd_pp * forecast_mult

        over_daily_water   = bool(water_daily_limit   is not None and water_yday_pp     > water_daily_limit)
        over_monthly_water = bool(water_monthly_limit is not None and water_forecast_pp > water_monthly_limit)

        if over_daily_water:   flags_summary.append("over_daily:water")
        if over_monthly_water: flags_summary.append("over_monthly:water")

        if water_daily_limit:
            risk_score += max(water_yday_pp     / water_daily_limit   - 1.0, 0.0) * 2.0
            risk_score += max(water_forecast_pp / water_monthly_limit - 1.0, 0.0) * 2.0

        insights.append(ApartmentInsight(
            apartment_number=apt_no,
            occupants=occ_by_apt.get(apt_no, {}).get("occupants", 0),
            beds=beds,
            utilities=utilities_out,
            combined_water=CombinedWaterInsight(
                yesterday_units_per_person=water_yday_pp,
                mtd_units_per_person=water_mtd_pp,
                eom_forecast_units_per_person=water_forecast_pp,
                daily_limit=water_daily_limit,
                monthly_limit=water_monthly_limit,
                flags=CombinedWaterFlags(over_daily=over_daily_water, over_monthly=over_monthly_water),
            ),
            total_mtd_cost=total_mtd_cost,
            total_eom_forecast_cost=total_eom_cost,
            risk_score=risk_score,
            flags_summary=flags_summary,
        ))

    insights.sort(key=lambda r: (-r.risk_score, r.apartment_number))

    caveats: list[str] = [
        f"Cohort N={len(insights)} — percentile rank is noisy at the tails.",
        "End-of-month forecast assumes constant rate from today to month-end.",
        f"Forecast multiplier this run: ×{forecast_mult:.2f} (days_in_month={days_in_month}, days_elapsed={days_elapsed}).",
    ]
    if days_elapsed <= 3:
        caveats.append("Days elapsed ≤ 3 — early-month forecasts have high variance.")
    if water_daily_limit is None:
        caveats.append("No combined-water daily limit set on this living type — over-water flags disabled.")
    else:
        caveats.append(
            f"Combined-water limit: {water_daily_limit:g} ℓ/p/day → "
            f"{water_monthly_limit:g} ℓ/p for this month ({days_in_month} days)."
        )

    return InsightsResponse(
        living_type=living_type,
        living_type_id=str(lt_row.id) if lt_row else None,
        report_date=ref_date,
        snapshot_date=snap_date,
        days_elapsed_mtd=days_elapsed,
        days_in_month=days_in_month,
        water_limit=WaterLimitInfo(daily=water_daily_limit, monthly=water_monthly_limit),
        cohort_stats=cohort_stats,
        apartments=insights,
        caveats=caveats,
    )
