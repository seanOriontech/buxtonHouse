"""Schemas for the per-room communal detail dashboard."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class ElectricityCard(BaseModel):
    cost_per_kwh: float
    opening_reading: float | None     # at month start
    closing_reading: float | None     # latest (live)
    yesterday_kwh: float
    mtd_kwh: float
    mtd_cost: float


class CommunalRoomFlag(BaseModel):
    code: str
    severity: str                     # red / amber
    description: str


class CommunalRoomBudget(BaseModel):
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


class CommunalRoomDetailResponse(BaseModel):
    room_id: str
    room_number: int
    room_name: str
    room_type: str
    living_type: str
    report_date: date
    days_in_month: int
    days_elapsed_mtd: int
    occupants: int
    beds: int
    snapshot_date: date | None
    budget: CommunalRoomBudget
    electricity: ElectricityCard
    flags: list[CommunalRoomFlag]
