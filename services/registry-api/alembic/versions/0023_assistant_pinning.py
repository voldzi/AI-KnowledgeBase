"""add server-owned assistant conversation pin state

Revision ID: 0023_assistant_pinning
Revises: 0022_assistant_feedback
Create Date: 2026-07-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0023_assistant_pinning"
down_revision = "0022_assistant_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assistant_conversations",
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_assistant_conversations_pinned_at",
        "assistant_conversations",
        ["pinned_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_assistant_conversations_pinned_at",
        table_name="assistant_conversations",
    )
    op.drop_column("assistant_conversations", "pinned_at")
