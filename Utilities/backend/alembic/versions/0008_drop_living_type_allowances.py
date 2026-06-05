"""Drop the unused living_type_allowances table.

Revision ID: 0008_drop_living_type_allowances
Revises: 0007_tariff_period
Create Date: 2026-05-25
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_drop_living_type_allowances"
down_revision: str | Sequence[str] | None = "0007_tariff_period"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("living_type_allowances")


def downgrade() -> None:
    utility_enum = postgresql.ENUM(
        "electricity", "hot_water", "cold_water", "gas", "other", "aux",
        "temperature", "level",
        name="utility_type",
        create_type=False,
    )
    op.create_table(
        "living_type_allowances",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "period_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("allowance_periods.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "living_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("living_types.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("utility_type", utility_enum, nullable=False),
        sa.Column("units_per_person", sa.Float, nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "period_id", "living_type_id", "utility_type",
            name="uq_living_type_allowance_period",
        ),
    )
    op.create_index(
        "ix_living_type_allowances_living_type_id",
        "living_type_allowances",
        ["living_type_id"],
    )
    op.create_index(
        "ix_living_type_allowances_period_id",
        "living_type_allowances",
        ["period_id"],
    )
