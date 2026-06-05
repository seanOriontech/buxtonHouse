import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.db import get_db
from app.models.room import Room
from app.models.room_type import RoomCategory, RoomType
from app.schemas.room import RoomCreate, RoomRead, RoomUpdate

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.get("", response_model=list[RoomRead])
async def list_rooms(
    category: RoomCategory | None = None,
    parent_id: uuid.UUID | None = None,
    property_id: uuid.UUID | None = None,
    living_type_id: uuid.UUID | None = None,
    roots_only: bool = False,
    db: AsyncSession = Depends(get_db),
) -> list[Room]:
    stmt = (
        select(Room)
        .options(joinedload(Room.room_type), joinedload(Room.property))
        .order_by(Room.code)
    )
    if parent_id is not None:
        stmt = stmt.where(Room.parent_room_id == parent_id)
    if roots_only:
        stmt = stmt.where(Room.parent_room_id.is_(None))
    if property_id is not None:
        stmt = stmt.where(Room.property_id == property_id)
    if category or living_type_id:
        stmt = stmt.join(RoomType)
        if category:
            stmt = stmt.where(RoomType.category == category)
        if living_type_id:
            stmt = stmt.where(RoomType.living_type_id == living_type_id)
    return list((await db.execute(stmt)).scalars().unique().all())


@router.get("/{room_id}", response_model=RoomRead)
async def get_room(room_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Room:
    room = await db.get(Room, room_id, options=[joinedload(Room.room_type)])
    if not room:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "room not found")
    return room


@router.post("", response_model=RoomRead, status_code=status.HTTP_201_CREATED)
async def create_room(payload: RoomCreate, db: AsyncSession = Depends(get_db)) -> Room:
    if not await db.get(RoomType, payload.room_type_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "room_type_id not found")
    room = Room(**payload.model_dump())
    db.add(room)
    await db.commit()
    return await get_room(room.id, db)


@router.put("/{room_id}", response_model=RoomRead)
async def update_room(
    room_id: uuid.UUID, payload: RoomUpdate, db: AsyncSession = Depends(get_db)
) -> Room:
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "room not found")
    data = payload.model_dump(exclude_unset=True)
    if "room_type_id" in data and not await db.get(RoomType, data["room_type_id"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "room_type_id not found")
    for k, v in data.items():
        setattr(room, k, v)
    await db.commit()
    return await get_room(room.id, db)


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(room_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "room not found")
    await db.delete(room)
    await db.commit()
