from datetime import date

from pydantic import BaseModel


class ApartmentOccupancy(BaseModel):
    apartment_number: int
    living_type: str
    occupants: int
    beds: int
    rooms: int


class ApartmentOccupancyResponse(BaseModel):
    snapshot_date: date | None
    living_type: str
    apartments: list[ApartmentOccupancy]
