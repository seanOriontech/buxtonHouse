import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.living_type import LivingType
from app.models.meter import UtilityType
from app.models.property import Property
from app.models.tariff import Tariff
from app.schemas.tariff import TariffCreate, TariffRead, TariffUpdate

router = APIRouter(prefix="/tariffs", tags=["tariffs"])


@router.get("", response_model=list[TariffRead])
async def list_tariffs(
    property_id: uuid.UUID | None = None,
    living_type_id: uuid.UUID | None = None,
    utility_type: UtilityType | None = None,
    period_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[Tariff]:
    stmt = select(Tariff).order_by(Tariff.starts_at.desc())
    if property_id is not None:
        stmt = stmt.where(Tariff.property_id == property_id)
    if living_type_id is not None:
        stmt = stmt.where(Tariff.living_type_id == living_type_id)
    if utility_type is not None:
        stmt = stmt.where(Tariff.utility_type == utility_type)
    if period_id is not None:
        stmt = stmt.where(Tariff.period_id == period_id)
    return list((await db.execute(stmt)).scalars().all())


@router.post("", response_model=TariffRead, status_code=status.HTTP_201_CREATED)
async def create_tariff(payload: TariffCreate, db: AsyncSession = Depends(get_db)) -> Tariff:
    if not await db.get(Property, payload.property_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "property_id not found")
    if payload.living_type_id and not await db.get(LivingType, payload.living_type_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "living_type_id not found")
    obj = Tariff(**payload.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.put("/{tariff_id}", response_model=TariffRead)
async def update_tariff(
    tariff_id: uuid.UUID, payload: TariffUpdate, db: AsyncSession = Depends(get_db)
) -> Tariff:
    obj = await db.get(Tariff, tariff_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tariff not found")
    data = payload.model_dump(exclude_unset=True)
    if "living_type_id" in data and data["living_type_id"] and not await db.get(
        LivingType, data["living_type_id"]
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "living_type_id not found")
    for k, v in data.items():
        setattr(obj, k, v)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{tariff_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tariff(tariff_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    obj = await db.get(Tariff, tariff_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tariff not found")
    await db.delete(obj)
    await db.commit()
