"""document extraction persistence

Revision ID: 0007_document_extractions
Revises: 0006_assistant_conversations
Create Date: 2026-06-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0007_document_extractions"
down_revision = "0006_assistant_conversations"
branch_labels = None
depends_on = None


def _json_type():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "document_extractions",
        sa.Column("extraction_id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=128), nullable=False),
        sa.Column("external_system", sa.String(length=80), nullable=False),
        sa.Column("external_ref", sa.String(length=240), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("document_id", sa.String(length=64), nullable=False),
        sa.Column("document_version_id", sa.String(length=64), nullable=False),
        sa.Column("profile", sa.String(length=80), nullable=False),
        sa.Column("profile_version", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("classification", sa.String(length=32), nullable=False),
        sa.Column("requested_by", sa.String(length=128), nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("result", _json_type(), nullable=False),
        sa.Column("missing_information", _json_type(), nullable=False),
        sa.Column("warnings", _json_type(), nullable=False),
        sa.Column("metadata", _json_type(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.document_id"],
            name="fk_document_extractions_document_id_documents",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["document_version_id"],
            ["document_versions.document_version_id"],
            name="fk_document_extractions_document_version_id_document_versions",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("extraction_id", name="pk_document_extractions"),
        sa.UniqueConstraint(
            "tenant_id",
            "external_system",
            "external_ref",
            "document_id",
            "document_version_id",
            "profile",
            "profile_version",
            name="uq_document_extraction_identity",
        ),
    )
    op.create_index("ix_document_extractions_requested_by", "document_extractions", ["requested_by"])
    op.create_index("ix_document_extractions_status", "document_extractions", ["status"])
    op.create_index("ix_document_extractions_correlation_id", "document_extractions", ["correlation_id"])
    op.create_index(
        "ix_document_extractions_document_version",
        "document_extractions",
        ["document_id", "document_version_id"],
    )
    op.create_index(
        "ix_document_extractions_entity",
        "document_extractions",
        ["tenant_id", "external_system", "entity_type", "entity_id"],
    )

    op.create_table(
        "document_extraction_feedback",
        sa.Column("feedback_id", sa.String(length=64), nullable=False),
        sa.Column("extraction_id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=128), nullable=False),
        sa.Column("field", sa.String(length=160), nullable=False),
        sa.Column("ai_value", _json_type(), nullable=True),
        sa.Column("final_value", _json_type(), nullable=True),
        sa.Column("decision", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("actor_id", sa.String(length=128), nullable=False),
        sa.Column("source_app", sa.String(length=80), nullable=False),
        sa.Column("source_entity_id", sa.String(length=128), nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("metadata", _json_type(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["extraction_id"],
            ["document_extractions.extraction_id"],
            name="fk_document_extraction_feedback_extraction_id_document_extractions",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("feedback_id", name="pk_document_extraction_feedback"),
    )
    op.create_index("ix_document_extraction_feedback_actor_id", "document_extraction_feedback", ["actor_id"])
    op.create_index("ix_document_extraction_feedback_created_at", "document_extraction_feedback", ["created_at"])
    op.create_index("ix_document_extraction_feedback_decision", "document_extraction_feedback", ["decision"])
    op.create_index("ix_document_extraction_feedback_correlation_id", "document_extraction_feedback", ["correlation_id"])
    op.create_index(
        "ix_document_extraction_feedback_extraction",
        "document_extraction_feedback",
        ["extraction_id", "created_at"],
    )
    op.create_index(
        "ix_document_extraction_feedback_source",
        "document_extraction_feedback",
        ["source_app", "source_entity_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_document_extraction_feedback_source", table_name="document_extraction_feedback")
    op.drop_index("ix_document_extraction_feedback_extraction", table_name="document_extraction_feedback")
    op.drop_index("ix_document_extraction_feedback_correlation_id", table_name="document_extraction_feedback")
    op.drop_index("ix_document_extraction_feedback_decision", table_name="document_extraction_feedback")
    op.drop_index("ix_document_extraction_feedback_created_at", table_name="document_extraction_feedback")
    op.drop_index("ix_document_extraction_feedback_actor_id", table_name="document_extraction_feedback")
    op.drop_table("document_extraction_feedback")

    op.drop_index("ix_document_extractions_entity", table_name="document_extractions")
    op.drop_index("ix_document_extractions_document_version", table_name="document_extractions")
    op.drop_index("ix_document_extractions_correlation_id", table_name="document_extractions")
    op.drop_index("ix_document_extractions_status", table_name="document_extractions")
    op.drop_index("ix_document_extractions_requested_by", table_name="document_extractions")
    op.drop_table("document_extractions")
