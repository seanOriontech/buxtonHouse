"""Allowance periods — date-bounded windows that scope per-living-type allowances.

Revision ID: 0006_allowance_periods
Revises: 0005_living_type_allowances
Create Date: 2026-05-25
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_allowance_periods"
down_revision: str | Sequence[str] | None = "0005_living_type_allowances"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "allowance_periods",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_allowance_periods_starts_at", "allowance_periods", ["starts_at"])

    # Replace the old uniqueness with a period-aware one.
    op.drop_constraint(
        "uq_living_type_allowance",
        "living_type_allowances",
        type_="unique",
    )
    # The old `period` column was a cadence string (always "monthly"); the new
    # period concept is the FK to allowance_periods, so drop the legacy column
    # to avoid the name clash.
    op.drop_column("living_type_allowances", "period")
    op.add_column(
        "living_type_allowances",
        sa.Column("period_id", postgresql.UUID(as_uuid=True), nullable=False),
    )
    op.create_foreign_key(
        "fk_living_type_allowances_period",
        "living_type_allowances", "allowance_periods",
        ["period_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_living_type_allowances_period_id",
        "living_type_allowances",
        ["period_id"],
    )
    op.create_unique_constraint(
        "uq_living_type_allowance_period",
        "living_type_allowances",
        ["period_id", "living_type_id", "utility_type"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_living_type_allowance_period",
        "living_type_allowances",
        type_="unique",
    )
    op.drop_index("ix_living_type_allowances_period_id", table_name="living_type_allowances")
    op.drop_constraint(
        "fk_living_type_allowances_period",
        "living_type_allowances",
        type_="foreignkey",
    )
    op.drop_column("living_type_allowances", "period_id")
    op.add_column(
        "living_type_allowances",
        sa.Column("period", sa.String(20), nullable=False, server_default="monthly"),
    )
    op.create_unique_constraint(
        "uq_living_type_allowance",
        "living_type_allowances",
        ["living_type_id", "utility_type"],
    )

    op.drop_index("ix_allowance_periods_starts_at", table_name="allowance_periods")
    op.drop_table("allowance_periods")
