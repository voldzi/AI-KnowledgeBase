"""external document references

Revision ID: 0004_external_document_refs
Revises: 0003_document_assignments
Create Date: 2026-06-07
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0004_external_document_refs"
down_revision = "0003_document_assignments"
branch_labels = None
depends_on = None


def _json_type():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "external_document_refs",
        sa.Column("external_document_id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=128), nullable=False),
        sa.Column("source_system", sa.String(length=80), nullable=False),
        sa.Column("external_ref", sa.String(length=240), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("document_id", sa.String(length=64), nullable=False),
        sa.Column("current_document_version_id", sa.String(length=64), nullable=True),
        sa.Column("current_file_id", sa.String(length=64), nullable=True),
        sa.Column("current_ingestion_job_id", sa.String(length=128), nullable=True),
        sa.Column("current_ingestion_status", sa.String(length=40), nullable=True),
        sa.Column("akb_source_uri", sa.String(length=1024), nullable=True),
        sa.Column("citation_base_url", sa.String(length=512), nullable=True),
        sa.Column("metadata", _json_type(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.document_id"],
            name="fk_external_document_refs_document_id_documents",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("external_document_id", name="pk_external_document_refs"),
        sa.UniqueConstraint(
            "tenant_id",
            "source_system",
            "external_ref",
            name="uq_external_document_ref_identity",
        ),
    )
    op.create_index("ix_external_document_refs_document", "external_document_refs", ["document_id"])
    op.create_index(
        "ix_external_document_refs_entity",
        "external_document_refs",
        ["tenant_id", "entity_type", "entity_id"],
    )
    op.create_index(
        "ix_external_document_refs_ingestion_status",
        "external_document_refs",
        ["current_ingestion_status"],
    )
    op.create_index("ix_external_document_refs_document_id", "external_document_refs", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_external_document_refs_document_id", table_name="external_document_refs")
    op.drop_index("ix_external_document_refs_ingestion_status", table_name="external_document_refs")
    op.drop_index("ix_external_document_refs_entity", table_name="external_document_refs")
    op.drop_index("ix_external_document_refs_document", table_name="external_document_refs")
    op.drop_table("external_document_refs")
