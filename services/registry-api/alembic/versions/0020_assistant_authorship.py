"""assistant directory sharing and message authorship

Revision ID: 0020_assistant_authorship
Revises: 0019_database_hardening
Create Date: 2026-07-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0020_assistant_authorship"
down_revision = "0019_database_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assistant_messages",
        sa.Column("author_subject_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "assistant_messages",
        sa.Column("author_subject_type", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "assistant_messages",
        sa.Column("author_display_name", sa.String(length=200), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE assistant_messages AS message "
            "SET author_subject_id = CASE "
            "WHEN message.role = 'assistant' THEN 'akb-assistant' "
            "ELSE conversation.user_id END, "
            "author_subject_type = CASE "
            "WHEN message.role = 'assistant' THEN 'service' ELSE 'user' END, "
            "author_display_name = CASE "
            "WHEN message.role = 'assistant' THEN 'AKB Assistant' "
            "ELSE (SELECT profile.display_name FROM user_profiles AS profile "
            "WHERE profile.user_id = conversation.user_id) END "
            "FROM assistant_conversations AS conversation "
            "WHERE conversation.conversation_id = message.conversation_id"
        )
    )
    op.alter_column("assistant_messages", "author_subject_id", nullable=False)
    op.alter_column("assistant_messages", "author_subject_type", nullable=False)
    op.create_check_constraint(
        "ck_assistant_messages_author_subject_type",
        "assistant_messages",
        "author_subject_type IN ('user', 'service')",
    )
    op.create_index(
        "ix_assistant_messages_author_created",
        "assistant_messages",
        ["author_subject_type", "author_subject_id", "created_at"],
    )

    op.add_column(
        "assistant_conversation_shares",
        sa.Column("subject_display_name", sa.String(length=200), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE assistant_conversation_shares AS share "
            "SET subject_display_name = profile.display_name "
            "FROM user_profiles AS profile "
            "WHERE share.subject_type = 'user' "
            "AND profile.user_id = share.subject_id"
        )
    )


def downgrade() -> None:
    op.drop_column("assistant_conversation_shares", "subject_display_name")
    op.drop_index(
        "ix_assistant_messages_author_created",
        table_name="assistant_messages",
    )
    op.drop_constraint(
        "ck_assistant_messages_author_subject_type",
        "assistant_messages",
        type_="check",
    )
    op.drop_column("assistant_messages", "author_display_name")
    op.drop_column("assistant_messages", "author_subject_type")
    op.drop_column("assistant_messages", "author_subject_id")
