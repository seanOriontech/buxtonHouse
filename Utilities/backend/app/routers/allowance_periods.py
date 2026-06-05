import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.allowance_period import AllowancePeriod
from app.schemas.allowance_period import (
    AllowancePeriodCreate,
    AllowancePeriodRead,
    AllowancePeriodUpdate,
)

router = APIRouter(prefix="/allowance-periods", tags=["allowance-periods"])


@router.get("", response_model=list[AllowancePeriodRead])
async def list_periods(db: AsyncSession = Depends(get_db)) -> list[AllowancePeriod]:
    return list(
        (await db.execute(select(AllowancePeriod).order_by(AllowancePeriod.starts_at)))
        .scalars()
        .all()
    )


@router.post("", response_model=AllowancePeriodRead, status_code=status.HTTP_201_CREATED)
async def create_period(
    payload: AllowancePeriodCreate, db: AsyncSession = Depends(get_db)
) -> AllowancePeriod:
    if payload.ends_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ends_at must be after starts_at")
    obj = AllowancePeriod(**payload.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.put("/{period_id}", response_model=AllowancePeriodRead)
async def update_period(
    period_id: uuid.UUID, payload: AllowancePeriodUpdate, db: AsyncSession = Depends(get_db)
) -> AllowancePeriod:
    obj = await db.get(AllowancePeriod, period_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "allowance period not found")
    data = payload.model_dump(exclude_unset=True)
    new_start = data.get("starts_at", obj.starts_at)
    new_end = data.get("ends_at", obj.ends_at)
    if new_end and new_start and new_end <= new_start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ends_at must be after starts_at")
    for k, v in data.items():
        setattr(obj, k, v)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{period_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_period(period_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    obj = await db.get(AllowancePeriod, period_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "allowance period not found")
    await db.delete(obj)
    await db.commit()
