"""Add explicit parent lineage to assistant messages.

Revision ID: 0030_assistant_lineage
Revises: 0029_intake_cleanup_fences

Existing messages remain valid roots. New turns can bind a user follow-up to
the exact assistant answer whose authorized evidence frame it inherits.
"""

from alembic import op
import sqlalchemy as sa


revision = "0030_assistant_lineage"
down_revision = "0029_intake_cleanup_fences"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "assistant_messages",
        sa.Column("parent_message_id", sa.String(length=64), nullable=True),
    )
    op.create_foreign_key(
        "fk_assistant_messages_parent_message_id",
        "assistant_messages",
        "assistant_messages",
        ["parent_message_id"],
        ["message_id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_assistant_messages_parent_message_id",
        "assistant_messages",
        ["parent_message_id"],
    )


def downgrade():
    op.drop_index(
        "ix_assistant_messages_parent_message_id",
        table_name="assistant_messages",
    )
    op.drop_constraint(
        "fk_assistant_messages_parent_message_id",
        "assistant_messages",
        type_="foreignkey",
    )
    op.drop_column("assistant_messages", "parent_message_id")
