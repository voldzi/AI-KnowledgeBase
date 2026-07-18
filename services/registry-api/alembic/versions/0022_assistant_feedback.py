"""add privacy-safe assistant response feedback

Revision ID: 0022_assistant_feedback
Revises: 0021_assistant_retention
Create Date: 2026-07-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0022_assistant_feedback"
down_revision = "0021_assistant_retention"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_message_feedback",
        sa.Column("feedback_id", sa.String(length=64), nullable=False),
        sa.Column("conversation_id", sa.String(length=80), nullable=False),
        sa.Column("message_id", sa.String(length=64), nullable=False),
        sa.Column("actor_id", sa.String(length=128), nullable=False),
        sa.Column("rating", sa.String(length=32), nullable=False),
        sa.Column("reason_code", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "rating IN ('helpful', 'not_helpful')",
            name="assistant_message_feedback_rating",
        ),
        sa.CheckConstraint(
            "reason_code IS NULL OR reason_code IN "
            "('accurate_useful', 'incomplete', 'incorrect', "
            "'citation_problem', 'access_problem', 'other')",
            name="assistant_message_feedback_reason",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["assistant_conversations.conversation_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["assistant_messages.message_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("feedback_id"),
        sa.UniqueConstraint(
            "message_id",
            "actor_id",
            name="uq_assistant_message_feedback_actor",
        ),
    )
    op.create_index(
        "ix_assistant_message_feedback_actor_id",
        "assistant_message_feedback",
        ["actor_id"],
        unique=False,
    )
    op.create_index(
        "ix_assistant_message_feedback_rating",
        "assistant_message_feedback",
        ["rating"],
        unique=False,
    )
    op.create_index(
        "ix_assistant_message_feedback_reason_code",
        "assistant_message_feedback",
        ["reason_code"],
        unique=False,
    )
    op.create_index(
        "ix_assistant_message_feedback_conversation_created",
        "assistant_message_feedback",
        ["conversation_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_assistant_message_feedback_conversation_created",
        table_name="assistant_message_feedback",
    )
    op.drop_index(
        "ix_assistant_message_feedback_reason_code",
        table_name="assistant_message_feedback",
    )
    op.drop_index(
        "ix_assistant_message_feedback_rating",
        table_name="assistant_message_feedback",
    )
    op.drop_index(
        "ix_assistant_message_feedback_actor_id",
        table_name="assistant_message_feedback",
    )
    op.drop_table("assistant_message_feedback")
