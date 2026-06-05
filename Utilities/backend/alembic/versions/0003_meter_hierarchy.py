"""meter hierarchy + meter_installs + tariffs, widen utility_type

Revision ID: 0003_meter_hierarchy
Revises: 0002_multi_property
Create Date: 2026-05-25
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_meter_hierarchy"
down_revision: str | Sequence[str] | None = "0002_multi_property"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Widen the utility_type enum to cover what the source DB has (PotableWaterTank_Level etc.)
    op.execute("ALTER TYPE utility_type ADD VALUE IF NOT EXISTS 'aux'")
    op.execute("ALTER TYPE utility_type ADD VALUE IF NOT EXISTS 'temperature'")
    op.execute("ALTER TYPE utility_type ADD VALUE IF NOT EXISTS 'level'")

    op.add_column(
        "meters",
        sa.Column("parent_meter_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_meters_parent",
        "meters", "meters",
        ["parent_meter_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_meters_parent_meter_id", "meters", ["parent_meter_id"])

    op.add_column(
        "meters",
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_meters_property",
        "meters", "properties",
        ["property_id"], ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_meters_property_id", "meters", ["property_id"])

    op.add_column("meters", sa.Column("name", sa.String(200), nullable=True))
    op.add_column("meters", sa.Column("last_seen_value", sa.Float, nullable=True))
    op.add_column("meters", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "meter_installs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "meter_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("meters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("physical_serial", sa.String(120), nullable=True),
        sa.Column("installed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opening_reading", sa.Float, nullable=True),
        sa.Column("closing_reading", sa.Float, nullable=True),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_meter_installs_meter_id", "meter_installs", ["meter_id"])
    op.create_index(
        "ix_meter_installs_meter_id_installed_at",
        "meter_installs",
        ["meter_id", "installed_at"],
    )

    op.create_table(
        "tariffs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "property_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("properties.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "living_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("living_types.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "utility_type",
            postgresql.ENUM(
                "electricity", "hot_water", "cold_water", "gas", "other",
                "aux", "temperature", "level",
                name="utility_type", create_type=False,
            ),
            nullable=True,
        ),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unit_rate", sa.Numeric(12, 4), nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="ZAR"),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_tariffs_property_living_utility",
        "tariffs",
        ["property_id", "living_type_id", "utility_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_tariffs_property_living_utility", table_name="tariffs")
    op.drop_table("tariffs")
    op.drop_index("ix_meter_installs_meter_id_installed_at", table_name="meter_installs")
    op.drop_index("ix_meter_installs_meter_id", table_name="meter_installs")
    op.drop_table("meter_installs")

    op.drop_column("meters", "last_seen_at")
    op.drop_column("meters", "last_seen_value")
    op.drop_column("meters", "name")

    op.drop_index("ix_meters_property_id", table_name="meters")
    op.drop_constraint("fk_meters_property", "meters", type_="foreignkey")
    op.drop_column("meters", "property_id")

    op.drop_index("ix_meters_parent_meter_id", table_name="meters")
    op.drop_constraint("fk_meters_parent", "meters", type_="foreignkey")
    op.drop_column("meters", "parent_meter_id")

    # NOTE: Postgres can't drop a single enum value cleanly; we leave the
    # widened utility_type alone on downgrade. Safe because new values are
    # additive.
