"""workflow tasks

Revision ID: 0002_workflow_tasks
Revises: 0001_initial_registry
Create Date: 2026-06-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_workflow_tasks"
down_revision = "0001_initial_registry"
branch_labels = None
depends_on = None


def _json_type():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "workflow_tasks",
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("source_key", sa.String(length=220), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("priority", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=160), nullable=False),
        sa.Column("owner_id", sa.String(length=128), nullable=True),
        sa.Column("owner_label", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=120), nullable=False),
        sa.Column("document_id", sa.String(length=64), nullable=True),
        sa.Column("document_title", sa.String(length=300), nullable=True),
        sa.Column("document_version_id", sa.String(length=64), nullable=True),
        sa.Column("audit_event_id", sa.String(length=64), nullable=True),
        sa.Column("job_id", sa.String(length=128), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", _json_type(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.document_id"],
            name="fk_workflow_tasks_document_id_documents",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("task_id", name="pk_workflow_tasks"),
        sa.UniqueConstraint("source_key", name="uq_workflow_tasks_source_key"),
    )
    op.create_index("ix_workflow_tasks_audit_event_id", "workflow_tasks", ["audit_event_id"])
    op.create_index("ix_workflow_tasks_document_id", "workflow_tasks", ["document_id"])
    op.create_index("ix_workflow_tasks_document_status", "workflow_tasks", ["document_id", "status"])
    op.create_index("ix_workflow_tasks_due_at", "workflow_tasks", ["due_at"])
    op.create_index("ix_workflow_tasks_job_id", "workflow_tasks", ["job_id"])
    op.create_index("ix_workflow_tasks_kind", "workflow_tasks", ["kind"])
    op.create_index("ix_workflow_tasks_owner_id", "workflow_tasks", ["owner_id"])
    op.create_index("ix_workflow_tasks_owner_status", "workflow_tasks", ["owner_id", "status"])
    op.create_index("ix_workflow_tasks_priority", "workflow_tasks", ["priority"])
    op.create_index("ix_workflow_tasks_status", "workflow_tasks", ["status"])
    op.create_index("ix_workflow_tasks_status_priority", "workflow_tasks", ["status", "priority"])


def downgrade() -> None:
    op.drop_index("ix_workflow_tasks_status_priority", table_name="workflow_tasks")
    op.drop_index("ix_workflow_tasks_status", table_name="workflow_tasks")
    op.drop_index("ix_workflow_tasks_priority", table_name="workflow_tasks")
    op.drop_index("ix_workflow_tasks_owner_status", table_name="workflow_tasks")
    op.drop_index("ix_workflow_tasks_owner_id", table_name="workflow_tasks")
    op.drop_index("ix_workflow_tasks_kind", table_name="workflow_tasks")
    op.drop_index("ix_workflow_tasks_job_id", table_name="workflow_tasks")
    op.drop_index("ix_workflow_tasks_due_at", table_name="workflow_tasks")
    op.drop_index("ix_workflow_tasks_document_status", table_name="workflow_tasks")
    op.drop_index("ix_workflow_tasks_document_id", table_name="workflow_tasks")
    op.drop_index("ix_workflow_tasks_audit_event_id", table_name="workflow_tasks")
    op.drop_table("workflow_tasks")
