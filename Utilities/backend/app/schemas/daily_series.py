from datetime import date

from pydantic import BaseModel


class DailyEntry(BaseModel):
    date: date                              # SAST calendar date
    cold_water_litres: float
    hot_water_litres: float
    combined_water_litres: float            # cold + hot
    electricity_kwh: float


class DailyEntryPerPerson(BaseModel):
    date: date
    cold_water_litres_pp: float
    hot_water_litres_pp: float
    combined_water_litres_pp: float
    electricity_kwh_pp: float


class ApartmentDailySeries(BaseModel):
    apartment_number: int
    occupants: int
    days_total: list[DailyEntry]            # total per apartment per day
    days_per_person: list[DailyEntryPerPerson]
    days_over_water_limit: int              # combined_water_pp > water_daily_limit
    days_in_top_decile_electricity: int     # P90+ within cohort, per day


class DailySeriesResponse(BaseModel):
    living_type: str
    date_range: tuple[date, date]           # [first_day, last_day] inclusive
    days: int
    water_daily_limit: float | None
    apartments: list[ApartmentDailySeries]
