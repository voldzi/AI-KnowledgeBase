"""user profile STRATOS settings

Revision ID: 0009_user_profile_settings
Revises: 0008_assistant_sharing
Create Date: 2026-07-01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0009_user_profile_settings"
down_revision = "0008_assistant_sharing"
branch_labels = None
depends_on = None


def _json_type():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column(
        "user_profiles",
        sa.Column("settings", _json_type(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.alter_column("user_profiles", "settings", server_default=None)


def downgrade() -> None:
    op.drop_column("user_profiles", "settings")
