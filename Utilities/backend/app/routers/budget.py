"""Per-person utility budget tracking.

The accommodation tariff (utility_type IS NULL, living_type set) acts as the
implicit per-person monthly utility allowance. For each apartment (or communal
room) we sum MTD utility cost, forecast EOM cost, compare against
`occupants × accommodation_rate`, and predict the date the apartment will cross
the cap if it's on track to do so.

Apartment Living: water (cold + hot) + electricity, both included in the budget.
Communal Living: electricity only (no per-room water meters).
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.routers.apartment_insights import apartment_insights
from app.routers.communal_insights import communal_room_insights
from app.schemas.budget import BudgetRow, PerPersonBudgetResponse
from app.services import apartment_data as ad

router = APIRouter(prefix="/usage", tags=["usage"])


async def _accommodation_rate(db: AsyncSession, living_type: str, on: date) -> float | None:
    row = (await db.execute(text("""
        SELECT t.unit_rate
        FROM tariffs t
        JOIN living_types lt ON lt.id = t.living_type_id
        WHERE lt.name = :lt
          AND t.utility_type IS NULL
          AND t.starts_at <= :d
          AND (t.ends_at IS NULL OR t.ends_at >= :d)
        ORDER BY t.starts_at DESC
        LIMIT 1
    """), {"lt": living_type, "d": on})).scalar_one_or_none()
    return float(row) if row is not None else None


def _predict_over_date(
    mtd_cost: float,
    monthly_allowance: float,
    days_elapsed: int,
    days_in_month: int,
    today: date,
) -> date | None:
    """Date when the apartment's running total will cross the allowance.

    Linear projection from current daily rate. Returns None if forecast stays
    under the cap (or if there's no spend yet).
    """
    if mtd_cost >= monthly_allowance:
        # Already over — compute back to when they crossed. Not super useful;
        # the UI shows "already over" instead.
        return None
    daily_rate = mtd_cost / max(1, days_elapsed)
    if daily_rate <= 0:
        return None
    remaining_to_cap = monthly_allowance - mtd_cost
    days_until_over = remaining_to_cap / daily_rate
    days_remaining = days_in_month - days_elapsed
    if days_until_over > days_remaining:
        return None
    return today + timedelta(days=int(days_until_over) + 1)  # ceil → first day OVER


@router.get("/per-person-budget", response_model=PerPersonBudgetResponse)
async def per_person_budget(
    living_type: str = Query(...),
    on: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> PerPersonBudgetResponse:
    if living_type not in ("Apartment Living", "Communal Living"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "living_type must be Apartment Living or Communal Living")

    ref_date = on or datetime.now(ad.SAST).date()
    days_in_month = calendar.monthrange(ref_date.year, ref_date.month)[1]
    days_elapsed = max(1, (ref_date - ref_date.replace(day=1)).days + 1)
    days_remaining = max(0, days_in_month - days_elapsed)

    # The accommodation tariff value is the per-person MONTHLY budget
    # (R525/p/month Apartment Living, R220/p/month Communal). Daily allowance
    # is derived by spreading evenly across days_in_month.
    monthly_pp = await _accommodation_rate(db, living_type, ref_date)
    daily_pp   = (monthly_pp / days_in_month) if monthly_pp else None

    rows: list[BudgetRow] = []

    if living_type == "Apartment Living":
        ins = await apartment_insights(living_type=living_type, on=ref_date, db=db)
        for apt in ins.apartments:
            water_units = apt.utilities["cold_water"].mtd_units + apt.utilities["hot_water"].mtd_units
            water_cost  = apt.utilities["cold_water"].mtd_cost  + apt.utilities["hot_water"].mtd_cost
            elec_units  = apt.utilities["electricity"].mtd_units
            elec_cost   = apt.utilities["electricity"].mtd_cost
            mtd_total   = water_cost + elec_cost
            occ_safe    = max(1, apt.occupants)
            monthly_allowance = (monthly_pp or 0.0) * apt.occupants
            daily_allowance   = (daily_pp or 0.0) * apt.occupants
            eom_forecast      = mtd_total / days_elapsed * days_in_month

            already_over = monthly_allowance > 0 and mtd_total > monthly_allowance
            forecast_over = (
                monthly_allowance > 0
                and not already_over
                and eom_forecast > monthly_allowance
            )
            predicted_over = (
                _predict_over_date(mtd_total, monthly_allowance, days_elapsed, days_in_month, ref_date)
                if monthly_allowance > 0 else None
            )

            rows.append(BudgetRow(
                entity_label=f"Apt {apt.apartment_number}",
                entity_number=apt.apartment_number,
                entity_type="apartment",
                room_type=None,
                occupants=apt.occupants,
                mtd_water_litres=water_units,
                mtd_electricity_kwh=elec_units,
                mtd_water_cost=water_cost,
                mtd_electricity_cost=elec_cost,
                mtd_total_cost=mtd_total,
                eom_forecast_total_cost=eom_forecast,
                monthly_allowance_cost=monthly_allowance,
                daily_allowance_cost=daily_allowance,
                pct_consumed=(mtd_total / monthly_allowance * 100) if monthly_allowance > 0 else 0.0,
                already_over=already_over,
                forecast_over=forecast_over,
                predicted_over_date=predicted_over,
            ))
            _ = occ_safe   # keep variable for readability above
    else:  # Communal Living
        ins = await communal_room_insights(on=ref_date, db=db)
        for room in ins.rooms:
            elec_units = room.electricity.mtd_kwh
            elec_cost  = room.electricity.mtd_cost
            mtd_total  = elec_cost
            monthly_allowance = (monthly_pp or 0.0) * room.occupants
            daily_allowance   = (daily_pp or 0.0) * room.occupants
            eom_forecast      = mtd_total / days_elapsed * days_in_month

            already_over = monthly_allowance > 0 and mtd_total > monthly_allowance
            forecast_over = (
                monthly_allowance > 0
                and not already_over
                and eom_forecast > monthly_allowance
            )
            predicted_over = (
                _predict_over_date(mtd_total, monthly_allowance, days_elapsed, days_in_month, ref_date)
                if monthly_allowance > 0 else None
            )

            rows.append(BudgetRow(
                entity_label=f"Room {room.room_number}",
                entity_number=room.room_number,
                entity_type="room",
                room_type=room.room_type,
                occupants=room.occupants,
                mtd_water_litres=None,
                mtd_electricity_kwh=elec_units,
                mtd_water_cost=0.0,
                mtd_electricity_cost=elec_cost,
                mtd_total_cost=mtd_total,
                eom_forecast_total_cost=eom_forecast,
                monthly_allowance_cost=monthly_allowance,
                daily_allowance_cost=daily_allowance,
                pct_consumed=(mtd_total / monthly_allowance * 100) if monthly_allowance > 0 else 0.0,
                already_over=already_over,
                forecast_over=forecast_over,
                predicted_over_date=predicted_over,
            ))

    # Sort: already over → forecast over → highest pct_consumed
    rows.sort(key=lambda r: (
        0 if r.already_over else 1 if r.forecast_over else 2,
        -r.pct_consumed,
    ))

    return PerPersonBudgetResponse(
        living_type=living_type,
        report_date=ref_date,
        days_in_month=days_in_month,
        days_elapsed_mtd=days_elapsed,
        days_remaining=days_remaining,
        accommodation_rate_per_person_per_month=monthly_pp,
        daily_rate_per_person=daily_pp,
        rows=rows,
    )
