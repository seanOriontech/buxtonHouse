"""Per-apartment utility report — on-the-fly aggregation.

For each apartment in the requested living type:
  1. Find all root meters (parent_meter_id IS NULL) attached either to the
     apartment itself or to any of its child rooms.
  2. Sum Influx readings per meter over two windows: "yesterday" and
     "month-to-date" (SAST clock).
  3. Group those sums into apartment × utility totals.
  4. Multiply by the active tariff for the report date.
  5. Read occupancy from `occupancy_snapshots` (latest day on/before report).

Shared data-loading helpers live in `app/services/apartment_data.py` so the
sibling `apartment_insights` endpoint can reuse them without drift.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.apartment_report import (
    ApartmentReportResponse,
    ApartmentRow,
    ApartmentUtility,
    TariffInfo,
    UtilityPeriod,
)
from app.services import apartment_data as ad

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/apartment-report", response_model=ApartmentReportResponse)
async def apartment_report(
    living_type: str = Query(...),
    on: date | None = Query(None, description="Reference date (SAST). Defaults to today."),
    db: AsyncSession = Depends(get_db),
) -> ApartmentReportResponse:
    ref_date = on or datetime.now(ad.SAST).date()
    yday = ref_date - timedelta(days=1)
    month_start = ref_date.replace(day=1)
    days_elapsed = max(1, (ref_date - month_start).days)  # avoid div by zero on day 1

    yday_from = ad.sast_midnight_utc(yday)
    yday_to   = ad.sast_midnight_utc(ref_date)
    mtd_from  = ad.sast_midnight_utc(month_start)
    mtd_to    = ad.sast_midnight_utc(ref_date)

    apartments = await ad.load_apartments(db, living_type)
    if not apartments:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no apartments for living_type={living_type}")

    all_room_ids = [rid for info in apartments.values() for rid in info["room_ids"]]
    meters = await ad.load_meters_for_rooms(db, all_room_ids)
    meter_to_apt = ad.meter_apt_index(apartments, meters)

    # Bucket meters by utility
    meters_by_utility: dict[str, list[dict]] = {ut: [] for ut in ad.UTILITY_MAP}
    for m in meters:
        ut = m["utility_type"]
        if ut in meters_by_utility:
            meters_by_utility[ut].append(m)

    tariffs_raw = await ad.load_tariffs(db, ref_date)
    snap_date, occ_by_apt = await ad.load_occupancy(db, living_type, ref_date)

    # Normalise tariff per displayed unit (water Influx is m³, displayed as litres)
    tariffs_info: dict[str, TariffInfo] = {}
    multipliers: dict[str, float] = {}
    for ut, (_meas, display_unit, raw_unit, is_water) in ad.UTILITY_MAP.items():
        raw_rate = tariffs_raw.get(ut, {}).get("unit_rate", 0.0)
        mult = 1000.0 if is_water else 1.0
        multipliers[ut] = mult
        tariffs_info[ut] = TariffInfo(
            utility_type=ut,
            rate_per_unit=raw_rate / mult,
            raw_rate=raw_rate,
            raw_unit=raw_unit,
            display_unit=display_unit,
        )

    # Pre-build apartment → meter_ids for each utility for batched Influx aggregation
    apt_meters_by_utility: dict[str, dict[str, list[str]]] = {ut: {} for ut in ad.UTILITY_MAP}
    for ut, ms in meters_by_utility.items():
        for m in ms:
            apt_id = meter_to_apt.get(m["external_id"])
            if apt_id is None:
                continue
            apt_meters_by_utility[ut].setdefault(apt_id, []).append(m["external_id"])

    # 2 measurements × 2 windows = 4 Influx queries total
    measurements = {meas for (meas, _, _, _) in ad.UTILITY_MAP.values()}
    raw_yday: dict[str, dict[str, float]] = {}
    raw_mtd:  dict[str, dict[str, float]] = {}
    for meas in measurements:
        # Aggregate once per meter then attribute per apartment for each utility that shares this measurement
        per_meter_y = {}
        per_meter_m = {}
        from app.services import influx as influx_svc
        per_meter_y = influx_svc.consumption_by_meter(meas, yday_from, yday_to)
        per_meter_m = influx_svc.consumption_by_meter(meas, mtd_from, mtd_to)
        for ut, (m, _, _, _) in ad.UTILITY_MAP.items():
            if m != meas:
                continue
            raw_yday[ut] = {
                apt: sum(per_meter_y.get(mid, 0.0) for mid in mids)
                for apt, mids in apt_meters_by_utility[ut].items()
            }
            raw_mtd[ut] = {
                apt: sum(per_meter_m.get(mid, 0.0) for mid in mids)
                for apt, mids in apt_meters_by_utility[ut].items()
            }

    rows_out: list[ApartmentRow] = []
    for apt_id, info in apartments.items():
        apt_no = info["apartment_number"]
        occ = occ_by_apt.get(apt_no, {"occupants": 0, "beds": 0})

        utilities: dict[str, ApartmentUtility] = {}
        tot_yday = tot_mtd = 0.0

        for ut in ad.UTILITY_MAP:
            rate = tariffs_info[ut].rate_per_unit
            mult = multipliers[ut]
            units_y = raw_yday.get(ut, {}).get(apt_id, 0.0) * mult
            units_m = raw_mtd.get(ut, {}).get(apt_id, 0.0) * mult
            avg_units = units_m / days_elapsed
            cost_y = units_y * rate
            cost_m = units_m * rate
            avg_cost = avg_units * rate

            utilities[ut] = ApartmentUtility(
                utility_type=ut,
                units_label=tariffs_info[ut].display_unit,
                yesterday=UtilityPeriod(units=units_y, cost=cost_y),
                mtd=UtilityPeriod(units=units_m, cost=cost_m),
                avg_per_day=UtilityPeriod(units=avg_units, cost=avg_cost),
            )
            tot_yday += cost_y
            tot_mtd += cost_m

        rows_out.append(ApartmentRow(
            apartment_number=apt_no,
            occupants=occ["occupants"],
            beds=occ["beds"],
            utilities=utilities,
            total_cost_yesterday=tot_yday,
            total_cost_mtd=tot_mtd,
            total_cost_avg_per_day=tot_mtd / days_elapsed,
        ))

    rows_out.sort(key=lambda r: r.apartment_number)

    return ApartmentReportResponse(
        living_type=living_type,
        report_date=ref_date,
        snapshot_date=snap_date,
        days_elapsed_mtd=days_elapsed,
        tariffs=tariffs_info,
        apartments=rows_out,
    )
