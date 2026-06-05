"""Allow daily + monthly allowances per (living_type, utility).

Drops the old uq_living_type_allowance unique on (living_type_id, utility_type)
and replaces it with one on (living_type_id, utility_type, period). Lets us
store a daily AND a monthly cap for the same utility.

Revision ID: 0011_allowance_period_unique
Revises: 0010_living_type_allowances
Create Date: 2026-05-26
"""
from collections.abc import Sequence

from alembic import op

revision: str = "0011_allowance_period_unique"
down_revision: str | Sequence[str] | None = "0010_living_type_allowances"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("uq_living_type_allowance", "living_type_allowances", type_="unique")
    op.create_unique_constraint(
        "uq_living_type_allowance",
        "living_type_allowances",
        ["living_type_id", "utility_type", "period"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_living_type_allowance", "living_type_allowances", type_="unique")
    op.create_unique_constraint(
        "uq_living_type_allowance",
        "living_type_allowances",
        ["living_type_id", "utility_type"],
    )
