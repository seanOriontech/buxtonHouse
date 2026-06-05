"""Link tariffs to allowance periods so a period scopes both rates and allowances.

Revision ID: 0007_tariff_period
Revises: 0006_allowance_periods
Create Date: 2026-05-25
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_tariff_period"
down_revision: str | Sequence[str] | None = "0006_allowance_periods"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tariffs",
        sa.Column("period_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_tariffs_period",
        "tariffs", "allowance_periods",
        ["period_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_tariffs_period_id", "tariffs", ["period_id"])


def downgrade() -> None:
    op.drop_index("ix_tariffs_period_id", table_name="tariffs")
    op.drop_constraint("fk_tariffs_period", "tariffs", type_="foreignkey")
    op.drop_column("tariffs", "period_id")
