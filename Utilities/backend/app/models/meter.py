import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class UtilityType(str, enum.Enum):
    electricity = "electricity"
    hot_water = "hot_water"
    cold_water = "cold_water"
    gas = "gas"
    other = "other"
    aux = "aux"
    temperature = "temperature"
    level = "level"


class Meter(Base):
    __tablename__ = "meters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_id: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    utility_type: Mapped[UtilityType] = mapped_column(
        Enum(UtilityType, name="utility_type"), nullable=False
    )
    influx_measurement: Mapped[str] = mapped_column(String(120), nullable=False)
    units: Mapped[str | None] = mapped_column(String(40), nullable=True)
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True
    )
    parent_meter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meters.id", ondelete="SET NULL"), nullable=True
    )
    property_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("properties.id", ondelete="RESTRICT"), nullable=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_seen_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    room = relationship("Room", lazy="joined")
    parent_meter = relationship("Meter", remote_side="Meter.id", lazy="joined")
