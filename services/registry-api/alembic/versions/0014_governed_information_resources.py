"""track central STRATOS governed information resources

Revision ID: 0014_governed_resources
Revises: 0013_information_policy_v2
Create Date: 2026-07-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_governed_resources"
down_revision = "0013_information_policy_v2"
branch_labels = None
depends_on = None


def _add_governance_columns(table: str) -> None:
    op.add_column(table, sa.Column("governed_resource_id", sa.String(length=128), nullable=True))
    op.add_column(table, sa.Column("governed_source_version", sa.String(length=160), nullable=True))
    op.add_column(table, sa.Column("governed_parent_resource_id", sa.String(length=128), nullable=True))
    op.add_column(
        table,
        sa.Column(
            "governance_scope_type",
            sa.String(length=64),
            nullable=False,
            server_default="organization",
        ),
    )
    op.add_column(
        table,
        sa.Column(
            "governance_scope_id",
            sa.String(length=160),
            nullable=True,
            server_default="org_stratos",
        ),
    )
    op.add_column(
        table,
        sa.Column(
            "governance_registration_status",
            sa.String(length=48),
            nullable=False,
            server_default="LEGACY_UNREGISTERED",
        ),
    )
    op.add_column(
        table,
        sa.Column("governance_registered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(f"ix_{table}_governed_resource_id", table, ["governed_resource_id"])
    op.create_index(
        f"ix_{table}_governance_registration_status",
        table,
        ["governance_registration_status"],
    )


def _drop_governance_columns(table: str) -> None:
    op.drop_index(f"ix_{table}_governance_registration_status", table_name=table)
    op.drop_index(f"ix_{table}_governed_resource_id", table_name=table)
    op.drop_column(table, "governance_registered_at")
    op.drop_column(table, "governance_registration_status")
    op.drop_column(table, "governance_scope_id")
    op.drop_column(table, "governance_scope_type")
    op.drop_column(table, "governed_parent_resource_id")
    op.drop_column(table, "governed_source_version")
    op.drop_column(table, "governed_resource_id")


def upgrade() -> None:
    _add_governance_columns("documents")
    _add_governance_columns("document_versions")


def downgrade() -> None:
    _drop_governance_columns("document_versions")
    _drop_governance_columns("documents")
