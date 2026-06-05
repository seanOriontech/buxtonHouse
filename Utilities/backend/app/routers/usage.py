import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.db import get_db
from app.models.meter import Meter, UtilityType
from app.models.room import Room
from app.schemas.usage import (
    CategoryTotal,
    LatestReading,
    OverviewResponse,
    RoomUsageResponse,
    RoomUsageSeries,
    TimeseriesPoint,
    TrendBucket,
    TrendResponse,
)
from app.services import influx

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/latest", response_model=list[LatestReading])
async def latest_readings(db: AsyncSession = Depends(get_db)) -> list[LatestReading]:
    meters_by_ext: dict[str, Meter] = {}
    rows = (
        await db.execute(select(Meter).options(joinedload(Meter.room)))
    ).scalars().unique().all()
    for m in rows:
        meters_by_ext[m.external_id] = m

    # Same external_id can appear under multiple measurements (legacy backfill
    # under energy_meter + live narrow writes under water_data/aux_data). Keep
    # only the freshest row per external_id.
    freshest: dict[str, tuple[str, dict]] = {}
    for measurement in (
        influx.KNOWN_ENERGY_MEASUREMENT,
        influx.KNOWN_WATER_MEASUREMENT,
        influx.KNOWN_AUX_MEASUREMENT,
    ):
        for r in influx.latest_per_meter(measurement):
            ext = r["external_id"]
            if not ext:
                continue
            prev = freshest.get(ext)
            if prev is None or (r["ts"] and prev[1]["ts"] and r["ts"] > prev[1]["ts"]):
                freshest[ext] = (measurement, r)

    out: list[LatestReading] = []
    for ext, (measurement, r) in freshest.items():
        meter = meters_by_ext.get(ext)
        out.append(
            LatestReading(
                external_id=ext,
                influx_measurement=measurement,
                value=float(r["value"]) if r["value"] is not None else 0.0,
                units=(meter.units if meter else r.get("units")),
                last_seen=r["ts"],
                stale=influx.is_stale(r["ts"]),
                room_id=meter.room_id if meter else None,
                room_name=(meter.room.name if (meter and meter.room) else None),
                utility_type=(meter.utility_type.value if meter else None),
            )
        )
    return out


@router.get("/overview", response_model=OverviewResponse)
async def overview(
    from_: datetime = Query(..., alias="from"),
    to: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
) -> OverviewResponse:
    if to <= from_:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "`to` must be after `from`")

    # Build a lookup of external_id → (utility_type, room category) from the catalogue.
    rows = (await db.execute(
        select(Meter).options(joinedload(Meter.room).joinedload(Room.room_type))
    )).scalars().unique().all()
    catalogue: dict[str, dict] = {}
    for m in rows:
        category = m.room.room_type.category.value if (m.room and m.room.room_type) else "unassigned"
        catalogue[m.external_id] = {
            "utility_type": m.utility_type.value,
            "units": m.units,
            "category": category,
        }

    totals: dict[str, float] = defaultdict(float)
    breakdown: dict[tuple[str, str], dict] = {}

    for measurement in (
        influx.KNOWN_ENERGY_MEASUREMENT,
        influx.KNOWN_WATER_MEASUREMENT,
        influx.KNOWN_AUX_MEASUREMENT,
    ):
        sums = influx.sum_by_tag(measurement, from_, to, group_tags=["meter_id"])
        for row in sums:
            ext = row.get("meter_id")
            val = float(row.get("value") or 0.0)
            info = catalogue.get(ext)
            if info:
                utility = info["utility_type"]
                category = info["category"]
                units = info["units"]
            else:
                # unlinked meter — fall back to measurement-derived utility.
                utility = (
                    "electricity" if measurement == influx.KNOWN_ENERGY_MEASUREMENT else measurement
                )
                category = "unassigned"
                units = None
            totals[utility] += val
            key = (category, utility)
            bucket = breakdown.setdefault(key, {"total": 0.0, "units": units})
            bucket["total"] += val
            if units and not bucket["units"]:
                bucket["units"] = units

    return OverviewResponse(
        from_=from_,
        to=to,
        totals=dict(totals),
        breakdown=[
            CategoryTotal(category=cat, utility_type=ut, total=b["total"], units=b["units"])
            for (cat, ut), b in breakdown.items()
        ],
    )


