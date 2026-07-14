"""add authoritative ingestion attempt state

Revision ID: 0018_ingestion_attempts
Revises: 0017_canonical_own_scope
Create Date: 2026-07-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0018_ingestion_attempts"
down_revision = "0017_canonical_own_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_document_version_document_identity",
        "document_versions",
        ["document_id", "document_version_id"],
    )
    op.create_table(
        "ingestion_attempts",
        sa.Column("document_id", sa.String(length=64), nullable=False),
        sa.Column("document_version_id", sa.String(length=64), nullable=False),
        sa.Column("ingestion_job_id", sa.String(length=128), nullable=False),
        sa.Column("ingestion_status", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.document_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["document_id", "document_version_id"],
            ["document_versions.document_id", "document_versions.document_version_id"],
            ondelete="CASCADE",
            name="fk_ingestion_attempt_document_version",
        ),
        sa.CheckConstraint(
            "ingestion_status IN ('QUEUED', 'INGESTING', 'INDEXED', 'FAILED')",
            name="ck_ingestion_attempt_status",
        ),
        sa.PrimaryKeyConstraint("document_id"),
    )
    op.create_index(
        "ix_ingestion_attempts_job_id",
        "ingestion_attempts",
        ["ingestion_job_id"],
        unique=True,
    )
    op.create_index(
        "ix_ingestion_attempts_status",
        "ingestion_attempts",
        ["ingestion_status"],
        unique=False,
    )
    # Existing external references are the predecessor source of current
    # ingestion state. Refuse ambiguous histories instead of guessing which
    # job/version is authoritative, then seed the new CAS row deterministically.
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM external_document_refs
                WHERE (current_ingestion_job_id IS NULL)
                        <> (current_document_version_id IS NULL)
                   OR (
                        current_ingestion_status IS NOT NULL
                        AND (
                          current_ingestion_job_id IS NULL
                          OR current_document_version_id IS NULL
                        )
                      )
              ) THEN
                RAISE EXCEPTION 'partial external ingestion state requires reconciliation before migration';
              END IF;
              IF EXISTS (
                SELECT 1
                FROM external_document_refs
                WHERE current_ingestion_job_id IS NOT NULL
                  AND current_document_version_id IS NOT NULL
                  AND COALESCE(current_ingestion_status, 'QUEUED')
                      NOT IN ('QUEUED', 'INGESTING', 'INDEXED', 'FAILED')
              ) THEN
                RAISE EXCEPTION 'invalid external ingestion status requires reconciliation before migration';
              END IF;
              IF EXISTS (
                SELECT 1
                FROM external_document_refs
                WHERE current_ingestion_job_id IS NOT NULL
                  AND current_document_version_id IS NOT NULL
                GROUP BY document_id
                HAVING COUNT(DISTINCT current_ingestion_job_id) > 1
                    OR COUNT(DISTINCT current_document_version_id) > 1
                    OR COUNT(DISTINCT COALESCE(current_ingestion_status, 'QUEUED')) > 1
              ) THEN
                RAISE EXCEPTION 'ambiguous external ingestion state requires reconciliation before migration';
              END IF;
              IF EXISTS (
                SELECT current_ingestion_job_id
                FROM external_document_refs
                WHERE current_ingestion_job_id IS NOT NULL
                GROUP BY current_ingestion_job_id
                HAVING COUNT(DISTINCT document_id) > 1
              ) THEN
                RAISE EXCEPTION 'an ingestion job is linked to more than one document';
              END IF;
            END $$;
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO ingestion_attempts (
              document_id,
              document_version_id,
              ingestion_job_id,
              ingestion_status,
              created_at,
              updated_at
            )
            SELECT
              document_id,
              MAX(current_document_version_id),
              MAX(current_ingestion_job_id),
              CASE MAX(COALESCE(current_ingestion_status, 'QUEUED'))
                WHEN 'INGESTING' THEN 'INGESTING'
                WHEN 'INDEXED' THEN 'INDEXED'
                WHEN 'FAILED' THEN 'FAILED'
                ELSE 'QUEUED'
              END,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            FROM external_document_refs
            WHERE current_ingestion_job_id IS NOT NULL
              AND current_document_version_id IS NOT NULL
            GROUP BY document_id
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_ingestion_attempts_status", table_name="ingestion_attempts")
    op.drop_index("ix_ingestion_attempts_job_id", table_name="ingestion_attempts")
    op.drop_table("ingestion_attempts")
    op.drop_constraint(
        "uq_document_version_document_identity",
        "document_versions",
        type_="unique",
    )
