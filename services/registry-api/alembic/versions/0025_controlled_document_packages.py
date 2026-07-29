"""add immutable controlled-document package releases

Revision ID: 0025_controlled_doc_packages
Revises: 0024_document_intake_security
Create Date: 2026-07-29
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0025_controlled_doc_packages"
down_revision = "0024_document_intake_security"
branch_labels = None
depends_on = None


def _json_type():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "controlled_document_packages",
        sa.Column("package_id", sa.String(length=64), nullable=False),
        sa.Column(
            "organization_id",
            sa.String(length=128),
            nullable=False,
            server_default="org_stratos",
        ),
        sa.Column("package_key", sa.String(length=160), nullable=False),
        sa.Column("release_label", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("domain", sa.String(length=80), nullable=False),
        sa.Column("source_type", sa.String(length=48), nullable=False),
        sa.Column("authority_rank", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("primary_document_id", sa.String(length=64), nullable=False),
        sa.Column("primary_document_version_id", sa.String(length=64), nullable=False),
        sa.Column("replaces_package_id", sa.String(length=64), nullable=True),
        sa.Column("owner_id", sa.String(length=128), nullable=False),
        sa.Column("approved_by", sa.String(length=128), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", _json_type(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('draft', 'approved', 'valid', 'superseded', 'cancelled', 'archived')",
            name="ck_controlled_document_package_status",
        ),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_from <= effective_to",
            name="ck_controlled_document_package_validity",
        ),
        sa.CheckConstraint(
            "authority_rank >= 0 AND authority_rank <= 1000",
            name="ck_controlled_document_package_authority_rank",
        ),
        sa.ForeignKeyConstraint(
            ["primary_document_id"],
            ["documents.document_id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["primary_document_version_id"],
            ["document_versions.document_version_id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["replaces_package_id"],
            ["controlled_document_packages.package_id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("package_id"),
        sa.UniqueConstraint(
            "organization_id",
            "package_key",
            "release_label",
            name="uq_controlled_document_package_release",
        ),
    )
    op.create_index(
        "ix_controlled_document_packages_domain_validity",
        "controlled_document_packages",
        [
            "organization_id",
            "domain",
            "status",
            "effective_from",
            "effective_to",
        ],
    )
    op.create_index(
        "ix_controlled_document_packages_domain",
        "controlled_document_packages",
        ["domain"],
    )
    op.create_index(
        "ix_controlled_document_packages_package_key",
        "controlled_document_packages",
        ["package_key"],
    )
    op.create_index(
        "ix_controlled_document_packages_owner_id",
        "controlled_document_packages",
        ["owner_id"],
    )
    op.create_index(
        "ix_controlled_document_packages_organization_id",
        "controlled_document_packages",
        ["organization_id"],
    )
    op.create_index(
        "ix_controlled_document_packages_source_type",
        "controlled_document_packages",
        ["source_type"],
    )
    op.create_index(
        "ix_controlled_document_packages_status",
        "controlled_document_packages",
        ["status"],
    )

    op.create_table(
        "controlled_document_package_members",
        sa.Column("member_id", sa.String(length=64), nullable=False),
        sa.Column("package_id", sa.String(length=64), nullable=False),
        sa.Column("member_role", sa.String(length=40), nullable=False),
        sa.Column("relation_type", sa.String(length=40), nullable=False),
        sa.Column("document_id", sa.String(length=64), nullable=False),
        sa.Column("document_version_id", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=300), nullable=True),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("metadata", _json_type(), nullable=False, server_default=sa.text("'{}'")),
        sa.CheckConstraint(
            "member_role IN ('main_document', 'attachment', 'form', 'template')",
            name="ck_controlled_document_package_member_role",
        ),
        sa.CheckConstraint(
            "relation_type IN ('contains_attachment', 'contains_form', "
            "'contains_template', 'replaces', 'amends', 'implements', "
            "'references', 'related_to')",
            name="ck_controlled_document_package_relation_type",
        ),
        sa.ForeignKeyConstraint(
            ["package_id"],
            ["controlled_document_packages.package_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.document_id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_version_id"],
            ["document_versions.document_version_id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("member_id"),
        sa.UniqueConstraint(
            "package_id",
            "document_version_id",
            "member_role",
            name="uq_controlled_document_package_member",
        ),
    )
    op.create_index(
        "ix_controlled_document_package_members_document_version",
        "controlled_document_package_members",
        ["document_id", "document_version_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_controlled_document_package_members_document_version",
        table_name="controlled_document_package_members",
    )
    op.drop_table("controlled_document_package_members")
    op.drop_index(
        "ix_controlled_document_packages_status",
        table_name="controlled_document_packages",
    )
    op.drop_index(
        "ix_controlled_document_packages_source_type",
        table_name="controlled_document_packages",
    )
    op.drop_index(
        "ix_controlled_document_packages_organization_id",
        table_name="controlled_document_packages",
    )
    op.drop_index(
        "ix_controlled_document_packages_owner_id",
        table_name="controlled_document_packages",
    )
    op.drop_index(
        "ix_controlled_document_packages_package_key",
        table_name="controlled_document_packages",
    )
    op.drop_index(
        "ix_controlled_document_packages_domain",
        table_name="controlled_document_packages",
    )
    op.drop_index(
        "ix_controlled_document_packages_domain_validity",
        table_name="controlled_document_packages",
    )
    op.drop_table("controlled_document_packages")
