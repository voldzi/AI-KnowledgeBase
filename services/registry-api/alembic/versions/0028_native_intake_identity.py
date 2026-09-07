"""Bind native versions to a unique verified upload session, without backfill."""
from alembic import op
import sqlalchemy as sa

revision = "0028_native_intake_identity"
down_revision = "0027_document_profiles"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("document_versions", sa.Column("native_intake_session_hash", sa.String(64), nullable=True))
    op.create_unique_constraint("uq_document_version_native_intake", "document_versions", ["document_id", "native_intake_session_hash"])


def downgrade():
    op.drop_constraint("uq_document_version_native_intake", "document_versions", type_="unique")
    op.drop_column("document_versions", "native_intake_session_hash")
