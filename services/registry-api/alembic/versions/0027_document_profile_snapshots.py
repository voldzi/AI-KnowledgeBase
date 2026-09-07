"""Add append-only document root revisions and exact version profile snapshots.

Revision ID: 0027_document_profiles
Revises: 0026_web_sessions
No backfill or implicit admission of existing records is performed.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0027_document_profiles"
down_revision = "0026_web_sessions"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("documents", sa.Column("profile_metadata_revision", sa.String(160), nullable=True))
    op.create_table("document_profile_root_revisions",
        sa.Column("snapshot_id", sa.String(64), primary_key=True),
        sa.Column("document_id", sa.String(64), sa.ForeignKey("documents.document_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("metadata_revision", sa.String(160), nullable=False),
        sa.Column("snapshot_hash", sa.String(80), nullable=False),
        sa.Column("profile_id", sa.String(160), nullable=False),
        sa.Column("profile_revision", sa.String(160), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("admission_confirmation", postgresql.JSONB(), nullable=False),
        sa.Column("created_by", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("document_id", "metadata_revision", name="uq_profile_root_revision"),
    )
    op.create_index("ix_document_profile_root_revisions_document_id", "document_profile_root_revisions", ["document_id"])
    op.create_table("document_profile_version_snapshots",
        sa.Column("document_version_id", sa.String(64), primary_key=True),
        sa.Column("document_id", sa.String(64), nullable=False),
        sa.Column("root_metadata_revision", sa.String(160), nullable=False),
        sa.Column("root_snapshot_hash", sa.String(80), nullable=False),
        sa.Column("snapshot_hash", sa.String(80), nullable=False),
        sa.Column("file_id", sa.String(64), sa.ForeignKey("document_files.file_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("admission_confirmation", postgresql.JSONB(), nullable=False),
        sa.Column("created_by", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id", "document_version_id"], ["document_versions.document_id", "document_versions.document_version_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["document_id", "root_metadata_revision"], ["document_profile_root_revisions.document_id", "document_profile_root_revisions.metadata_revision"], ondelete="RESTRICT"),
    )
    op.create_index("ix_document_profile_version_snapshots_document_id", "document_profile_version_snapshots", ["document_id"])
    op.execute("""CREATE FUNCTION akb_reject_document_profile_mutation() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'document profile snapshots are append-only'; END;
    $$ LANGUAGE plpgsql""")
    for table in ("document_profile_root_revisions", "document_profile_version_snapshots"):
        op.execute(f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION akb_reject_document_profile_mutation()")


def downgrade():
    op.drop_table("document_profile_version_snapshots")
    op.drop_table("document_profile_root_revisions")
    op.execute("DROP FUNCTION akb_reject_document_profile_mutation()")
    op.drop_column("documents", "profile_metadata_revision")
