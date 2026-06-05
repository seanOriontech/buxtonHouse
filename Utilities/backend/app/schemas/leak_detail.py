from datetime import date, datetime

from pydantic import BaseModel


class HourlyCell(BaseModel):
    hour_utc: datetime        # UTC timestamp of the hour-start
    hour_sast: datetime       # SAST timestamp (for display + heatmap row/col)
    sast_date: date
    sast_hour: int            # 0–23
    cold_litres: float
    hot_litres: float
    total_litres: float


class NightSummary(BaseModel):
    sast_date: date
    cold_litres_overnight: float    # 02:00–05:00 SAST window
    hot_litres_overnight: float
    total_litres_overnight: float
    over_threshold: bool


class ApartmentLeakDetailResponse(BaseModel):
    apartment_number: int
    living_type: str
    days: int
    window_start_hour: int          # default 2
    window_end_hour: int            # default 5
    leak_threshold_litres: float    # default 5
    cells: list[HourlyCell]         # 7 × 24 = 168 cells, sorted by hour_sast
    nights: list[NightSummary]      # one per day in window
