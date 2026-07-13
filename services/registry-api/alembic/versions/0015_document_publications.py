"""add immutable AKB document publications

Revision ID: 0015_document_publications
Revises: 0014_governed_resources
Create Date: 2026-07-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0015_document_publications"
down_revision = "0014_governed_resources"
branch_labels = None
depends_on = None


def json_type():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "document_publications",
        sa.Column("publication_id", sa.String(length=64), nullable=False),
        sa.Column("document_id", sa.String(length=64), nullable=False),
        sa.Column("document_version_id", sa.String(length=64), nullable=False),
        sa.Column("public_slug", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("snapshot_schema", sa.String(length=80), nullable=False),
        sa.Column("public_snapshot", json_type(), nullable=False),
        sa.Column("public_snapshot_hash", sa.String(length=80), nullable=False),
        sa.Column("source_file_uri", sa.String(length=1024), nullable=False),
        sa.Column("source_file_hash", sa.String(length=80), nullable=False),
        sa.Column("source_filename", sa.String(length=300), nullable=False),
        sa.Column("source_mime_type", sa.String(length=160), nullable=False),
        sa.Column("source_size_bytes", sa.Integer(), nullable=False),
        sa.Column("governed_resource_id", sa.String(length=128), nullable=False),
        sa.Column("source_version", sa.String(length=160), nullable=False),
        sa.Column("policy_binding_id", sa.String(length=160), nullable=False),
        sa.Column("policy_version", sa.String(length=80), nullable=False),
        sa.Column("policy_hash", sa.String(length=80), nullable=False),
        sa.Column("central_publication_id", sa.String(length=128), nullable=False),
        sa.Column("approved_by", sa.String(length=128), nullable=True),
        sa.Column("published_by", sa.String(length=128), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.String(length=128), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.String(length=1000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.document_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["document_version_id"],
            ["document_versions.document_version_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("publication_id"),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'PUBLISHED', 'REVOKED')",
            name="ck_document_publication_status",
        ),
        sa.CheckConstraint(
            "source_version = document_version_id",
            name="ck_document_publication_source_version",
        ),
        sa.CheckConstraint(
            "source_size_bytes >= 0",
            name="ck_document_publication_source_size",
        ),
        sa.CheckConstraint(
            "snapshot_schema = 'akb-public-document-1'",
            name="ck_document_publication_snapshot_schema",
        ),
        sa.CheckConstraint(
            "status = 'DRAFT' OR (published_at IS NOT NULL AND published_by IS NOT NULL AND approved_by IS NOT NULL)",
            name="ck_document_publication_published_actor",
        ),
        sa.CheckConstraint(
            "status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)",
            name="ck_document_publication_revoked_actor",
        ),
        sa.UniqueConstraint("central_publication_id"),
        sa.UniqueConstraint("document_version_id", name="uq_document_publication_version"),
        sa.UniqueConstraint("public_slug", name="uq_document_publication_slug"),
    )
    op.create_index(
        "ix_document_publications_public_slug",
        "document_publications",
        ["public_slug"],
    )
    op.create_index(
        "ix_document_publications_status",
        "document_publications",
        ["status"],
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            """
            CREATE OR REPLACE FUNCTION enforce_document_publication_immutability()
            RETURNS trigger AS $$
            BEGIN
                IF OLD.status IN ('PUBLISHED', 'REVOKED') AND (
                    NEW.document_id IS DISTINCT FROM OLD.document_id OR
                    NEW.document_version_id IS DISTINCT FROM OLD.document_version_id OR
                    NEW.public_slug IS DISTINCT FROM OLD.public_slug OR
                    NEW.snapshot_schema IS DISTINCT FROM OLD.snapshot_schema OR
                    NEW.public_snapshot IS DISTINCT FROM OLD.public_snapshot OR
                    NEW.public_snapshot_hash IS DISTINCT FROM OLD.public_snapshot_hash OR
                    NEW.source_file_uri IS DISTINCT FROM OLD.source_file_uri OR
                    NEW.source_file_hash IS DISTINCT FROM OLD.source_file_hash OR
                    NEW.source_filename IS DISTINCT FROM OLD.source_filename OR
                    NEW.source_mime_type IS DISTINCT FROM OLD.source_mime_type OR
                    NEW.source_size_bytes IS DISTINCT FROM OLD.source_size_bytes OR
                    NEW.governed_resource_id IS DISTINCT FROM OLD.governed_resource_id OR
                    NEW.source_version IS DISTINCT FROM OLD.source_version OR
                    NEW.policy_binding_id IS DISTINCT FROM OLD.policy_binding_id OR
                    NEW.policy_version IS DISTINCT FROM OLD.policy_version OR
                    NEW.policy_hash IS DISTINCT FROM OLD.policy_hash OR
                    NEW.central_publication_id IS DISTINCT FROM OLD.central_publication_id OR
                    NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
                    NEW.published_by IS DISTINCT FROM OLD.published_by OR
                    NEW.published_at IS DISTINCT FROM OLD.published_at OR
                    NEW.created_at IS DISTINCT FROM OLD.created_at
                ) THEN
                    RAISE EXCEPTION 'published AKB document publication coordinates are immutable';
                END IF;
                IF OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('PUBLISHED', 'REVOKED') THEN
                    RAISE EXCEPTION 'published AKB document publication may only be revoked';
                END IF;
                IF OLD.status = 'REVOKED' AND NEW.status <> 'REVOKED' THEN
                    RAISE EXCEPTION 'revoked AKB document publication is terminal';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_document_publication_immutability
            BEFORE UPDATE ON document_publications
            FOR EACH ROW EXECUTE FUNCTION enforce_document_publication_immutability()
            """
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "DROP TRIGGER IF EXISTS trg_document_publication_immutability ON document_publications"
        )
        op.execute("DROP FUNCTION IF EXISTS enforce_document_publication_immutability()")
    op.drop_index("ix_document_publications_status", table_name="document_publications")
    op.drop_index("ix_document_publications_public_slug", table_name="document_publications")
    op.drop_table("document_publications")
