from datetime import date

from pydantic import BaseModel


class SpikeFlag(BaseModel):
    utility: str                            # "cold_water" | "hot_water" | "electricity" | "water" (combined)
    severity: str                           # "amber" | "red"
    today_per_person: float
    baseline_median: float
    threshold_amber: float
    threshold_red: float
    robust_z: float


class LeakFlag(BaseModel):
    severity: str                           # "amber" | "red"
    avg_overnight_litres: float
    consecutive_nights: int
    peak_night_litres: float
    nights_over_threshold: int
    threshold_litres: float


class DowFlag(BaseModel):
    utility: str
    severity: str                           # "amber" | "red"
    today_per_person: float
    dow_median_per_person: float
    ratio: float                            # today / dow_median
    day_name: str                           # "Monday", "Tuesday", ...


class DailyPoint(BaseModel):
    date: date
    water_pp: float                         # combined cold + hot, litres/p
    electricity_pp: float                   # kWh/p


class ApartmentAnomaly(BaseModel):
    apartment_number: int
    occupants: int
    spikes: list[SpikeFlag]
    leak: LeakFlag | None
    dow: list[DowFlag]
    anomaly_score: float
    daily_series: list[DailyPoint]          # last N days, for personal envelope chart
    baseline_median_water_pp: float | None
    baseline_q1_water_pp: float | None
    baseline_q3_water_pp: float | None
    baseline_median_elec_pp: float | None
    baseline_q1_elec_pp: float | None
    baseline_q3_elec_pp: float | None


class ApartmentAnomaliesResponse(BaseModel):
    living_type: str
    report_date: date
    baseline_window_days: int
    entries: list[ApartmentAnomaly]
    cohort_red_count: int
    cohort_amber_count: int
    caveats: list[str]


# --- Communal variant (electricity-only, no leak signal, room not apartment) ---

class RoomAnomaly(BaseModel):
    room_number: int
    room_type: str
    occupants: int
    spikes: list[SpikeFlag]                 # electricity only
    dow: list[DowFlag]                      # electricity only
    anomaly_score: float
    daily_series: list[DailyPoint]          # water_pp is always 0 for communal
    baseline_median_elec_pp: float | None
    baseline_q1_elec_pp: float | None
    baseline_q3_elec_pp: float | None


class CommunalAnomaliesResponse(BaseModel):
    living_type: str
    report_date: date
    baseline_window_days: int
    entries: list[RoomAnomaly]
    cohort_red_count: int
    cohort_amber_count: int
    caveats: list[str]
