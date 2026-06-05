import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.property import PropertyRead
from app.schemas.room_role import RoomRoleRead
from app.schemas.room_type import RoomTypeRead


class RoomBase(BaseModel):
    code: str
    name: str
    number: int | None = None
    room_type_id: uuid.UUID
    parent_room_id: uuid.UUID | None = None
    property_id: uuid.UUID | None = None
    role_id: uuid.UUID | None = None
    notes: str | None = None


class RoomCreate(RoomBase):
    pass


class RoomUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    number: int | None = None
    room_type_id: uuid.UUID | None = None
    parent_room_id: uuid.UUID | None = None
    property_id: uuid.UUID | None = None
    role_id: uuid.UUID | None = None
    notes: str | None = None


class RoomRead(RoomBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    room_type: RoomTypeRead
    property: PropertyRead | None = None
    role: RoomRoleRead | None = None
    created_at: datetime
    updated_at: datetime
