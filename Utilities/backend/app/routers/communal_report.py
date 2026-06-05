"""Per-room electricity report for Communal Living — Excel-style view.

For each room in the Communal Living collection, computes total + cost across
three windows (yesterday / MTD / avg per day MTD). Sister of
`/usage/apartment-report`, but the entity is a room and only electricity is
returned (the source spreadsheet only shows electricity for the communal block).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.communal_report import (
    CommunalReportResponse,
    RoomElectricity,
    RoomReportRow,
    UtilityPeriod,
)
from app.services import apartment_data as ad
from app.services import influx as influx_svc
from app.services import room_data as rd

router = APIRouter(prefix="/usage", tags=["usage"])

LIVING_TYPE = "Communal Living"


@router.get("/communal-room-report", response_model=CommunalReportResponse)
async def communal_room_report(
    on: date | None = Query(None, description="Reference date (SAST). Defaults to today."),
    db: AsyncSession = Depends(get_db),
) -> CommunalReportResponse:
    ref_date = on or datetime.now(ad.SAST).date()
    yday = ref_date - timedelta(days=1)
    month_start = ref_date.replace(day=1)
    days_elapsed = max(1, (ref_date - month_start).days)  # consistent with apartment-report

    yday_from = ad.sast_midnight_utc(yday)
    yday_to   = ad.sast_midnight_utc(ref_date)
    mtd_from  = ad.sast_midnight_utc(month_start)
    mtd_to    = ad.sast_midnight_utc(ref_date)

    rooms = await rd.load_communal_rooms(db, LIVING_TYPE)
    if not rooms:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no rooms for living_type={LIVING_TYPE}")

    room_ids = list(rooms.keys())
    meters = await ad.load_meters_for_rooms(db, room_ids, roots_only=False)
    elec_meters = [m for m in meters if m["utility_type"] == "electricity"]

    snap_date, occ_by_room = await rd.load_occupancy_per_room(db, LIVING_TYPE, ref_date)
    tariffs = await ad.load_tariffs(db, ref_date)
    rate = tariffs.get("electricity", {}).get("unit_rate", 0.0)

    room_to_meters: dict[str, list[str]] = {}
    for m in elec_meters:
        room_to_meters.setdefault(str(m["room_id"]), []).append(m["external_id"])

    yday_per_meter = influx_svc.consumption_by_meter("energy_meter", yday_from, yday_to)
    mtd_per_meter  = influx_svc.consumption_by_meter("energy_meter", mtd_from,  mtd_to)

    out_rows: list[RoomReportRow] = []
    for rid, info in rooms.items():
        occ_data = occ_by_room.get(info["room_number"], {})
        occ_count = occ_data.get("occupants", 0)
        beds = occ_data.get("beds", info["beds"] or 0)

        mids = room_to_meters.get(rid, [])
        y_units = sum(yday_per_meter.get(mid, 0.0) for mid in mids)
        m_units = sum(mtd_per_meter.get(mid, 0.0)  for mid in mids)
        avg_units = m_units / days_elapsed

        elec = RoomElectricity(
            yesterday=UtilityPeriod(units=y_units, cost=y_units * rate),
            mtd=UtilityPeriod(units=m_units, cost=m_units * rate),
            avg_per_day=UtilityPeriod(units=avg_units, cost=avg_units * rate),
        )

        out_rows.append(RoomReportRow(
            room_id=rid,
            room_number=info["room_number"],
            room_type=info["room_type"],
            occupants=occ_count,
            beds=beds,
            electricity=elec,
        ))

    out_rows.sort(key=lambda r: r.room_number)

    return CommunalReportResponse(
        living_type=LIVING_TYPE,
        report_date=ref_date,
        snapshot_date=snap_date,
        days_elapsed_mtd=days_elapsed,
        tariff_rate_per_kwh=rate,
        rooms=out_rows,
    )
