import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PropertyBase(BaseModel):
    code: str
    name: str
    address: str | None = None
    timezone: str = "Africa/Johannesburg"


class PropertyCreate(PropertyBase):
    pass


class PropertyUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    address: str | None = None
    timezone: str | None = None


class PropertyRead(PropertyBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
