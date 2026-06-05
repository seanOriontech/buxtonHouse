import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class RoomCategory(str, enum.Enum):
    apartment = "apartment"
    apartment_room = "apartment_room"
    communal = "communal"
    facility = "facility"


class RoomType(Base):
    __tablename__ = "room_types"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    category: Mapped[RoomCategory] = mapped_column(
        Enum(RoomCategory, name="room_category"), nullable=False
    )
    shareable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    living_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("living_types.id", ondelete="RESTRICT"), nullable=True
    )
    occupancy: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    show_message: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    living_type = relationship("LivingType", lazy="joined")
