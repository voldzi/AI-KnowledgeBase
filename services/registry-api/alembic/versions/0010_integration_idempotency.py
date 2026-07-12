"""integration application idempotency

Revision ID: 0010_integration_idempotency
Revises: 0009_user_profile_settings
Create Date: 2026-07-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0010_integration_idempotency"
down_revision = "0009_user_profile_settings"
branch_labels = None
depends_on = None


def _json_type():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "integration_idempotency_records",
        sa.Column("record_id", sa.String(length=64), nullable=False),
        sa.Column("client_id", sa.String(length=128), nullable=False),
        sa.Column("operation", sa.String(length=120), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_body", _json_type(), nullable=True),
        sa.Column("audit_event_id", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("record_id", name="pk_integration_idempotency_records"),
        sa.UniqueConstraint(
            "client_id",
            "operation",
            "idempotency_key",
            name="uq_integration_idempotency_identity",
        ),
    )
    op.create_index(
        "ix_integration_idempotency_records_client_id",
        "integration_idempotency_records",
        ["client_id"],
    )
    op.create_index(
        "ix_integration_idempotency_records_operation",
        "integration_idempotency_records",
        ["operation"],
    )
    op.create_index(
        "ix_integration_idempotency_records_status",
        "integration_idempotency_records",
        ["status"],
    )
    op.create_index(
        "ix_integration_idempotency_records_audit_event_id",
        "integration_idempotency_records",
        ["audit_event_id"],
    )
    op.create_index(
        "ix_integration_idempotency_expires",
        "integration_idempotency_records",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_integration_idempotency_expires", table_name="integration_idempotency_records")
    op.drop_index(
        "ix_integration_idempotency_records_audit_event_id",
        table_name="integration_idempotency_records",
    )
    op.drop_index("ix_integration_idempotency_records_status", table_name="integration_idempotency_records")
    op.drop_index("ix_integration_idempotency_records_operation", table_name="integration_idempotency_records")
    op.drop_index("ix_integration_idempotency_records_client_id", table_name="integration_idempotency_records")
    op.drop_table("integration_idempotency_records")
