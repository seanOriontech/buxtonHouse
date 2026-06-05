import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AllowanceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    living_type_id: uuid.UUID
    utility_type: str
    units_per_person: float
    period: str
    note: str | None = None
    created_at: datetime
    updated_at: datetime


class AllowanceUpsert(BaseModel):
    """Upsert is keyed by (living_type_id, utility_type, period).

    period must be one of: "daily" | "monthly".
    """

    living_type_id: uuid.UUID
    utility_type: str
    units_per_person: float
    period: str = "monthly"
    note: str | None = None
