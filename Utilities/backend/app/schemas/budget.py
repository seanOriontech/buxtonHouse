from datetime import date

from pydantic import BaseModel


class BudgetRow(BaseModel):
    entity_label: str                       # "Apt 3" / "Room 14"
    entity_number: int
    entity_type: str                        # "apartment" | "room"
    room_type: str | None = None            # for communal rooms
    occupants: int

    # Consumption (display units)
    mtd_water_litres: float | None          # apartment only
    mtd_electricity_kwh: float

    # Cost
    mtd_water_cost: float                   # 0 for communal
    mtd_electricity_cost: float
    mtd_total_cost: float

    # Forecast (linear extrapolation, mtd × days_in_month / days_elapsed)
    eom_forecast_total_cost: float

    # Allowance (accommodation rate per person × occupants)
    monthly_allowance_cost: float
    daily_allowance_cost: float             # = monthly / days_in_month
    pct_consumed: float                     # mtd / monthly_allowance × 100

    # Status / over signal
    already_over: bool                      # mtd_total_cost > monthly_allowance_cost
    forecast_over: bool                     # eom_forecast > monthly_allowance and not already_over
    predicted_over_date: date | None        # when daily-rate projection crosses allowance


class PerPersonBudgetResponse(BaseModel):
    living_type: str
    report_date: date
    days_in_month: int
    days_elapsed_mtd: int
    days_remaining: int
    accommodation_rate_per_person_per_month: float | None   # source value from tariff
    daily_rate_per_person: float | None                     # = monthly / days_in_month
    rows: list[BudgetRow]                   # sorted: already_over → forecast_over → under
