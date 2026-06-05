from datetime import date

from pydantic import BaseModel


class ElectricityFlags(BaseModel):
    top_decile: bool                       # percentile_rank >= 90
    forecast_over_median_15x: bool         # EOM forecast > cohort median × 1.5


class ElectricityStats(BaseModel):
    yesterday_kwh: float
    yesterday_kwh_per_person: float
    mtd_kwh: float
    mtd_kwh_per_person: float
    mtd_cost: float
    mtd_cost_per_person: float
    eom_forecast_kwh_per_person: float
    eom_forecast_cost: float
    eom_forecast_cost_per_person: float
    percentile_rank: float
    cohort_median: float
    cohort_p90: float
    flags: ElectricityFlags


class RoomInsight(BaseModel):
    room_id: str
    room_number: int
    name: str
    room_type: str
    occupants: int
    beds: int
    electricity: ElectricityStats
    risk_score: float
    flags_summary: list[str]


class CohortStats(BaseModel):
    median: float
    p75: float
    p90: float
    p95: float


class CommunalInsightsResponse(BaseModel):
    living_type: str
    report_date: date
    snapshot_date: date | None
    days_elapsed_mtd: int
    days_in_month: int
    cohort_stats: CohortStats
    rooms: list[RoomInsight]                # sorted by risk_score desc
    caveats: list[str]


# --- Daily series for trends tab --------------------------------------------

class DailyElectricityEntry(BaseModel):
    date: date
    kwh: float
    kwh_per_person: float


class RoomDailySeries(BaseModel):
    room_id: str
    room_number: int
    name: str
    occupants: int
    days: list[DailyElectricityEntry]
    days_in_top_decile: int                 # days with elec_pp ≥ cohort P90 that day


class CommunalDailySeriesResponse(BaseModel):
    living_type: str
    date_range: tuple[date, date]
    days: int
    rooms: list[RoomDailySeries]
