"""assistant conversation sharing and retention

Revision ID: 0008_assistant_sharing
Revises: 0007_document_extractions
Create Date: 2026-06-22
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_assistant_sharing"
down_revision = "0007_document_extractions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assistant_conversations",
        sa.Column("visibility", sa.String(length=32), nullable=False, server_default="private"),
    )
    op.add_column(
        "assistant_conversations",
        sa.Column("retention_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "assistant_conversations",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_assistant_conversations_visibility", "assistant_conversations", ["visibility"])
    op.create_index("ix_assistant_conversations_retention_until", "assistant_conversations", ["retention_until"])

    op.create_table(
        "assistant_conversation_shares",
        sa.Column("conversation_share_id", sa.String(length=64), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(length=80),
            sa.ForeignKey("assistant_conversations.conversation_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("subject_type", sa.String(length=32), nullable=False, server_default="user"),
        sa.Column("subject_id", sa.String(length=128), nullable=False),
        sa.Column("permission", sa.String(length=32), nullable=False, server_default="viewer"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("created_by", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "conversation_id",
            "subject_type",
            "subject_id",
            name="uq_assistant_conversation_share_subject",
        ),
    )
    op.create_index(
        "ix_assistant_conversation_shares_subject",
        "assistant_conversation_shares",
        ["subject_type", "subject_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_assistant_conversation_shares_subject", table_name="assistant_conversation_shares")
    op.drop_table("assistant_conversation_shares")
    op.drop_index("ix_assistant_conversations_retention_until", table_name="assistant_conversations")
    op.drop_index("ix_assistant_conversations_visibility", table_name="assistant_conversations")
    op.drop_column("assistant_conversations", "archived_at")
    op.drop_column("assistant_conversations", "retention_until")
    op.drop_column("assistant_conversations", "visibility")
