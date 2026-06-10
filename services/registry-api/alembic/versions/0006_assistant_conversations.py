"""assistant conversation persistence

Revision ID: 0006_assistant_conversations
Revises: 0005_stratos_identity_access
Create Date: 2026-06-10
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_assistant_conversations"
down_revision = "0005_stratos_identity_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_conversations",
        sa.Column("conversation_id", sa.String(length=80), primary_key=True),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("title", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_assistant_conversations_user_id", "assistant_conversations", ["user_id"])
    op.create_index("ix_assistant_conversations_status", "assistant_conversations", ["status"])

    op.create_table(
        "assistant_messages",
        sa.Column("message_id", sa.String(length=64), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(length=80),
            sa.ForeignKey("assistant_conversations.conversation_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("response_type", sa.String(length=64), nullable=True),
        sa.Column("citations", sa.JSON(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_assistant_messages_created_at", "assistant_messages", ["created_at"])
    op.create_index(
        "ix_assistant_messages_conversation_created",
        "assistant_messages",
        ["conversation_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_assistant_messages_conversation_created", table_name="assistant_messages")
    op.drop_index("ix_assistant_messages_created_at", table_name="assistant_messages")
    op.drop_table("assistant_messages")
    op.drop_index("ix_assistant_conversations_status", table_name="assistant_conversations")
    op.drop_index("ix_assistant_conversations_user_id", table_name="assistant_conversations")
    op.drop_table("assistant_conversations")
