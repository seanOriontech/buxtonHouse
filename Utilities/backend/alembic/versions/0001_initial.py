"""initial schema + seed room types

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-25
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ROOM_CATEGORY = postgresql.ENUM(
    "apartment", "apartment_room", "communal", "facility",
    name="room_category", create_type=False,
)
UTILITY_TYPE = postgresql.ENUM(
    "electricity", "hot_water", "cold_water", "gas", "other",
    name="utility_type", create_type=False,
)


def upgrade() -> None:
    op.execute("CREATE TYPE room_category AS ENUM ('apartment', 'apartment_room', 'communal', 'facility')")
    op.execute("CREATE TYPE utility_type AS ENUM ('electricity', 'hot_water', 'cold_water', 'gas', 'other')")

    op.create_table(
        "room_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("category", ROOM_CATEGORY, nullable=False),
        sa.Column("shareable", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "rooms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(80), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column(
            "room_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("room_types.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "parent_room_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("rooms.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_rooms_parent_room_id", "rooms", ["parent_room_id"])

    op.create_table(
        "meters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("external_id", sa.String(120), nullable=False, unique=True),
        sa.Column("utility_type", UTILITY_TYPE, nullable=False),
        sa.Column("influx_measurement", sa.String(120), nullable=False),
        sa.Column("units", sa.String(40), nullable=True),
        sa.Column(
            "room_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("rooms.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_meters_room_id", "meters", ["room_id"])

    # Seed canonical room types so the UI has populated dropdowns on first boot.
    op.execute(
        """
        INSERT INTO room_types (id, name, category, shareable) VALUES
          (gen_random_uuid(), 'Apartment', 'apartment', false),
          (gen_random_uuid(), 'Single Bedroom', 'apartment_room', false),
          (gen_random_uuid(), 'Sharing Bedroom', 'apartment_room', true),
          (gen_random_uuid(), 'Kitchen', 'apartment_room', false),
          (gen_random_uuid(), 'Bathroom', 'apartment_room', false),
          (gen_random_uuid(), 'Communal Lounge', 'communal', true),
          (gen_random_uuid(), 'Communal Kitchen', 'communal', true),
          (gen_random_uuid(), 'Gym', 'communal', true),
          (gen_random_uuid(), 'Laundry', 'communal', true),
          (gen_random_uuid(), 'Facility', 'facility', false);
        """
    )


def downgrade() -> None:
    op.drop_index("ix_meters_room_id", table_name="meters")
    op.drop_table("meters")
    op.drop_index("ix_rooms_parent_room_id", table_name="rooms")
    op.drop_table("rooms")
    op.drop_table("room_types")
    op.execute("DROP TYPE IF EXISTS utility_type")
    op.execute("DROP TYPE IF EXISTS room_category")
