"""Aggregated building dashboard — calls existing insights handlers and
reshapes their output for the root overview page.

No new Influx queries: the apartment_insights, communal_room_insights, and
staff_quarters handlers each compute the MTD electricity values we need, so
we just sum + filter their results into a single response.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.routers.apartment_insights import apartment_insights
from app.routers.communal_insights import communal_room_insights
from app.routers.staff_quarters import staff_quarters
from app.schemas.building_overview import (
    BuildingOverviewResponse,
    ElectricityHeavyUsers,
    ElectricitySummary,
    HeavyApartment,
    HeavyRoom,
    Occupancy,
    WaterAlertApartment,
    WaterAlerts,
)
from app.services import apartment_data as ad

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/building-overview", response_model=BuildingOverviewResponse)
async def building_overview(
    on: date | None = Query(None, description="Reference date (SAST). Defaults to today."),
    db: AsyncSession = Depends(get_db),
) -> BuildingOverviewResponse:
    ref_date = on or datetime.now(ad.SAST).date()
    month_start = ref_date.replace(day=1)
    days_in_month = calendar.monthrange(ref_date.year, ref_date.month)[1]
    days_elapsed = max(1, (ref_date - month_start).days + 1)

    # Reuse the existing handlers — each one already does its own Flux work +
    # cohort math. Calling them avoids a re-implementation of the per-utility
    # aggregation logic in three places.
    apt = await apartment_insights(living_type="Apartment Living", on=ref_date, db=db)
    com = await communal_room_insights(on=ref_date, db=db)
    staff = await staff_quarters(on=ref_date, db=db)

    tariffs = await ad.load_tariffs(db, ref_date)
    rate = tariffs.get("electricity", {}).get("unit_rate", 0.0)

    # --- Occupancy -----------------------------------------------------------
    apt_students = sum(a.occupants for a in apt.apartments)
    com_students = sum(r.occupants for r in com.rooms)
    staff_count  = sum(r.occupants for r in staff.rooms)
    total_tracked = apt_students + com_students + staff_count

    occupancy = Occupancy(
        students_apartment_living=apt_students,
        students_communal_living=com_students,
        students_total=apt_students + com_students,
        staff=staff_count,
        office=None,
        total_tracked=total_tracked,
    )

    # --- Electricity totals (already in display units, kWh) ------------------
    apt_mtd_kwh = sum(a.utilities["electricity"].mtd_units for a in apt.apartments)
    com_mtd_kwh = sum(r.electricity.mtd_kwh for r in com.rooms)
    staff_mtd_kwh = sum(r.utilities["electricity"].mtd_units for r in staff.rooms)
    total_kwh = apt_mtd_kwh + com_mtd_kwh + staff_mtd_kwh
    total_cost = total_kwh * rate
    avg_pp_per_day = total_kwh / days_elapsed / max(1, total_tracked)

    electricity = ElectricitySummary(
        apartment_living_mtd_kwh=apt_mtd_kwh,
        communal_living_mtd_kwh=com_mtd_kwh,
        staff_mtd_kwh=staff_mtd_kwh,
        building_total_mtd_kwh=total_kwh,
        building_total_mtd_cost=total_cost,
        avg_kwh_per_person_per_day=avg_pp_per_day,
        rate_per_kwh=rate,
    )

    # --- Water alerts (Apartment Living only — Communal has no caps) ---------
    yday_over = [
        WaterAlertApartment(
            apartment_number=a.apartment_number,
            occupants=a.occupants,
            value_per_person=a.combined_water.yesterday_units_per_person,
        )
        for a in apt.apartments if a.combined_water.flags.over_daily
    ]
    forecast_over = [
        WaterAlertApartment(
            apartment_number=a.apartment_number,
            occupants=a.occupants,
            value_per_person=a.combined_water.eom_forecast_units_per_person,
        )
        for a in apt.apartments if a.combined_water.flags.over_monthly
    ]
    yday_over.sort(key=lambda r: -r.value_per_person)
    forecast_over.sort(key=lambda r: -r.value_per_person)

    # Get the cap from any apartment's combined_water (they share it within a living type)
    daily_cap = monthly_cap = None
    if apt.apartments:
        daily_cap   = apt.apartments[0].combined_water.daily_limit
        monthly_cap = apt.apartments[0].combined_water.monthly_limit

    water_alerts = WaterAlerts(
        daily_cap_litres=daily_cap,
        monthly_cap_litres=monthly_cap,
        yesterday_over_cap=yday_over,
        forecast_over_monthly=forecast_over,
    )

    # --- Electricity heavy users (top-decile only, top 5 per cohort) ---------
    apts_top = sorted(
        (a for a in apt.apartments if a.utilities["electricity"].flags.top_decile),
        key=lambda a: -a.utilities["electricity"].mtd_units_per_person,
    )[:5]
    rooms_top = sorted(
        (r for r in com.rooms if r.electricity.flags.top_decile),
        key=lambda r: -r.electricity.mtd_kwh_per_person,
    )[:5]

    heavy_users = ElectricityHeavyUsers(
        apartments_top_decile=[
            HeavyApartment(
                apartment_number=a.apartment_number,
                occupants=a.occupants,
                mtd_kwh_per_person=a.utilities["electricity"].mtd_units_per_person,
                percentile_rank=a.utilities["electricity"].percentile_rank,
            )
            for a in apts_top
        ],
        communal_rooms_top_decile=[
            HeavyRoom(
                room_number=r.room_number,
                room_type=r.room_type,
                occupants=r.occupants,
                mtd_kwh_per_person=r.electricity.mtd_kwh_per_person,
                percentile_rank=r.electricity.percentile_rank,
            )
            for r in rooms_top
        ],
    )

    # Snapshot date: take the most recent of apt + communal (they should match
    # but use the latest just in case).
    snap = max(filter(None, [apt.snapshot_date, com.snapshot_date]), default=None)

    return BuildingOverviewResponse(
        report_date=ref_date,
        snapshot_date=snap,
        days_elapsed_mtd=days_elapsed,
        days_in_month=days_in_month,
        occupancy=occupancy,
        electricity=electricity,
        water_alerts=water_alerts,
        electricity_heavy_users=heavy_users,
    )


# Unused import guard
_ = timedelta
