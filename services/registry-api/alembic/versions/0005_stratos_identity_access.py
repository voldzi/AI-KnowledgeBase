"""stratos identity and access metadata

Revision ID: 0005_stratos_identity_access
Revises: 0004_external_document_refs
Create Date: 2026-06-07
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_stratos_identity_access"
down_revision = "0004_external_document_refs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_profiles", sa.Column("username", sa.String(length=200), nullable=True))
    op.add_column(
        "user_profiles",
        sa.Column("identity_source", sa.String(length=32), nullable=False, server_default="oidc"),
    )
    op.add_column("user_profiles", sa.Column("provider", sa.String(length=64), nullable=True))
    op.add_column(
        "user_profiles",
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "user_profiles",
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
    )
    op.create_index("ix_user_profiles_username", "user_profiles", ["username"])
    op.create_index("ix_user_profiles_identity_source", "user_profiles", ["identity_source"])
    op.create_index("ix_user_profiles_status", "user_profiles", ["status"])

    op.add_column(
        "role_mappings",
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
    )
    op.add_column("role_mappings", sa.Column("assigned_by", sa.String(length=128), nullable=True))
    op.add_column(
        "role_mappings",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_role_mappings_status", "role_mappings", ["status"])


def downgrade() -> None:
    op.drop_index("ix_role_mappings_status", table_name="role_mappings")
    op.drop_column("role_mappings", "updated_at")
    op.drop_column("role_mappings", "assigned_by")
    op.drop_column("role_mappings", "status")

    op.drop_index("ix_user_profiles_status", table_name="user_profiles")
    op.drop_index("ix_user_profiles_identity_source", table_name="user_profiles")
    op.drop_index("ix_user_profiles_username", table_name="user_profiles")
    op.drop_column("user_profiles", "status")
    op.drop_column("user_profiles", "enabled")
    op.drop_column("user_profiles", "provider")
    op.drop_column("user_profiles", "identity_source")
    op.drop_column("user_profiles", "username")
