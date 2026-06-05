"""Per-apartment daily consumption history — for trends charts.

For each apartment in the living type, produces a list of daily entries (total
+ per-person) over the requested window, plus two simple consistency stats:

  - days_over_water_limit:           combined_water_pp > water_daily_limit
  - days_in_top_decile_electricity:  apartment ranked at the 90th percentile or
                                     higher in electricity per-person on that day

The Influx work is two Flux queries (one per measurement) using
`aggregateWindow(1d, last) |> difference(nonNegative: true)` — fast.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.living_type import LivingType
from app.schemas.daily_series import (
    ApartmentDailySeries,
    DailyEntry,
    DailyEntryPerPerson,
    DailySeriesResponse,
)
from app.services import apartment_data as ad
from app.services import influx as influx_svc

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/apartment-daily-series", response_model=DailySeriesResponse)
async def apartment_daily_series(
    living_type: str = Query("Apartment Living"),
    days: int = Query(7, ge=2, le=120),
    on: date | None = Query(None, description="Reference date (SAST). Defaults to today."),
    db: AsyncSession = Depends(get_db),
) -> DailySeriesResponse:
    today_sast = datetime.now(ad.SAST).date()
    ref_date = on or today_sast
    # If ref_date is today, today is incomplete — end the window at yesterday.
    last_day  = ref_date - timedelta(days=1) if ref_date == today_sast else ref_date
    first_day = last_day - timedelta(days=days - 1)

    # One extra day before so difference() captures the first day in-range.
    influx_from = ad.sast_midnight_utc(first_day - timedelta(days=1))
    influx_to   = ad.sast_midnight_utc(last_day + timedelta(days=1))

    apartments = await ad.load_apartments(db, living_type)
    if not apartments:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no apartments for living_type={living_type}")

    all_room_ids = [rid for info in apartments.values() for rid in info["room_ids"]]
    meters = await ad.load_meters_for_rooms(db, all_room_ids)
    meter_to_apt = ad.meter_apt_index(apartments, meters)

    _, occ_by_apt = await ad.load_occupancy(db, living_type, ref_date)

    lt_row = (await db.execute(
        select(LivingType).where(LivingType.name == living_type)
    )).scalar_one_or_none()
    water_daily_limit = lt_row.water_daily_litres_per_person if lt_row else None

    # Apartment → meter ids per utility
    apt_meters_by_utility: dict[str, dict[str, list[str]]] = {ut: {} for ut in ad.UTILITY_MAP}
    for m in meters:
        ut = m["utility_type"]
        if ut not in apt_meters_by_utility:
            continue
        apt_id = meter_to_apt.get(m["external_id"])
        if apt_id is None:
            continue
        apt_meters_by_utility[ut].setdefault(apt_id, []).append(m["external_id"])

    water_meter_ids  = [m["external_id"] for m in meters if m["utility_type"] in ("cold_water", "hot_water")]
    energy_meter_ids = [m["external_id"] for m in meters if m["utility_type"] == "electricity"]
    daily_water_per_meter  = influx_svc.daily_consumption_by_meter(
        "water_data",   influx_from, influx_to, meter_ids=water_meter_ids,
    )
    daily_energy_per_meter = influx_svc.daily_consumption_by_meter(
        "energy_meter", influx_from, influx_to, meter_ids=energy_meter_ids,
    )

    day_list = [first_day + timedelta(days=i) for i in range(days)]

    daily_by_apt: dict[str, dict[str, dict[str, float]]] = {
        apt_id: {d.isoformat(): {"cold_water": 0.0, "hot_water": 0.0, "electricity": 0.0}
                 for d in day_list}
        for apt_id in apartments
    }

    for ut, (meas, _du, _ru, is_water) in ad.UTILITY_MAP.items():
        mult = 1000.0 if is_water else 1.0
        src = daily_water_per_meter if meas == "water_data" else daily_energy_per_meter
        for apt_id, mids in apt_meters_by_utility[ut].items():
            for mid in mids:
                meter_days = src.get(mid, {})
                for d_iso, val in meter_days.items():
                    if d_iso in daily_by_apt[apt_id]:
                        daily_by_apt[apt_id][d_iso][ut] += val * mult

    # Per-day electricity P90 across the cohort (for top-decile flag).
    electricity_p90_per_day: dict[str, float] = {}
    for d in day_list:
        d_iso = d.isoformat()
        vals: list[float] = []
        for apt_id, info in apartments.items():
            apt_no = info["apartment_number"]
            occ = max(1, occ_by_apt.get(apt_no, {}).get("occupants", 0))
            vals.append(daily_by_apt[apt_id][d_iso]["electricity"] / occ)
        vals.sort()
        if not vals:
            electricity_p90_per_day[d_iso] = 0.0
            continue
        k = 0.9 * (len(vals) - 1)
        lo = int(k); hi = min(lo + 1, len(vals) - 1)
        electricity_p90_per_day[d_iso] = vals[lo] + (vals[hi] - vals[lo]) * (k - lo)

    out_apartments: list[ApartmentDailySeries] = []
    for apt_id, info in apartments.items():
        apt_no = info["apartment_number"]
        occ = max(1, occ_by_apt.get(apt_no, {}).get("occupants", 0))

        days_total: list[DailyEntry] = []
        days_per_person: list[DailyEntryPerPerson] = []
        over_water_count = 0
        top_decile_count = 0

        for d in day_list:
            d_iso = d.isoformat()
            bucket = daily_by_apt[apt_id][d_iso]
            cold = bucket["cold_water"]
            hot = bucket["hot_water"]
            combined = cold + hot
            elec = bucket["electricity"]

            days_total.append(DailyEntry(
                date=d,
                cold_water_litres=cold,
                hot_water_litres=hot,
                combined_water_litres=combined,
                electricity_kwh=elec,
            ))
            days_per_person.append(DailyEntryPerPerson(
                date=d,
                cold_water_litres_pp=cold / occ,
                hot_water_litres_pp=hot / occ,
                combined_water_litres_pp=combined / occ,
                electricity_kwh_pp=elec / occ,
            ))

            if water_daily_limit is not None and (combined / occ) > water_daily_limit:
                over_water_count += 1
            if electricity_p90_per_day[d_iso] > 0 and (elec / occ) >= electricity_p90_per_day[d_iso]:
                top_decile_count += 1

        out_apartments.append(ApartmentDailySeries(
            apartment_number=apt_no,
            occupants=occ_by_apt.get(apt_no, {}).get("occupants", 0),
            days_total=days_total,
            days_per_person=days_per_person,
            days_over_water_limit=over_water_count,
            days_in_top_decile_electricity=top_decile_count,
        ))

    out_apartments.sort(key=lambda a: a.apartment_number)

    return DailySeriesResponse(
        living_type=living_type,
        date_range=(day_list[0], day_list[-1]),
        days=days,
        water_daily_limit=water_daily_limit,
        apartments=out_apartments,
    )
