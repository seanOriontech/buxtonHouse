"""Staff quarters consumption — small siblings of the apartment report.

Staff rooms live under `room_types` with `name='Staff Room'` (category=facility).
They sit outside the Apartment Living cohort so they don't skew peer statistics,
but operators still want to see their utility usage.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.staff_quarters import StaffQuartersResponse, StaffRoom, StaffUtility
from app.services import apartment_data as ad
from app.services import influx as influx_svc

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/staff-quarters", response_model=StaffQuartersResponse)
async def staff_quarters(
    on: date | None = Query(None, description="Reference date (SAST). Defaults to today."),
    db: AsyncSession = Depends(get_db),
) -> StaffQuartersResponse:
    ref_date = on or datetime.now(ad.SAST).date()
    yday = ref_date - timedelta(days=1)
    month_start = ref_date.replace(day=1)

    yday_from = ad.sast_midnight_utc(yday)
    yday_to   = ad.sast_midnight_utc(ref_date)
    mtd_from  = ad.sast_midnight_utc(month_start)
    mtd_to    = ad.sast_midnight_utc(ref_date + timedelta(days=1))

    rooms = (await db.execute(text("""
        SELECT r.id, r.name, r.notes, rt.occupancy AS staff_occupants
        FROM rooms r
        JOIN room_types rt ON rt.id = r.room_type_id
        WHERE rt.name = 'Staff Room'
        ORDER BY r.name
    """))).mappings().all()

    if not rooms:
        return StaffQuartersResponse(report_date=ref_date, rooms=[])

    room_ids = [str(r["id"]) for r in rooms]

    tariffs_raw = await ad.load_tariffs(db, ref_date)

    meters_rows = (await db.execute(text("""
        SELECT external_id, utility_type, room_id
        FROM meters
        WHERE room_id = ANY(:ids ::uuid[])
          AND parent_meter_id IS NULL
    """), {"ids": room_ids})).mappings().all()
    room_to_meters: dict[str, dict[str, list[str]]] = {rid: {} for rid in room_ids}
    for m in meters_rows:
        rid = str(m["room_id"])
        ut = m["utility_type"]
        if ut not in ad.UTILITY_MAP:
            continue
        room_to_meters[rid].setdefault(ut, []).append(m["external_id"])

    measurements = {meas for (meas, _, _, _) in ad.UTILITY_MAP.values()}
    per_meter_yday = {meas: influx_svc.consumption_by_meter(meas, yday_from, yday_to) for meas in measurements}
    per_meter_mtd  = {meas: influx_svc.consumption_by_meter(meas, mtd_from, mtd_to)   for meas in measurements}

    out_rooms: list[StaffRoom] = []
    for r in rooms:
        rid = str(r["id"])
        utilities: dict[str, StaffUtility] = {}
        tot_y = tot_m = 0.0

        for ut, (meas, display_unit, _ru, is_water) in ad.UTILITY_MAP.items():
            mult = 1000.0 if is_water else 1.0
            rate_raw = tariffs_raw.get(ut, {}).get("unit_rate", 0.0)
            rate = rate_raw / mult
            mids = room_to_meters.get(rid, {}).get(ut, [])
            units_y = sum(per_meter_yday[meas].get(mid, 0.0) for mid in mids) * mult
            units_m = sum(per_meter_mtd[meas].get(mid, 0.0)  for mid in mids) * mult
            cost_y = units_y * rate
            cost_m = units_m * rate

            utilities[ut] = StaffUtility(
                utility_type=ut,
                units_label=display_unit,
                yesterday_units=units_y,
                yesterday_cost=cost_y,
                mtd_units=units_m,
                mtd_cost=cost_m,
            )
            tot_y += cost_y
            tot_m += cost_m

        out_rooms.append(StaffRoom(
            room_id=rid,
            name=r["name"],
            notes=r["notes"],
            occupants=int(r["staff_occupants"] or 0),
            utilities=utilities,
            total_yesterday_cost=tot_y,
            total_mtd_cost=tot_m,
        ))

    return StaffQuartersResponse(report_date=ref_date, rooms=out_rooms)
