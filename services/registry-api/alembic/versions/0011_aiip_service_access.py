"""grant the AIIP application service read/RAG policy access

Revision ID: 0011_aiip_service_access
Revises: 0010_integration_idempotency
Create Date: 2026-07-11
"""

from alembic import op


revision = "0011_aiip_service_access"
down_revision = "0010_integration_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(
        """
        UPDATE document_access_policies AS policy
        SET subjects = policy.subjects || '["role:service_aiip"]'::jsonb,
            updated_at = CURRENT_TIMESTAMP
        FROM external_document_refs AS external_ref
        WHERE external_ref.document_id = policy.document_id
          AND external_ref.external_system = 'STRATOS_AIIP'
          AND policy.actions @> '["rag.query"]'::jsonb
          AND NOT policy.subjects @> '["role:service_aiip"]'::jsonb
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(
        """
        UPDATE document_access_policies AS policy
        SET subjects = (
                SELECT COALESCE(jsonb_agg(subject), '[]'::jsonb)
                FROM jsonb_array_elements(policy.subjects) AS subject
                WHERE subject <> '"role:service_aiip"'::jsonb
            ),
            updated_at = CURRENT_TIMESTAMP
        FROM external_document_refs AS external_ref
        WHERE external_ref.document_id = policy.document_id
          AND external_ref.external_system = 'STRATOS_AIIP'
          AND policy.subjects @> '["role:service_aiip"]'::jsonb
        """
    )
