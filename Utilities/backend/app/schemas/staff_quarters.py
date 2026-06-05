from datetime import date

from pydantic import BaseModel


class StaffUtility(BaseModel):
    utility_type: str
    units_label: str
    yesterday_units: float
    yesterday_cost: float
    mtd_units: float
    mtd_cost: float


class StaffRoom(BaseModel):
    room_id: str
    name: str
    notes: str | None = None
    occupants: int                          # from room_type.occupancy
    utilities: dict[str, StaffUtility]
    total_yesterday_cost: float
    total_mtd_cost: float


class StaffQuartersResponse(BaseModel):
    report_date: date
    rooms: list[StaffRoom]
