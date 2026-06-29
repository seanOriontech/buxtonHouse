"""Hot-water ring-main daily balance.

Two cumulative m³ flow meters on the hot-water ring:
  - HW_Ring_Main   ("Hot water supply (Ring main)")  — flow on the ring main
  - HW_Supply_Ring ("Hot water supply to Ring main")  — fresh HW fed into the ring

This endpoint returns, per day over a selected period, each meter's daily
consumption (last − first cumulative reading that day) and the difference
HW_Ring_Main − HW_Supply_Ring.

Data is read from the `water_data` measurement (these meters report m³ there;
`energy_meter` carries them too but is sparse/zero for this pair).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.services import apartment_data as ad
from app.services import influx

router = APIRouter(prefix="/usage", tags=["usage"])

MEASUREMENT = "water_data"
UNITS = "m³"
RING_MAIN = "HW_Ring_Main"
SUPPLY_RING = "HW_Supply_Ring"


class RingDay(BaseModel):
    date: date
    ring_main: float
    supply_ring: float
    difference: float


class RingTotals(BaseModel):
    ring_main: float
    supply_ring: float
    difference: float


class HotWaterRingResponse(BaseModel):
    units: str
    ring_main_meter: str
    supply_ring_meter: str
    date_range: tuple[date, date]
    days: int
    rows: list[RingDay]
    totals: RingTotals


@router.get("/hot-water-ring", response_model=HotWaterRingResponse)
async def hot_water_ring(
    days: int = Query(30, ge=2, le=120),
    on: date | None = Query(None),
) -> HotWaterRingResponse:
    today_sast = datetime.now(ad.SAST).date()
    ref_date = on or today_sast
    # Exclude today (partial day) when the reference is "now".
    last_day = ref_date - timedelta(days=1) if ref_date == today_sast else ref_date
    first_day = last_day - timedelta(days=days - 1)

    # daily_consumption_by_meter diffs day-over-day, so the first day of the
    # window has no prior reading — pull one extra day before, and one after so
    # the last full day is captured.
    influx_from = ad.sast_midnight_utc(first_day - timedelta(days=1))
    influx_to = ad.sast_midnight_utc(last_day + timedelta(days=1))

    daily = influx.daily_consumption_by_meter(
        MEASUREMENT, influx_from, influx_to, meter_ids=[RING_MAIN, SUPPLY_RING]
    )
    rm_days = daily.get(RING_MAIN, {})
    sr_days = daily.get(SUPPLY_RING, {})

    day_list = [first_day + timedelta(days=i) for i in range(days)]
    rows: list[RingDay] = []
    t_rm = t_sr = 0.0
    for d in day_list:
        di = d.isoformat()
        rm = round(rm_days.get(di, 0.0), 3)
        sr = round(sr_days.get(di, 0.0), 3)
        t_rm += rm
        t_sr += sr
        rows.append(RingDay(date=d, ring_main=rm, supply_ring=sr, difference=round(rm - sr, 3)))

    return HotWaterRingResponse(
        units=UNITS,
        ring_main_meter=RING_MAIN,
        supply_ring_meter=SUPPLY_RING,
        date_range=(day_list[0], day_list[-1]),
        days=days,
        rows=rows,
        totals=RingTotals(
            ring_main=round(t_rm, 3),
            supply_ring=round(t_sr, 3),
            difference=round(t_rm - t_sr, 3),
        ),
    )
