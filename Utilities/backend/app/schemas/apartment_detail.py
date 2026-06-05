"""Schemas for the per-apartment detail dashboard."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class UtilityCard(BaseModel):
    utility_type: str                  # cold_water / hot_water / electricity
    units_label: str                   # "litre" or "kWh"
    cost_per_unit: float               # rate per displayed unit (R per ℓ or R per kWh)
    opening_reading: float | None      # at month start, in raw counter units (m³ / kWh)
    closing_reading: float | None      # latest (live) reading
    yesterday_units: float             # in display units
    mtd_units: float
    mtd_cost: float


class BedroomMeterRow(BaseModel):
    room_id: str
    room_number: int | None
    room_name: str
    external_id: str
    opening_reading: float
    current_reading: float
    mtd_kwh: float
    mtd_cost: float
    mtd_pct: float                     # share of apartment sub-meter total
    today_kwh: float
    today_cost: float
    today_pct: float                   # share of today's total


class BudgetSummary(BaseModel):
    accommodation_rate_per_person_per_month: float | None
    monthly_allowance_total: float
    monthly_allowance_per_person: float
    mtd_cost_total: float
    mtd_cost_per_person: float
    pct_consumed: float
    projected_eom_cost: float
    projected_eom_cost_per_person: float
    projected_depletion_date: date | None
    already_over: bool
    forecast_over: bool


class DetailFlag(BaseModel):
    code: str                          # heavy:water / heavy:electricity / leak / spike:water etc.
    severity: str                      # red / amber
    description: str                   # human-readable


class ApartmentDetailResponse(BaseModel):
    apartment_number: int
    living_type: str
    report_date: date
    days_in_month: int
    days_elapsed_mtd: int
    occupants: int
    beds: int
    snapshot_date: date | None
    budget: BudgetSummary
    utilities: dict[str, UtilityCard]
    bedrooms: list[BedroomMeterRow]
    flags: list[DetailFlag]
