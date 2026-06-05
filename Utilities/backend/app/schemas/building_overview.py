from datetime import date

from pydantic import BaseModel


class Occupancy(BaseModel):
    students_apartment_living: int
    students_communal_living: int
    students_total: int
    staff: int
    office: int | None                     # always None for v1 — not tracked
    total_tracked: int


class ElectricitySummary(BaseModel):
    apartment_living_mtd_kwh: float
    communal_living_mtd_kwh: float
    staff_mtd_kwh: float
    building_total_mtd_kwh: float
    building_total_mtd_cost: float
    avg_kwh_per_person_per_day: float
    rate_per_kwh: float


class WaterAlertApartment(BaseModel):
    apartment_number: int
    occupants: int
    value_per_person: float                # litres/p — yesterday or EOM forecast


class WaterAlerts(BaseModel):
    daily_cap_litres: float | None
    monthly_cap_litres: float | None
    yesterday_over_cap: list[WaterAlertApartment]
    forecast_over_monthly: list[WaterAlertApartment]


class HeavyApartment(BaseModel):
    apartment_number: int
    occupants: int
    mtd_kwh_per_person: float
    percentile_rank: float


class HeavyRoom(BaseModel):
    room_number: int
    room_type: str
    occupants: int
    mtd_kwh_per_person: float
    percentile_rank: float


class ElectricityHeavyUsers(BaseModel):
    apartments_top_decile: list[HeavyApartment]
    communal_rooms_top_decile: list[HeavyRoom]


class BuildingOverviewResponse(BaseModel):
    report_date: date
    snapshot_date: date | None
    days_elapsed_mtd: int
    days_in_month: int
    occupancy: Occupancy
    electricity: ElectricitySummary
    water_alerts: WaterAlerts
    electricity_heavy_users: ElectricityHeavyUsers
