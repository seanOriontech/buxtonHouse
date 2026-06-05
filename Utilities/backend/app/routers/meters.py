import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.meter import Meter, UtilityType
from app.models.room import Room
from app.schemas.meter import DiscoveredMeter, MeterCreate, MeterRead, MeterUpdate
from app.services import influx

router = APIRouter(prefix="/meters", tags=["meters"])


@router.get("", response_model=list[MeterRead])
async def list_meters(
    room_id: uuid.UUID | None = None,
    utility_type: UtilityType | None = None,
    property_id: uuid.UUID | None = None,
    parent_meter_id: uuid.UUID | None = None,
    unassigned: bool = False,
    roots_only: bool = False,
    db: AsyncSession = Depends(get_db),
) -> list[Meter]:
    stmt = select(Meter).order_by(Meter.external_id)
    if room_id is not None:
        stmt = stmt.where(Meter.room_id == room_id)
    if utility_type:
        stmt = stmt.where(Meter.utility_type == utility_type)
    if property_id is not None:
        stmt = stmt.where(Meter.property_id == property_id)
    if parent_meter_id is not None:
        stmt = stmt.where(Meter.parent_meter_id == parent_meter_id)
    if unassigned:
        stmt = stmt.where(Meter.room_id.is_(None))
    if roots_only:
        stmt = stmt.where(Meter.parent_meter_id.is_(None))
    meters = list((await db.execute(stmt)).scalars().all())

    # Overlay live Influx last() so last_seen_at/last_seen_value reflect reality,
    # not the migration-time snapshot. Detach from session so the change isn't persisted.
    db.expunge_all()
    latest = influx.latest_for_all_known_meters()
    for m in meters:
        hit = latest.get(m.external_id)
        if hit and hit["ts"] is not None:
            m.last_seen_at = hit["ts"]
            if hit["value"] is not None:
                try:
                    m.last_seen_value = float(hit["value"])
                except (TypeError, ValueError):
                    pass
    return meters


@router.post("", response_model=MeterRead, status_code=status.HTTP_201_CREATED)
async def create_meter(payload: MeterCreate, db: AsyncSession = Depends(get_db)) -> Meter:
    if payload.room_id and not await db.get(Room, payload.room_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "room_id not found")
    meter = Meter(**payload.model_dump())
    db.add(meter)
    await db.commit()
    await db.refresh(meter)
    return meter


@router.put("/{meter_id}", response_model=MeterRead)
async def update_meter(
    meter_id: uuid.UUID, payload: MeterUpdate, db: AsyncSession = Depends(get_db)
) -> Meter:
    meter = await db.get(Meter, meter_id)
    if not meter:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "meter not found")
    data = payload.model_dump(exclude_unset=True)
    if "room_id" in data and data["room_id"] and not await db.get(Room, data["room_id"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "room_id not found")
    for k, v in data.items():
        setattr(meter, k, v)
    await db.commit()
    await db.refresh(meter)
    return meter


@router.delete("/{meter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meter(meter_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    meter = await db.get(Meter, meter_id)
    if not meter:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "meter not found")
    await db.delete(meter)
    await db.commit()


@router.get("/discover", response_model=list[DiscoveredMeter])
async def discover_meters(db: AsyncSession = Depends(get_db)) -> list[DiscoveredMeter]:
    """List meter_id values seen in Influx (last 7d) across known measurements
    that don't yet exist in the `meters` table."""
    known = {
        row[0]
        for row in (await db.execute(select(Meter.external_id))).all()
    }
    discovered: list[DiscoveredMeter] = []
    for measurement in (
        influx.KNOWN_ENERGY_MEASUREMENT,
        influx.KNOWN_WATER_MEASUREMENT,
        influx.KNOWN_AUX_MEASUREMENT,
    ):
        for row in influx.distinct_meters(measurement):
            if row["external_id"] in known:
                continue
            discovered.append(DiscoveredMeter(**row))
    return discovered