@router.get("/by-room/{room_id}", response_model=RoomUsageResponse)
async def usage_by_room(
    room_id: uuid.UUID,
    from_: datetime = Query(..., alias="from"),
    to: datetime = Query(...),
    interval: str = Query("1h"),
    db: AsyncSession = Depends(get_db),
) -> RoomUsageResponse:
    if to <= from_:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "`to` must be after `from`")

    meters = (
        await db.execute(select(Meter).where(Meter.room_id == room_id))
    ).scalars().all()
    if not meters:
        return RoomUsageResponse(room_id=room_id, from_=from_, to=to, series=[])

    by_utility: dict[str, list[Meter]] = defaultdict(list)
    for m in meters:
        by_utility[m.utility_type.value].append(m)

    series: list[RoomUsageSeries] = []
    for utility, group in by_utility.items():
        per_meter: dict[str, list[Meter]] = defaultdict(list)
        for m in group:
            per_meter[m.influx_measurement].append(m)

        buckets: dict[datetime, float] = defaultdict(float)
        units = group[0].units
        for measurement, ms in per_meter.items():
            ext_ids = [m.external_id for m in ms]
            for point in influx.series_for_meters(measurement, ext_ids, from_, to, every=interval):
                if point["value"] is None or point["ts"] is None:
                    continue
                buckets[point["ts"]] += float(point["value"])

        series.append(
            RoomUsageSeries(
                utility_type=utility,
                units=units,
                points=[
                    TimeseriesPoint(ts=ts, value=v)
                    for ts, v in sorted(buckets.items())
                ],
            )
        )

    return RoomUsageResponse(room_id=room_id, from_=from_, to=to, series=series)


@router.get("/trends", response_model=TrendResponse)
async def trends(
    utility: UtilityType = Query(...),
    period: str = Query("monthly", pattern="^(monthly|weekly|daily)$"),
    lookback: int = Query(12, ge=1, le=36),
    db: AsyncSession = Depends(get_db),
) -> TrendResponse:
    now = datetime.now(timezone.utc)
    if period == "monthly":
        every = "30d"
        window = timedelta(days=30 * lookback)
    elif period == "weekly":
        every = "7d"
        window = timedelta(days=7 * lookback)
    else:
        every = "1d"
        window = timedelta(days=lookback)

    meters = (
        await db.execute(select(Meter).where(Meter.utility_type == utility))
    ).scalars().all()
    if not meters:
        return TrendResponse(utility_type=utility.value, units=None, buckets=[])

    per_measurement: dict[str, list[str]] = defaultdict(list)
    for m in meters:
        per_measurement[m.influx_measurement].append(m.external_id)
    units = meters[0].units

    def collect(from_: datetime, to_: datetime) -> dict[datetime, float]:
        out: dict[datetime, float] = defaultdict(float)
        for measurement, ext_ids in per_measurement.items():
            for p in influx.series_for_meters(measurement, ext_ids, from_, to_, every=every):
                if p["value"] is None or p["ts"] is None:
                    continue
                out[p["ts"]] += float(p["value"])
        return out

    current = collect(now - window, now)
    prior = collect(now - window - timedelta(days=365), now - timedelta(days=365))

    prior_by_md: dict[tuple[int, int], float] = {(k.month, k.day): v for k, v in prior.items()}

    buckets = [
        TrendBucket(
            period_start=ts,
            value=val,
            previous_year_value=prior_by_md.get((ts.month, ts.day)),
        )
        for ts, val in sorted(current.items())
    ]
    return TrendResponse(utility_type=utility.value, units=units, buckets=buckets)
