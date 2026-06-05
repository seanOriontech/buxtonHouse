from datetime import date

from pydantic import BaseModel


class UtilityPeriod(BaseModel):
    units: float
    cost: float


class ApartmentUtility(BaseModel):
    utility_type: str
    units_label: str          # "litres" / "kWh"
    yesterday: UtilityPeriod
    mtd: UtilityPeriod
    avg_per_day: UtilityPeriod


class ApartmentRow(BaseModel):
    apartment_number: int
    occupants: int
    beds: int
    utilities: dict[str, ApartmentUtility]   # keyed by utility_type
    total_cost_yesterday: float
    total_cost_mtd: float
    total_cost_avg_per_day: float


class TariffInfo(BaseModel):
    utility_type: str
    rate_per_unit: float      # already normalised to per-litre / per-kWh
    raw_rate: float
    raw_unit: str             # "m³" / "kWh"
    display_unit: str         # "litre" / "kWh"


class ApartmentReportResponse(BaseModel):
    living_type: str
    report_date: date
    snapshot_date: date | None
    days_elapsed_mtd: int
    tariffs: dict[str, TariffInfo]
    apartments: list[ApartmentRow]
