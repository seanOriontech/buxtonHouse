import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.room_type import RoomCategory, RoomType
from app.schemas.room_type import RoomTypeCreate, RoomTypeRead, RoomTypeUpdate

router = APIRouter(prefix="/room-types", tags=["room-types"])


@router.get("", response_model=list[RoomTypeRead])
async def list_room_types(
    category: RoomCategory | None = None, db: AsyncSession = Depends(get_db)
) -> list[RoomType]:
    stmt = select(RoomType).order_by(RoomType.category, RoomType.name)
    if category:
        stmt = stmt.where(RoomType.category == category)
    return list((await db.execute(stmt)).scalars().all())


@router.post("", response_model=RoomTypeRead, status_code=status.HTTP_201_CREATED)
async def create_room_type(payload: RoomTypeCreate, db: AsyncSession = Depends(get_db)) -> RoomType:
    rt = RoomType(**payload.model_dump())
    db.add(rt)
    await db.commit()
    await db.refresh(rt)
    return rt


@router.put("/{room_type_id}", response_model=RoomTypeRead)
async def update_room_type(
    room_type_id: uuid.UUID, payload: RoomTypeUpdate, db: AsyncSession = Depends(get_db)
) -> RoomType:
    rt = await db.get(RoomType, room_type_id)
    if not rt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "room type not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(rt, k, v)
    await db.commit()
    await db.refresh(rt)
    return rt


@router.delete("/{room_type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room_type(room_type_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    rt = await db.get(RoomType, room_type_id)
    if not rt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "room type not found")
    await db.delete(rt)
    await db.commit()
