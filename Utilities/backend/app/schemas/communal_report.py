from datetime import date

from pydantic import BaseModel


class UtilityPeriod(BaseModel):
    units: float
    cost: float


class RoomElectricity(BaseModel):
    yesterday: UtilityPeriod
    mtd: UtilityPeriod
    avg_per_day: UtilityPeriod


class RoomReportRow(BaseModel):
    room_id: str
    room_number: int
    room_type: str
    occupants: int
    beds: int
    electricity: RoomElectricity


class CommunalReportResponse(BaseModel):
    living_type: str
    report_date: date
    snapshot_date: date | None
    days_elapsed_mtd: int
    tariff_rate_per_kwh: float
    rooms: list[RoomReportRow]
