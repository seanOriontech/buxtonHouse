import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.living_type import LivingType
from app.schemas.living_type import LivingTypeCreate, LivingTypeRead, LivingTypeUpdate

router = APIRouter(prefix="/living-types", tags=["living-types"])


@router.get("", response_model=list[LivingTypeRead])
async def list_living_types(db: AsyncSession = Depends(get_db)) -> list[LivingType]:
    return list(
        (await db.execute(select(LivingType).order_by(LivingType.name))).scalars().all()
    )


@router.post("", response_model=LivingTypeRead, status_code=status.HTTP_201_CREATED)
async def create_living_type(
    payload: LivingTypeCreate, db: AsyncSession = Depends(get_db)
) -> LivingType:
    obj = LivingType(**payload.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.put("/{living_type_id}", response_model=LivingTypeRead)
async def update_living_type(
    living_type_id: uuid.UUID, payload: LivingTypeUpdate, db: AsyncSession = Depends(get_db)
) -> LivingType:
    obj = await db.get(LivingType, living_type_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "living type not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{living_type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_living_type(
    living_type_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> None:
    obj = await db.get(LivingType, living_type_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "living type not found")
    await db.delete(obj)
    await db.commit()
