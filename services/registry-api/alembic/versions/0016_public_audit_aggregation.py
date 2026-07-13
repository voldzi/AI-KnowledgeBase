"""bound anonymous public delivery audit volume

Revision ID: 0016_public_audit_aggregation
Revises: 0015_document_publications
Create Date: 2026-07-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_public_audit_aggregation"
down_revision = "0015_document_publications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_events",
        sa.Column("aggregate_key", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "audit_events",
        sa.Column(
            "occurrence_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.add_column(
        "audit_events",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE audit_events SET last_seen_at = created_at WHERE last_seen_at IS NULL")
    op.alter_column("audit_events", "last_seen_at", nullable=False)
    op.create_index(
        "ix_audit_events_aggregate_key",
        "audit_events",
        ["aggregate_key"],
        unique=True,
    )
    op.create_index(
        "ix_audit_events_last_seen_at",
        "audit_events",
        ["last_seen_at"],
        unique=False,
    )
    op.create_check_constraint(
        "audit_event_occurrence_count_positive",
        "audit_events",
        "occurrence_count >= 1",
    )
    op.alter_column("audit_events", "occurrence_count", server_default=None)


def downgrade() -> None:
    op.drop_constraint(
        "ck_audit_events_audit_event_occurrence_count_positive",
        "audit_events",
        type_="check",
    )
    op.drop_index("ix_audit_events_last_seen_at", table_name="audit_events")
    op.drop_index("ix_audit_events_aggregate_key", table_name="audit_events")
    op.drop_column("audit_events", "last_seen_at")
    op.drop_column("audit_events", "occurrence_count")
    op.drop_column("audit_events", "aggregate_key")
