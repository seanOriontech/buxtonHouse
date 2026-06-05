import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RoomRoleBase(BaseModel):
    code: str
    name: str
    tone: str = "neutral"


class RoomRoleCreate(RoomRoleBase):
    pass


class RoomRoleUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    tone: str | None = None


class RoomRoleRead(RoomRoleBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
