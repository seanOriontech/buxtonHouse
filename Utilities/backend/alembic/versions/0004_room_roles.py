"""room_roles lookup + rooms.role_id

Revision ID: 0004_room_roles
Revises: 0003_meter_hierarchy
Create Date: 2026-05-25
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_room_roles"
down_revision: str | Sequence[str] | None = "0003_meter_hierarchy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "room_roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(40), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("tone", sa.String(20), nullable=False, server_default="neutral"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column(
        "rooms",
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_rooms_role",
        "rooms", "room_roles",
        ["role_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_rooms_role_id", "rooms", ["role_id"])

    # Seed defaults so the UI has options on first boot.
    op.execute(
        """
        INSERT INTO room_roles (id, code, name, tone) VALUES
          (gen_random_uuid(), 'caretaker', 'Caretaker',     'amber'),
          (gen_random_uuid(), 'office',    'Office',        'sky'),
          (gen_random_uuid(), 'staff',     'Staff Quarters','emerald'),
          (gen_random_uuid(), 'storage',   'Storage',       'neutral');
        """
    )


def downgrade() -> None:
    op.drop_index("ix_rooms_role_id", table_name="rooms")
    op.drop_constraint("fk_rooms_role", "rooms", type_="foreignkey")
    op.drop_column("rooms", "role_id")
    op.drop_table("room_roles")
