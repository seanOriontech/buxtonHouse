"""properties + living_types + room_type/room column additions

Revision ID: 0002_multi_property
Revises: 0001_initial
Create Date: 2026-05-25
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_multi_property"
down_revision: str | Sequence[str] | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "properties",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(40), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("address", sa.Text, nullable=True),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="Africa/Johannesburg"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "living_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("abbreviation", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.add_column(
        "room_types",
        sa.Column("living_type_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_room_types_living_type",
        "room_types", "living_types",
        ["living_type_id"], ["id"],
        ondelete="RESTRICT",
    )
    op.add_column("room_types", sa.Column("occupancy", sa.Integer, nullable=False, server_default="1"))
    op.add_column("room_types", sa.Column("show_message", sa.Boolean, nullable=False, server_default=sa.false()))
    op.add_column("room_types", sa.Column("message", sa.Text, nullable=True))

    op.add_column(
        "rooms",
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_rooms_property",
        "rooms", "properties",
        ["property_id"], ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_rooms_property_id", "rooms", ["property_id"])
    op.add_column("rooms", sa.Column("number", sa.Integer, nullable=True))


def downgrade() -> None:
    op.drop_column("rooms", "number")
    op.drop_index("ix_rooms_property_id", table_name="rooms")
    op.drop_constraint("fk_rooms_property", "rooms", type_="foreignkey")
    op.drop_column("rooms", "property_id")

    op.drop_column("room_types", "message")
    op.drop_column("room_types", "show_message")
    op.drop_column("room_types", "occupancy")
    op.drop_constraint("fk_room_types_living_type", "room_types", type_="foreignkey")
    op.drop_column("room_types", "living_type_id")

    op.drop_table("living_types")
    op.drop_table("properties")
