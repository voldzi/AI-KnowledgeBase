"""add STRATOS Information Policy V2 binding snapshots

Revision ID: 0013_information_policy_v2
Revises: 0012_aiip_tenant_reconciliation
Create Date: 2026-07-12
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_information_policy_v2"
down_revision = "0012_aiip_tenant_reconciliation"
branch_labels = None
depends_on = None


def _add_binding_columns(table: str) -> None:
    op.add_column(
        table,
        sa.Column("organization_id", sa.String(length=128), nullable=False, server_default="org_stratos"),
    )
    op.add_column(table, sa.Column("policy_binding_id", sa.String(length=160), nullable=True))
    op.add_column(table, sa.Column("policy_version", sa.String(length=80), nullable=True))
    op.add_column(table, sa.Column("policy_hash", sa.String(length=80), nullable=True))
    op.add_column(
        table,
        sa.Column("policy_summary", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.create_index(f"ix_{table}_organization_id", table, ["organization_id"])
    op.create_index(f"ix_{table}_policy_binding_id", table, ["policy_binding_id"])


def _drop_binding_columns(table: str) -> None:
    op.drop_index(f"ix_{table}_policy_binding_id", table_name=table)
    op.drop_index(f"ix_{table}_organization_id", table_name=table)
    op.drop_column(table, "policy_summary")
    op.drop_column(table, "policy_hash")
    op.drop_column(table, "policy_version")
    op.drop_column(table, "policy_binding_id")
    op.drop_column(table, "organization_id")


def upgrade() -> None:
    _add_binding_columns("documents")
    _add_binding_columns("document_versions")


def downgrade() -> None:
    _drop_binding_columns("document_versions")
    _drop_binding_columns("documents")
