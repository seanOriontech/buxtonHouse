import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MeterInstallBase(BaseModel):
    meter_id: uuid.UUID
    physical_serial: str | None = None
    installed_at: datetime
    removed_at: datetime | None = None
    opening_reading: float | None = None
    closing_reading: float | None = None
    note: str | None = None


class MeterInstallCreate(MeterInstallBase):
    pass


class MeterInstallUpdate(BaseModel):
    physical_serial: str | None = None
    installed_at: datetime | None = None
    removed_at: datetime | None = None
    opening_reading: float | None = None
    closing_reading: float | None = None
    note: str | None = None


class MeterInstallRead(MeterInstallBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
