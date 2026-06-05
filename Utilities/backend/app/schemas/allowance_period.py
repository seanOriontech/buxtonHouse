import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AllowancePeriodBase(BaseModel):
    name: str | None = None
    starts_at: datetime
    ends_at: datetime | None = None


class AllowancePeriodCreate(AllowancePeriodBase):
    pass


class AllowancePeriodUpdate(BaseModel):
    name: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class AllowancePeriodRead(AllowancePeriodBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
