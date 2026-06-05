"""Apartment leak-review drill-down — hourly water consumption (cold + hot)
broken into a 7-day × 24-hour grid plus a nightly summary."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.leak_detail import (
    ApartmentLeakDetailResponse,
    HourlyCell,
    NightSummary,
)
from app.services import apartment_data as ad
from app.services import influx as influx_svc

router = APIRouter(prefix="/usage", tags=["usage"])

SAST = ZoneInfo("Africa/Johannesburg")
UTC = ZoneInfo("UTC")

NIGHT_START_HOUR = 2
NIGHT_END_HOUR = 5
LEAK_THRESHOLD_LITRES = 5.0


@router.get("/apartment-leak-detail", response_model=ApartmentLeakDetailResponse)
async def apartment_leak_detail(
    apartment_number: int = Query(...),
    living_type: str = Query("Apartment Living"),
    days: int = Query(7, ge=2, le=30),
    on: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> ApartmentLeakDetailResponse:
    today_sast = datetime.now(SAST).date()
    ref_date = on or today_sast
    last_day  = ref_date - timedelta(days=1) if ref_date == today_sast else ref_date
    first_day = last_day - timedelta(days=days - 1)

    apartments = await ad.load_apartments(db, living_type)
    apt_id = next(
        (apt_id for apt_id, info in apartments.items()
         if info["apartment_number"] == apartment_number),
        None,
    )
    if apt_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"apartment {apartment_number} not found in {living_type}")

    apt_room_ids = apartments[apt_id]["room_ids"]
    meters = await ad.load_meters_for_rooms(db, apt_room_ids)
    cold_ids = [m["external_id"] for m in meters if m["utility_type"] == "cold_water"]
    hot_ids  = [m["external_id"] for m in meters if m["utility_type"] == "hot_water"]

    series_from = ad.sast_midnight_utc(first_day - timedelta(days=1))
    series_to   = ad.sast_midnight_utc(last_day + timedelta(days=1))

    cold_hourly = influx_svc.hourly_consumption_by_meter("water_data", series_from, series_to, meter_ids=cold_ids)
    hot_hourly  = influx_svc.hourly_consumption_by_meter("water_data", series_from, series_to, meter_ids=hot_ids)

    cold_by_hour_utc: dict[str, float] = {}
    hot_by_hour_utc: dict[str, float] = {}
    for mid in cold_ids:
        for ts_iso, v in cold_hourly.get(mid, {}).items():
            cold_by_hour_utc[ts_iso] = cold_by_hour_utc.get(ts_iso, 0.0) + v * 1000.0
    for mid in hot_ids:
        for ts_iso, v in hot_hourly.get(mid, {}).items():
            hot_by_hour_utc[ts_iso]  = hot_by_hour_utc.get(ts_iso, 0.0) + v * 1000.0

    all_ts_iso = sorted(set(cold_by_hour_utc) | set(hot_by_hour_utc))

    cells: list[HourlyCell] = []
    nights_acc: dict[date, dict[str, float]] = {}
    for ts_iso in all_ts_iso:
        ts_utc = datetime.fromisoformat(ts_iso)
        if ts_utc.tzinfo is None:
            ts_utc = ts_utc.replace(tzinfo=UTC)
        ts_sast = ts_utc.astimezone(SAST)
        # Flux aggregateWindow stamps the END of the window — actual hour data
        # is for the PREVIOUS hour. Shift back one hour for display.
        sast_hour_start = ts_sast - timedelta(hours=1)
        sast_date_val = sast_hour_start.date()
        sast_hour = sast_hour_start.hour

        if not (first_day <= sast_date_val <= last_day):
            continue

        cold = cold_by_hour_utc.get(ts_iso, 0.0)
        hot  = hot_by_hour_utc.get(ts_iso, 0.0)
        total = cold + hot

        cells.append(HourlyCell(
            hour_utc=ts_utc,
            hour_sast=sast_hour_start.replace(tzinfo=None),
            sast_date=sast_date_val,
            sast_hour=sast_hour,
            cold_litres=cold,
            hot_litres=hot,
            total_litres=total,
        ))

        if NIGHT_START_HOUR <= sast_hour < NIGHT_END_HOUR:
            n = nights_acc.setdefault(sast_date_val, {"cold": 0.0, "hot": 0.0, "total": 0.0})
            n["cold"]  += cold
            n["hot"]   += hot
            n["total"] += total

    nights: list[NightSummary] = []
    for d in (first_day + timedelta(days=i) for i in range(days)):
        n = nights_acc.get(d, {"cold": 0.0, "hot": 0.0, "total": 0.0})
        nights.append(NightSummary(
            sast_date=d,
            cold_litres_overnight=n["cold"],
            hot_litres_overnight=n["hot"],
            total_litres_overnight=n["total"],
            over_threshold=n["total"] > LEAK_THRESHOLD_LITRES,
        ))

    return ApartmentLeakDetailResponse(
        apartment_number=apartment_number,
        living_type=living_type,
        days=days,
        window_start_hour=NIGHT_START_HOUR,
        window_end_hour=NIGHT_END_HOUR,
        leak_threshold_litres=LEAK_THRESHOLD_LITRES,
        cells=cells,
        nights=nights,
    )
