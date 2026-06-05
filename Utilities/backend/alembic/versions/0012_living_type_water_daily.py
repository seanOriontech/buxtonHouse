"""Combined-water daily limit per person on living_types.

A single ℓ/person/day cap on hot + cold combined. The monthly equivalent is
computed at read time as daily × days_in_month. Supersedes the previous
per-utility hot_water / cold_water rows in living_type_allowances, which we
delete to avoid confusion.

Revision ID: 0012_living_type_water_daily
Revises: 0011_allowance_period_unique
Create Date: 2026-05-26
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_living_type_water_daily"
down_revision: str | Sequence[str] | None = "0011_allowance_period_unique"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "living_types",
        sa.Column("water_daily_litres_per_person", sa.Float, nullable=True),
    )
    # Clean up: the combined limit replaces the previous separate hot/cold rows.
    op.execute(
        "DELETE FROM living_type_allowances WHERE utility_type IN ('hot_water', 'cold_water')"
    )


def downgrade() -> None:
    op.drop_column("living_types", "water_daily_litres_per_person")
