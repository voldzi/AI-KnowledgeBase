"""enforce assistant conversation retention deadlines

Revision ID: 0021_assistant_retention_enforcement
Revises: 0020_assistant_directory_authorship
Create Date: 2026-07-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0021_assistant_retention_enforcement"
down_revision = "0020_assistant_directory_authorship"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing conversations receive a fresh migration-time grace period. This
    # avoids unexpectedly purging historical rows immediately after rollout.
    op.execute(
        sa.text(
            "UPDATE assistant_conversations "
            "SET retention_until = CURRENT_TIMESTAMP + INTERVAL '180 days' "
            "WHERE retention_until IS NULL"
        )
    )
    op.alter_column(
        "assistant_conversations",
        "retention_until",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "assistant_conversations",
        "retention_until",
        existing_type=sa.DateTime(timezone=True),
        nullable=True,
    )
