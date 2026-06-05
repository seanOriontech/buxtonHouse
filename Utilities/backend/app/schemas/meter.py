import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.meter import UtilityType


class MeterBase(BaseModel):
    external_id: str
    name: str | None = None
    utility_type: UtilityType
    influx_measurement: str
    units: str | None = None
    room_id: uuid.UUID | None = None
    parent_meter_id: uuid.UUID | None = None
    property_id: uuid.UUID | None = None
    description: str | None = None


class MeterCreate(MeterBase):
    pass


class MeterUpdate(BaseModel):
    external_id: str | None = None
    name: str | None = None
    utility_type: UtilityType | None = None
    influx_measurement: str | None = None
    units: str | None = None
    room_id: uuid.UUID | None = None
    parent_meter_id: uuid.UUID | None = None
    property_id: uuid.UUID | None = None
    description: str | None = None


class MeterRead(MeterBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    last_seen_value: float | None = None
    last_seen_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class DiscoveredMeter(BaseModel):
    external_id: str
    influx_measurement: str
    category: str | None = None
    apartment: str | None = None
    sub_meter: str | None = None
    units: str | None = None
    description: str | None = None
    last_seen: datetime | None = None
