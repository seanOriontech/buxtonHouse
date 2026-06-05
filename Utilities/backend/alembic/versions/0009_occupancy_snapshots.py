"""occupancy_snapshots table — daily per-room occupancy from source MSSQL

Revision ID: 0009_occupancy_snapshots
Revises: 0008_drop_living_type_allowances
Create Date: 2026-05-25
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_occupancy_snapshots"
down_revision: str | Sequence[str] | None = "0008_drop_living_type_allowances"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "occupancy_snapshots",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("snapshot_date", sa.Date, nullable=False),
        sa.Column("source_room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("apartment_number", sa.Integer, nullable=False),
        sa.Column("living_type", sa.String(40), nullable=False),
        sa.Column("room_number", sa.Integer, nullable=False),
        sa.Column("room_type", sa.String(80), nullable=False),
        sa.Column("beds", sa.SmallInteger, nullable=False),
        sa.Column("occupants", sa.SmallInteger, nullable=False),
        sa.Column("under_maintenance", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("captured_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("snapshot_date", "source_room_id", name="uq_occupancy_snapshot_room_date"),
    )
    op.create_index("ix_occupancy_snapshots_date", "occupancy_snapshots", ["snapshot_date"])
    op.create_index("ix_occupancy_snapshots_room", "occupancy_snapshots", ["source_room_id"])


def downgrade() -> None:
    op.drop_index("ix_occupancy_snapshots_room", table_name="occupancy_snapshots")
    op.drop_index("ix_occupancy_snapshots_date", table_name="occupancy_snapshots")
    op.drop_table("occupancy_snapshots")
