"""reconcile legacy AIIP documents to the current tenant

Revision ID: 0012_aiip_tenant_reconciliation
Revises: 0011_aiip_service_access
Create Date: 2026-07-11
"""

from alembic import op


revision = "0012_aiip_tenant_reconciliation"
down_revision = "0011_aiip_service_access"
branch_labels = None
depends_on = None


LEGACY_TENANT = "default"
CURRENT_TENANT = "tenant_aiip_default"
MIGRATION_MARKER = revision


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM external_document_refs AS legacy
                JOIN external_document_refs AS current
                  ON current.external_system = legacy.external_system
                 AND current.external_ref = legacy.external_ref
                 AND current.tenant_id = '{CURRENT_TENANT}'
                WHERE legacy.external_system = 'STRATOS_AIIP'
                  AND legacy.tenant_id = '{LEGACY_TENANT}'
                  AND current.external_document_id <> legacy.external_document_id
            ) THEN
                RAISE EXCEPTION 'AIIP tenant reconciliation would collide with an existing external identity';
            END IF;
        END
        $$
        """
    )
    op.execute(
        f"""
        UPDATE documents AS document
        SET metadata = jsonb_set(
                jsonb_set(
                    document.metadata,
                    '{{external,tenant_id}}',
                    to_jsonb('{CURRENT_TENANT}'::text),
                    true
                ),
                '{{external,tenant_reconciliation}}',
                jsonb_build_object(
                    'revision', '{MIGRATION_MARKER}',
                    'from', '{LEGACY_TENANT}',
                    'to', '{CURRENT_TENANT}'
                ),
                true
            )
        WHERE EXISTS (
            SELECT 1
            FROM external_document_refs AS external_ref
            WHERE external_ref.document_id = document.document_id
              AND external_ref.external_system = 'STRATOS_AIIP'
              AND external_ref.tenant_id = '{LEGACY_TENANT}'
        )
        """
    )
    op.execute(
        f"""
        UPDATE document_access_policies AS policy
        SET constraints = jsonb_set(
                policy.constraints,
                '{{tenant_id}}',
                to_jsonb('{CURRENT_TENANT}'::text),
                true
            ),
            updated_at = CURRENT_TIMESTAMP
        FROM documents AS document
        WHERE document.document_id = policy.document_id
          AND document.metadata #>> '{{external,tenant_reconciliation,revision}}' = '{MIGRATION_MARKER}'
          AND policy.constraints ->> 'tenant_id' = '{LEGACY_TENANT}'
        """
    )
    op.execute(
        f"""
        UPDATE document_extractions AS extraction
        SET tenant_id = '{CURRENT_TENANT}',
            updated_at = CURRENT_TIMESTAMP
        FROM documents AS document
        WHERE document.document_id = extraction.document_id
          AND document.metadata #>> '{{external,tenant_reconciliation,revision}}' = '{MIGRATION_MARKER}'
          AND extraction.tenant_id = '{LEGACY_TENANT}'
        """
    )
    op.execute(
        f"""
        UPDATE document_extraction_feedback AS feedback
        SET tenant_id = '{CURRENT_TENANT}'
        FROM document_extractions AS extraction, documents AS document
        WHERE extraction.extraction_id = feedback.extraction_id
          AND document.document_id = extraction.document_id
          AND document.metadata #>> '{{external,tenant_reconciliation,revision}}' = '{MIGRATION_MARKER}'
          AND feedback.tenant_id = '{LEGACY_TENANT}'
        """
    )
    op.execute(
        f"""
        INSERT INTO audit_events (
            audit_event_id,
            actor_id,
            event_type,
            resource_type,
            resource_id,
            severity,
            correlation_id,
            metadata,
            created_at
        )
        SELECT
            'audit_' || md5(external_ref.external_document_id || '{MIGRATION_MARKER}'),
            'system:migration',
            'external_document.tenant_reconciled',
            'external_document',
            external_ref.external_document_id,
            'info',
            '{MIGRATION_MARKER}',
            jsonb_build_object(
                'revision', '{MIGRATION_MARKER}',
                'document_id', external_ref.document_id,
                'external_system', external_ref.external_system,
                'external_ref', external_ref.external_ref,
                'from_tenant_id', '{LEGACY_TENANT}',
                'to_tenant_id', '{CURRENT_TENANT}'
            ),
            CURRENT_TIMESTAMP
        FROM external_document_refs AS external_ref
        WHERE external_ref.external_system = 'STRATOS_AIIP'
          AND external_ref.tenant_id = '{LEGACY_TENANT}'
        ON CONFLICT (audit_event_id) DO NOTHING
        """
    )
    op.execute(
        f"""
        UPDATE external_document_refs
        SET tenant_id = '{CURRENT_TENANT}',
            updated_at = CURRENT_TIMESTAMP
        WHERE external_system = 'STRATOS_AIIP'
          AND tenant_id = '{LEGACY_TENANT}'
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM external_document_refs AS current
                JOIN documents AS document ON document.document_id = current.document_id
                JOIN external_document_refs AS legacy
                  ON legacy.external_system = current.external_system
                 AND legacy.external_ref = current.external_ref
                 AND legacy.tenant_id = '{LEGACY_TENANT}'
                WHERE current.external_system = 'STRATOS_AIIP'
                  AND current.tenant_id = '{CURRENT_TENANT}'
                  AND document.metadata #>> '{{external,tenant_reconciliation,revision}}' = '{MIGRATION_MARKER}'
                  AND legacy.external_document_id <> current.external_document_id
            ) THEN
                RAISE EXCEPTION 'AIIP tenant reconciliation downgrade would collide with an existing external identity';
            END IF;
        END
        $$
        """
    )
    op.execute(
        f"""
        UPDATE external_document_refs AS external_ref
        SET tenant_id = '{LEGACY_TENANT}',
            updated_at = CURRENT_TIMESTAMP
        FROM documents AS document
        WHERE document.document_id = external_ref.document_id
          AND document.metadata #>> '{{external,tenant_reconciliation,revision}}' = '{MIGRATION_MARKER}'
          AND external_ref.external_system = 'STRATOS_AIIP'
          AND external_ref.tenant_id = '{CURRENT_TENANT}'
        """
    )
    op.execute(
        f"""
        UPDATE document_extraction_feedback AS feedback
        SET tenant_id = '{LEGACY_TENANT}'
        FROM document_extractions AS extraction, documents AS document
        WHERE extraction.extraction_id = feedback.extraction_id
          AND document.document_id = extraction.document_id
          AND document.metadata #>> '{{external,tenant_reconciliation,revision}}' = '{MIGRATION_MARKER}'
          AND feedback.tenant_id = '{CURRENT_TENANT}'
        """
    )
    op.execute(
        f"""
        UPDATE document_extractions AS extraction
        SET tenant_id = '{LEGACY_TENANT}',
            updated_at = CURRENT_TIMESTAMP
        FROM documents AS document
        WHERE document.document_id = extraction.document_id
          AND document.metadata #>> '{{external,tenant_reconciliation,revision}}' = '{MIGRATION_MARKER}'
          AND extraction.tenant_id = '{CURRENT_TENANT}'
        """
    )
    op.execute(
        f"""
        UPDATE document_access_policies AS policy
        SET constraints = jsonb_set(
                policy.constraints,
                '{{tenant_id}}',
                to_jsonb('{LEGACY_TENANT}'::text),
                true
            ),
            updated_at = CURRENT_TIMESTAMP
        FROM documents AS document
        WHERE document.document_id = policy.document_id
          AND document.metadata #>> '{{external,tenant_reconciliation,revision}}' = '{MIGRATION_MARKER}'
          AND policy.constraints ->> 'tenant_id' = '{CURRENT_TENANT}'
        """
    )
    op.execute(
        f"""
        UPDATE documents
        SET metadata = jsonb_set(
                metadata #- '{{external,tenant_reconciliation}}',
                '{{external,tenant_id}}',
                to_jsonb('{LEGACY_TENANT}'::text),
                true
            )
        WHERE metadata #>> '{{external,tenant_reconciliation,revision}}' = '{MIGRATION_MARKER}'
        """
    )
    op.execute(
        f"""
        DELETE FROM audit_events
        WHERE event_type = 'external_document.tenant_reconciled'
          AND correlation_id = '{MIGRATION_MARKER}'
          AND metadata ->> 'revision' = '{MIGRATION_MARKER}'
        """
    )
