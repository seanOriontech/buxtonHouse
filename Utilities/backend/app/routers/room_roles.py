import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.room_role import RoomRole
from app.schemas.room_role import RoomRoleCreate, RoomRoleRead, RoomRoleUpdate

router = APIRouter(prefix="/room-roles", tags=["room-roles"])


@router.get("", response_model=list[RoomRoleRead])
async def list_room_roles(db: AsyncSession = Depends(get_db)) -> list[RoomRole]:
    return list(
        (await db.execute(select(RoomRole).order_by(RoomRole.name))).scalars().all()
    )


@router.post("", response_model=RoomRoleRead, status_code=status.HTTP_201_CREATED)
async def create_room_role(payload: RoomRoleCreate, db: AsyncSession = Depends(get_db)) -> RoomRole:
    obj = RoomRole(**payload.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.put("/{role_id}", response_model=RoomRoleRead)
async def update_room_role(
    role_id: uuid.UUID, payload: RoomRoleUpdate, db: AsyncSession = Depends(get_db)
) -> RoomRole:
    obj = await db.get(RoomRole, role_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "room role not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room_role(role_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    obj = await db.get(RoomRole, role_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "room role not found")
    await db.delete(obj)
    await db.commit()
