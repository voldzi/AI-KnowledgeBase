"""document assignments

Revision ID: 0003_document_assignments
Revises: 0002_workflow_tasks
Create Date: 2026-06-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0003_document_assignments"
down_revision = "0002_workflow_tasks"
branch_labels = None
depends_on = None


def _json_type():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "document_assignments",
        sa.Column("assignment_id", sa.String(length=64), nullable=False),
        sa.Column("document_id", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False),
        sa.Column("subject_type", sa.String(length=32), nullable=False),
        sa.Column("subject_id", sa.String(length=128), nullable=False),
        sa.Column("display_label", sa.String(length=200), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("sla_days", sa.Integer(), nullable=True),
        sa.Column("escalation_subject_type", sa.String(length=32), nullable=True),
        sa.Column("escalation_subject_id", sa.String(length=128), nullable=True),
        sa.Column("escalation_label", sa.String(length=200), nullable=True),
        sa.Column("assigned_by", sa.String(length=128), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_audit_event_id", sa.String(length=64), nullable=True),
        sa.Column("metadata", _json_type(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.document_id"],
            name="fk_document_assignments_document_id_documents",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("assignment_id", name="pk_document_assignments"),
        sa.UniqueConstraint(
            "document_id",
            "role",
            "subject_type",
            "subject_id",
            name="uq_document_assignment_subject_role",
        ),
    )
    op.create_index("ix_document_assignments_active", "document_assignments", ["active"])
    op.create_index("ix_document_assignments_document_id", "document_assignments", ["document_id"])
    op.create_index(
        "ix_document_assignments_document_role",
        "document_assignments",
        ["document_id", "role"],
    )
    op.create_index("ix_document_assignments_last_audit_event_id", "document_assignments", ["last_audit_event_id"])
    op.create_index("ix_document_assignments_role", "document_assignments", ["role"])
    op.create_index("ix_document_assignments_subject_id", "document_assignments", ["subject_id"])
    op.create_index("ix_document_assignments_subject_type", "document_assignments", ["subject_type"])
    op.create_index(
        "ix_document_assignments_subject",
        "document_assignments",
        ["subject_type", "subject_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_document_assignments_subject", table_name="document_assignments")
    op.drop_index("ix_document_assignments_subject_type", table_name="document_assignments")
    op.drop_index("ix_document_assignments_subject_id", table_name="document_assignments")
    op.drop_index("ix_document_assignments_role", table_name="document_assignments")
    op.drop_index("ix_document_assignments_last_audit_event_id", table_name="document_assignments")
    op.drop_index("ix_document_assignments_document_role", table_name="document_assignments")
    op.drop_index("ix_document_assignments_document_id", table_name="document_assignments")
    op.drop_index("ix_document_assignments_active", table_name="document_assignments")
    op.drop_table("document_assignments")
