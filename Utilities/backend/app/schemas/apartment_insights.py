from datetime import date

from pydantic import BaseModel


class UtilityFlags(BaseModel):
    top_decile: bool                       # percentile_rank >= 90
    forecast_over_median_15x: bool         # EOM forecast > cohort median × 1.5


class CombinedWaterFlags(BaseModel):
    over_daily: bool                       # yesterday combined per-person > daily limit
    over_monthly: bool                     # EOM forecast combined per-person > daily × days_in_month


class CombinedWaterInsight(BaseModel):
    yesterday_units_per_person: float      # cold + hot, litres per person
    mtd_units_per_person: float
    eom_forecast_units_per_person: float
    daily_limit: float | None              # ℓ/person/day from living_types
    monthly_limit: float | None            # = daily × days_in_month
    flags: CombinedWaterFlags


class UtilityInsight(BaseModel):
    utility_type: str
    units_label: str
    yesterday_units: float
    yesterday_units_per_person: float
    mtd_units: float
    mtd_units_per_person: float
    mtd_cost: float
    mtd_cost_per_person: float
    eom_forecast_units_per_person: float
    eom_forecast_cost: float
    eom_forecast_cost_per_person: float
    percentile_rank: float                 # 0-100
    cohort_median: float
    cohort_p90: float
    flags: UtilityFlags


class ApartmentInsight(BaseModel):
    apartment_number: int
    occupants: int
    beds: int
    utilities: dict[str, UtilityInsight]
    combined_water: CombinedWaterInsight
    total_mtd_cost: float
    total_eom_forecast_cost: float
    risk_score: float
    flags_summary: list[str]               # e.g. ["heavy:electricity", "forecast:hot_water", "over_daily:water"]


class CohortStats(BaseModel):
    median: float
    p75: float
    p90: float
    p95: float


class WaterLimitInfo(BaseModel):
    daily: float | None
    monthly: float | None


class InsightsResponse(BaseModel):
    living_type: str
    living_type_id: str | None             # so the frontend can PUT the water limit
    report_date: date
    snapshot_date: date | None
    days_elapsed_mtd: int
    days_in_month: int
    water_limit: WaterLimitInfo            # combined-water caps for this living type
    cohort_stats: dict[str, CohortStats]   # utility → cohort stats (per-person)
    apartments: list[ApartmentInsight]     # sorted by risk_score desc
    caveats: list[str]
