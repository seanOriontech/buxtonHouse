from datetime import date

from pydantic import BaseModel


# --- Always-on baseline draw -------------------------------------------------

class BaselineRow(BaseModel):
    apartment_number: int
    occupants: int
    avg_overnight_kwh: float            # mean kWh in 02:00–05:00 SAST across the last N nights
    avg_overnight_watts: float          # = avg_overnight_kwh / window_hours × 1000
    nights_observed: int
    severity: str | None                # "red" / "amber" / None


class BaselineDrawResponse(BaseModel):
    living_type: str
    report_date: date
    nights: int
    window_start_hour: int              # 2
    window_end_hour: int                # 5
    cohort_median_watts: float
    cohort_p75_watts: float
    cohort_p90_watts: float
    rows: list[BaselineRow]             # sorted by avg_overnight_watts desc


# --- Sub-meter breakdown -----------------------------------------------------

class SubmeterRow(BaseModel):
    external_id: str
    room_number: int | None
    room_name: str
    mtd_kwh: float
    mtd_cost: float
    pct_of_apartment_total: float       # share of the apartment's submeter sum


class SubmeterBreakdownResponse(BaseModel):
    apartment_number: int
    living_type: str
    report_date: date
    days_elapsed_mtd: int
    total_submeter_mtd_kwh: float       # sum across all listed submeters
    total_submeter_mtd_cost: float
    main_meter_external_id: str | None  # apartment-level main meter, for reference
    main_meter_mtd_kwh: float | None    # should ≈ sum of submeters
    submeters: list[SubmeterRow]        # sorted by mtd_kwh desc


# --- Communal variants -------------------------------------------------------

class CommunalBaselineRow(BaseModel):
    room_id: str
    room_number: int
    room_name: str
    room_type: str
    occupants: int
    avg_overnight_kwh: float
    avg_overnight_watts: float
    nights_observed: int
    severity: str | None                # "red" / "amber" / None


class CommunalBaselineDrawResponse(BaseModel):
    living_type: str
    report_date: date
    nights: int
    window_start_hour: int              # 2
    window_end_hour: int                # 5
    cohort_median_watts: float
    cohort_p75_watts: float
    cohort_p90_watts: float
    rows: list[CommunalBaselineRow]     # sorted by avg_overnight_watts desc


class CommunalSubmeterRow(BaseModel):
    external_id: str
    mtd_kwh: float
    mtd_cost: float
    pct_of_room_total: float            # share of this room's submeter sum


class CommunalSubmeterBreakdownResponse(BaseModel):
    room_id: str
    room_number: int
    room_name: str
    living_type: str
    report_date: date
    days_elapsed_mtd: int
    total_submeter_mtd_kwh: float
    total_submeter_mtd_cost: float
    main_meter_external_id: str | None
    main_meter_mtd_kwh: float | None
    submeters: list[CommunalSubmeterRow]  # sorted by mtd_kwh desc
