import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.meter import UtilityType
from app.schemas.allowance_period import AllowancePeriodRead
from app.schemas.living_type import LivingTypeRead


class TariffBase(BaseModel):
    property_id: uuid.UUID
    period_id: uuid.UUID | None = None
    living_type_id: uuid.UUID | None = None
    utility_type: UtilityType | None = None
    starts_at: datetime
    ends_at: datetime | None = None
    unit_rate: Decimal
    currency: str = "ZAR"
    note: str | None = None


class TariffCreate(TariffBase):
    pass


class TariffUpdate(BaseModel):
    period_id: uuid.UUID | None = None
    living_type_id: uuid.UUID | None = None
    utility_type: UtilityType | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    unit_rate: Decimal | None = None
    currency: str | None = None
    note: str | None = None


class TariffRead(TariffBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    living_type: LivingTypeRead | None = None
    period: AllowancePeriodRead | None = None
    created_at: datetime
    updated_at: datetime
