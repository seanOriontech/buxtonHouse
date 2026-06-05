import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LivingTypeBase(BaseModel):
    name: str
    abbreviation: str | None = None
    water_daily_litres_per_person: float | None = None


class LivingTypeCreate(LivingTypeBase):
    pass


class LivingTypeUpdate(BaseModel):
    name: str | None = None
    abbreviation: str | None = None
    water_daily_litres_per_person: float | None = None


class LivingTypeRead(LivingTypeBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
