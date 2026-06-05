import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.property import Property
from app.schemas.property import PropertyCreate, PropertyRead, PropertyUpdate

router = APIRouter(prefix="/properties", tags=["properties"])


@router.get("", response_model=list[PropertyRead])
async def list_properties(db: AsyncSession = Depends(get_db)) -> list[Property]:
    return list(
        (await db.execute(select(Property).order_by(Property.code))).scalars().all()
    )


@router.get("/{property_id}", response_model=PropertyRead)
async def get_property(property_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Property:
    obj = await db.get(Property, property_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "property not found")
    return obj


@router.post("", response_model=PropertyRead, status_code=status.HTTP_201_CREATED)
async def create_property(payload: PropertyCreate, db: AsyncSession = Depends(get_db)) -> Property:
    obj = Property(**payload.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.put("/{property_id}", response_model=PropertyRead)
async def update_property(
    property_id: uuid.UUID, payload: PropertyUpdate, db: AsyncSession = Depends(get_db)
) -> Property:
    obj = await db.get(Property, property_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "property not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property(property_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    obj = await db.get(Property, property_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "property not found")
    await db.delete(obj)
    await db.commit()
