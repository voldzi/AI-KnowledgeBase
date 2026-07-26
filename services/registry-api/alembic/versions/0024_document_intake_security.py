"""add document intake content security attestation

Revision ID: 0024_document_intake_security
Revises: 0023_assistant_pinning
Create Date: 2026-07-26
"""

from alembic import op
import sqlalchemy as sa


revision = "0024_document_intake_security"
down_revision = "0023_assistant_pinning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "document_files",
        sa.Column("content_security_status", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "document_files",
        sa.Column("content_security_engine", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "document_files",
        sa.Column(
            "content_security_engine_version",
            sa.String(length=160),
            nullable=True,
        ),
    )
    op.add_column(
        "document_files",
        sa.Column(
            "content_security_signature_version",
            sa.String(length=160),
            nullable=True,
        ),
    )
    op.add_column(
        "document_files",
        sa.Column(
            "content_security_scanned_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "document_files",
        sa.Column(
            "content_security_attestation_sha256",
            sa.String(length=80),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("document_files", "content_security_attestation_sha256")
    op.drop_column("document_files", "content_security_scanned_at")
    op.drop_column("document_files", "content_security_signature_version")
    op.drop_column("document_files", "content_security_engine_version")
    op.drop_column("document_files", "content_security_engine")
    op.drop_column("document_files", "content_security_status")
