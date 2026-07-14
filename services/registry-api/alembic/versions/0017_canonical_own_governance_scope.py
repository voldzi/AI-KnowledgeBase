"""store canonical owner identity for own governed scopes

Revision ID: 0017_canonical_own_scope
Revises: 0016_public_audit_aggregation
Create Date: 2026-07-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0017_canonical_own_scope"
down_revision = "0016_public_audit_aggregation"
branch_labels = None
depends_on = None


def _add_owner_scope_column(table: str) -> None:
    op.add_column(
        table,
        sa.Column(
            "governance_scope_owner_subject_id",
            sa.String(length=160),
            nullable=True,
        ),
    )
    op.create_index(
        f"ix_{table}_governance_scope_owner_subject_id",
        table,
        ["governance_scope_owner_subject_id"],
        unique=False,
    )


def _add_owner_scope_constraint(table: str) -> None:
    op.create_check_constraint(
        "governance_scope_owner_shape",
        table,
        "(governance_scope_type = 'own' AND governance_scope_id IS NULL "
        "AND governance_scope_owner_subject_id IS NOT NULL "
        "AND length(trim(governance_scope_owner_subject_id)) > 0) "
        "OR (governance_scope_type <> 'own' "
        "AND governance_scope_owner_subject_id IS NULL)",
    )


def _drop_owner_scope(table: str) -> None:
    op.drop_constraint(
        f"ck_{table}_governance_scope_owner_shape",
        table,
        type_="check",
    )
    op.drop_index(
        f"ix_{table}_governance_scope_owner_subject_id",
        table_name=table,
    )
    op.drop_column(table, "governance_scope_owner_subject_id")


def upgrade() -> None:
    _add_owner_scope_column("documents")
    _add_owner_scope_column("document_versions")

    # Existing own-scoped rows predate the canonical owner column. Preserve
    # their owner identity before the shape constraint becomes active; never
    # reinterpret an old own row as organization-wide content.
    op.execute(
        sa.text(
            "UPDATE documents "
            "SET governance_scope_owner_subject_id = owner_id, "
            "    governance_scope_id = NULL "
            "WHERE governance_scope_type = 'own'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE document_versions AS version "
            "SET governance_scope_owner_subject_id = document.owner_id, "
            "    governance_scope_id = NULL "
            "FROM documents AS document "
            "WHERE version.document_id = document.document_id "
            "  AND version.governance_scope_type = 'own'"
        )
    )

    _add_owner_scope_constraint("documents")
    _add_owner_scope_constraint("document_versions")


def downgrade() -> None:
    _drop_owner_scope("document_versions")
    _drop_owner_scope("documents")
