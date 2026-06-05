"""Per-living-type per-utility consumption allowance CRUD."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.living_type import LivingType
from app.models.living_type_allowance import LivingTypeAllowance
from app.schemas.allowance import AllowanceRead, AllowanceUpsert

router = APIRouter(prefix="/allowances", tags=["allowances"])


@router.get("", response_model=list[AllowanceRead])
async def list_allowances(
    living_type_id: uuid.UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> list[LivingTypeAllowance]:
    stmt = select(LivingTypeAllowance)
    if living_type_id is not None:
        stmt = stmt.where(LivingTypeAllowance.living_type_id == living_type_id)
    return list((await db.execute(stmt)).scalars().all())


@router.post("", response_model=AllowanceRead, status_code=status.HTTP_200_OK)
async def upsert_allowance(
    payload: AllowanceUpsert, db: AsyncSession = Depends(get_db)
) -> LivingTypeAllowance:
    """Upsert by (living_type_id, utility_type, period)."""
    if payload.period not in ("daily", "monthly"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "period must be 'daily' or 'monthly'")
    if not await db.get(LivingType, payload.living_type_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "living_type_id not found")
    if payload.units_per_person < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "units_per_person must be >= 0")

    stmt = pg_insert(LivingTypeAllowance).values(
        id=uuid.uuid4(),
        living_type_id=payload.living_type_id,
        utility_type=payload.utility_type,
        units_per_person=payload.units_per_person,
        period=payload.period,
        note=payload.note,
    ).on_conflict_do_update(
        constraint="uq_living_type_allowance",
        set_={
            "units_per_person": payload.units_per_person,
            "note": payload.note,
        },
    ).returning(LivingTypeAllowance)

    result = await db.execute(stmt)
    obj = result.scalar_one()
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{allowance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_allowance(allowance_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    obj = await db.get(LivingTypeAllowance, allowance_id)
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "allowance not found")
    await db.delete(obj)
    await db.commit()
