"""Per-room daily electricity series for the Communal trends tab."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.communal_insights import (
    CommunalDailySeriesResponse,
    DailyElectricityEntry,
    RoomDailySeries,
)
from app.services import apartment_data as ad
from app.services import influx as influx_svc
from app.services import room_data as rd

router = APIRouter(prefix="/usage", tags=["usage"])

LIVING_TYPE = "Communal Living"


@router.get("/communal-daily-series", response_model=CommunalDailySeriesResponse)
async def communal_daily_series(
    days: int = Query(7, ge=2, le=120),
    on: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> CommunalDailySeriesResponse:
    today_sast = datetime.now(ad.SAST).date()
    ref_date = on or today_sast
    last_day  = ref_date - timedelta(days=1) if ref_date == today_sast else ref_date
    first_day = last_day - timedelta(days=days - 1)

    influx_from = ad.sast_midnight_utc(first_day - timedelta(days=1))
    influx_to   = ad.sast_midnight_utc(last_day + timedelta(days=1))

    rooms = await rd.load_communal_rooms(db, LIVING_TYPE)
    if not rooms:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no rooms for living_type={LIVING_TYPE}")
    room_ids = list(rooms.keys())
    meters = await ad.load_meters_for_rooms(db, room_ids, roots_only=False)
    elec_meters = [m for m in meters if m["utility_type"] == "electricity"]

    _, occ_by_room = await rd.load_occupancy_per_room(db, LIVING_TYPE, ref_date)

    room_to_meters: dict[str, list[str]] = {}
    for m in elec_meters:
        room_to_meters.setdefault(str(m["room_id"]), []).append(m["external_id"])

    daily_per_meter = influx_svc.daily_consumption_by_meter(
        "energy_meter", influx_from, influx_to,
        meter_ids=[m["external_id"] for m in elec_meters],
    )

    day_list = [first_day + timedelta(days=i) for i in range(days)]

    daily_by_room: dict[str, dict[str, float]] = {
        rid: {d.isoformat(): 0.0 for d in day_list} for rid in rooms
    }
    for rid, mids in room_to_meters.items():
        for mid in mids:
            for d_iso, val in daily_per_meter.get(mid, {}).items():
                if d_iso in daily_by_room[rid]:
                    daily_by_room[rid][d_iso] += val

    # Per-day cohort P90 across rooms (per-person electricity)
    p90_per_day: dict[str, float] = {}
    for d in day_list:
        d_iso = d.isoformat()
        vals: list[float] = []
        for rid, info in rooms.items():
            occ = max(1, occ_by_room.get(info["room_number"], {}).get("occupants", 0))
            vals.append(daily_by_room[rid][d_iso] / occ)
        vals.sort()
        if not vals:
            p90_per_day[d_iso] = 0.0
            continue
        k = 0.9 * (len(vals) - 1)
        lo = int(k); hi = min(lo + 1, len(vals) - 1)
        p90_per_day[d_iso] = vals[lo] + (vals[hi] - vals[lo]) * (k - lo)

    out_rooms: list[RoomDailySeries] = []
    for rid, info in rooms.items():
        occ_data = occ_by_room.get(info["room_number"], {})
        occ_count = occ_data.get("occupants", 0)
        occ = max(1, occ_count)

        days_out: list[DailyElectricityEntry] = []
        top_decile = 0
        for d in day_list:
            d_iso = d.isoformat()
            kwh = daily_by_room[rid][d_iso]
            kwh_pp = kwh / occ
            days_out.append(DailyElectricityEntry(date=d, kwh=kwh, kwh_per_person=kwh_pp))
            if p90_per_day[d_iso] > 0 and kwh_pp >= p90_per_day[d_iso]:
                top_decile += 1

        out_rooms.append(RoomDailySeries(
            room_id=rid,
            room_number=info["room_number"],
            name=info["name"],
            occupants=occ_count,
            days=days_out,
            days_in_top_decile=top_decile,
        ))

    out_rooms.sort(key=lambda r: r.room_number)

    return CommunalDailySeriesResponse(
        living_type=LIVING_TYPE,
        date_range=(day_list[0], day_list[-1]),
        days=days,
        rooms=out_rooms,
    )
