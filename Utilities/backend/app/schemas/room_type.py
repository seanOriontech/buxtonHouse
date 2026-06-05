import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.room_type import RoomCategory
from app.schemas.living_type import LivingTypeRead


class RoomTypeBase(BaseModel):
    name: str
    category: RoomCategory
    shareable: bool = False
    living_type_id: uuid.UUID | None = None
    occupancy: int = 1
    show_message: bool = False
    message: str | None = None


class RoomTypeCreate(RoomTypeBase):
    pass


class RoomTypeUpdate(BaseModel):
    name: str | None = None
    category: RoomCategory | None = None
    shareable: bool | None = None
    living_type_id: uuid.UUID | None = None
    occupancy: int | None = None
    show_message: bool | None = None
    message: str | None = None


class RoomTypeRead(RoomTypeBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    living_type: LivingTypeRead | None = None
    created_at: datetime
    updated_at: datetime
