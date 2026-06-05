import uuid
from datetime import datetime

from pydantic import BaseModel


class LatestReading(BaseModel):
    external_id: str
    influx_measurement: str
    value: float
    units: str | None = None
    last_seen: datetime
    stale: bool
    room_id: uuid.UUID | None = None
    room_name: str | None = None
    utility_type: str | None = None


class CategoryTotal(BaseModel):
    category: str
    utility_type: str
    total: float
    units: str | None = None


class OverviewResponse(BaseModel):
    from_: datetime
    to: datetime
    totals: dict[str, float]
    breakdown: list[CategoryTotal]


class TimeseriesPoint(BaseModel):
    ts: datetime
    value: float


class RoomUsageSeries(BaseModel):
    utility_type: str
    units: str | None = None
    points: list[TimeseriesPoint]


class RoomUsageResponse(BaseModel):
    room_id: uuid.UUID
    from_: datetime
    to: datetime
    series: list[RoomUsageSeries]


class TrendBucket(BaseModel):
    period_start: datetime
    value: float
    previous_year_value: float | None = None


class TrendResponse(BaseModel):
    utility_type: str
    units: str | None = None
    buckets: list[TrendBucket]
