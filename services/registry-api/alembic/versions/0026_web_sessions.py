"""add opaque server-side web sessions

Revision ID: 0026_web_sessions
Revises: 0025_controlled_doc_packages
Create Date: 2026-08-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0026_web_sessions"
down_revision = "0025_controlled_doc_packages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_sessions",
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("session_id_hash", sa.String(length=64), nullable=False),
        sa.Column("subject_id", sa.String(length=160), nullable=False),
        sa.Column("issuer", sa.String(length=512), nullable=False),
        sa.Column("client_id", sa.String(length=160), nullable=False),
        sa.Column("keycloak_session_id", sa.String(length=160), nullable=True),
        sa.Column("encrypted_payload", sa.Text(), nullable=False),
        sa.Column("persistent", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("identity_validated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("session_id"),
    )
    op.create_index("ix_web_sessions_session_id_hash", "web_sessions", ["session_id_hash"], unique=True)
    op.create_index("ix_web_sessions_subject_id", "web_sessions", ["subject_id"])
    op.create_index("ix_web_sessions_keycloak_session_id", "web_sessions", ["keycloak_session_id"])
    op.create_index("ix_web_sessions_last_seen_at", "web_sessions", ["last_seen_at"])
    op.create_index("ix_web_sessions_idle_expires_at", "web_sessions", ["idle_expires_at"])
    op.create_index("ix_web_sessions_absolute_expires_at", "web_sessions", ["absolute_expires_at"])
    op.create_index("ix_web_sessions_revoked_at", "web_sessions", ["revoked_at"])
    op.create_index(
        "ix_web_sessions_subject_active",
        "web_sessions",
        ["subject_id", "revoked_at", "absolute_expires_at"],
    )
    op.create_index(
        "ix_web_sessions_expiry",
        "web_sessions",
        ["absolute_expires_at", "idle_expires_at"],
    )


def downgrade() -> None:
    op.drop_table("web_sessions")
