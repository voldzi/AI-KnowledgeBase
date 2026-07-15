"""harden document lineage and lookup indexes

Revision ID: 0019_database_hardening
Revises: 0018_ingestion_attempts
Create Date: 2026-07-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0019_database_hardening"
down_revision = "0018_ingestion_attempts"
branch_labels = None
depends_on = None


DOCUMENT_STATUSES = "'draft', 'review', 'approved', 'valid', 'superseded', 'archived', 'cancelled'"
CLASSIFICATIONS = "'public', 'internal', 'restricted', 'confidential'"


def _has_table(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def _has_check(table_name: str, logical_name: str) -> bool:
    # The shared naming convention prefixes explicitly supplied check names,
    # so metadata-created tables can contain e.g.
    # ck_analyst_cases_ck_analyst_cases_status.
    return any(
        (constraint.get("name") or "") == logical_name
        or (constraint.get("name") or "").endswith(f"_{logical_name}")
        for constraint in sa.inspect(op.get_bind()).get_check_constraints(table_name)
    )


def _index_names(table_name: str) -> set[str]:
    return {
        index["name"]
        for index in sa.inspect(op.get_bind()).get_indexes(table_name)
        if index.get("name")
    }


def _create_index_if_missing(
    name: str,
    table_name: str,
    columns: list[str],
) -> None:
    if name not in _index_names(table_name):
        op.create_index(name, table_name, columns)


def upgrade() -> None:
    # 0004 accidentally created the same document_id index twice.
    op.execute(sa.text("DROP INDEX IF EXISTS ix_external_document_refs_document_id"))
    op.alter_column(
        "external_document_refs",
        "tenant_id",
        existing_type=sa.String(length=128),
        server_default=sa.text("'org_stratos'"),
        existing_nullable=False,
    )

    op.create_unique_constraint(
        "uq_document_file_version_identity",
        "document_files",
        ["document_id", "document_version_id", "file_id"],
    )
    op.create_check_constraint(
        "ck_document_files_size",
        "document_files",
        "size_bytes IS NULL OR size_bytes >= 0",
    )
    op.create_check_constraint(
        "ck_documents_status",
        "documents",
        f"status IN ({DOCUMENT_STATUSES})",
    )
    op.create_check_constraint(
        "ck_documents_classification",
        "documents",
        f"classification IN ({CLASSIFICATIONS})",
    )
    op.create_check_constraint(
        "ck_document_versions_status",
        "document_versions",
        f"status IN ({DOCUMENT_STATUSES})",
    )
    op.create_check_constraint(
        "ck_document_versions_validity",
        "document_versions",
        "valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to",
    )
    op.create_check_constraint(
        "ck_external_document_refs_ingestion_shape",
        "external_document_refs",
        "current_ingestion_job_id IS NULL OR "
        "(current_document_version_id IS NOT NULL "
        "AND current_ingestion_status IN ('QUEUED', 'INGESTING', 'INDEXED', 'FAILED'))",
    )

    op.create_foreign_key(
        "fk_external_document_refs_current_version",
        "external_document_refs",
        "document_versions",
        ["document_id", "current_document_version_id"],
        ["document_id", "document_version_id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_external_document_refs_current_file",
        "external_document_refs",
        "document_files",
        ["document_id", "current_document_version_id", "current_file_id"],
        ["document_id", "document_version_id", "file_id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_external_document_refs_tenant_status_updated",
        "external_document_refs",
        ["tenant_id", "current_ingestion_status", "updated_at"],
    )
    op.create_index(
        "ix_document_versions_document_created",
        "document_versions",
        ["document_id", "created_at"],
    )
    op.create_index(
        "ix_document_files_version",
        "document_files",
        ["document_id", "document_version_id"],
    )

    # The analyst workspace models pre-dated their Alembic migration. Create
    # the missing durable structures now rather than relying on metadata.create_all.
    if not _has_table("analyst_cases"):
        op.create_table(
            "analyst_cases",
            sa.Column("case_id", sa.String(length=64), nullable=False),
            sa.Column("title", sa.String(length=240), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="open"),
            sa.Column("owner_id", sa.String(length=128), nullable=False),
            sa.Column("classification", sa.String(length=32), nullable=False, server_default="internal"),
            sa.Column("tags", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.CheckConstraint("status IN ('open', 'archived')", name="ck_analyst_cases_status"),
            sa.CheckConstraint(
                "classification IN ('public', 'internal', 'restricted', 'confidential')",
                name="ck_analyst_cases_classification",
            ),
            sa.PrimaryKeyConstraint("case_id"),
        )
    else:
        if not _has_check("analyst_cases", "ck_analyst_cases_status"):
            op.create_check_constraint("ck_analyst_cases_status", "analyst_cases", "status IN ('open', 'archived')")
        if not _has_check("analyst_cases", "ck_analyst_cases_classification"):
            op.create_check_constraint(
                "ck_analyst_cases_classification",
                "analyst_cases",
                "classification IN ('public', 'internal', 'restricted', 'confidential')",
            )
    _create_index_if_missing("ix_analyst_cases_status", "analyst_cases", ["status"])
    _create_index_if_missing("ix_analyst_cases_owner_id", "analyst_cases", ["owner_id"])
    _create_index_if_missing("ix_analyst_cases_classification", "analyst_cases", ["classification"])
    _create_index_if_missing("ix_analyst_cases_owner_status", "analyst_cases", ["owner_id", "status"])
    _create_index_if_missing("ix_analyst_cases_updated", "analyst_cases", ["updated_at"])

    if not _has_table("analyst_saved_queries"):
        op.create_table(
            "analyst_saved_queries",
            sa.Column("saved_query_id", sa.String(length=64), nullable=False),
            sa.Column("case_id", sa.String(length=64), nullable=False),
            sa.Column("title", sa.String(length=240), nullable=False),
            sa.Column("query_text", sa.Text(), nullable=False),
            sa.Column("query_mode", sa.String(length=32), nullable=False, server_default="smart"),
            sa.Column("search_fields", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("filters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("created_by", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["case_id"], ["analyst_cases.case_id"], ondelete="CASCADE"),
            sa.CheckConstraint(
                "query_mode IN ('smart', 'simple', 'advanced', 'fielded')",
                name="ck_analyst_saved_queries_mode",
            ),
            sa.PrimaryKeyConstraint("saved_query_id"),
        )
    elif not _has_check("analyst_saved_queries", "ck_analyst_saved_queries_mode"):
        op.create_check_constraint(
            "ck_analyst_saved_queries_mode",
            "analyst_saved_queries",
            "query_mode IN ('smart', 'simple', 'advanced', 'fielded')",
        )
    _create_index_if_missing("ix_analyst_saved_queries_case", "analyst_saved_queries", ["case_id", "created_at"])
    _create_index_if_missing("ix_analyst_saved_queries_created_by", "analyst_saved_queries", ["created_by"])
    _create_index_if_missing("ix_analyst_saved_queries_created_at", "analyst_saved_queries", ["created_at"])

    if not _has_table("analyst_evidence_items"):
        op.create_table(
            "analyst_evidence_items",
            sa.Column("evidence_id", sa.String(length=64), nullable=False),
            sa.Column("case_id", sa.String(length=64), nullable=False),
            sa.Column("title", sa.String(length=300), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("document_id", sa.String(length=64), nullable=True),
            sa.Column("document_version_id", sa.String(length=64), nullable=True),
            sa.Column("document_title", sa.String(length=300), nullable=True),
            sa.Column("chunk_id", sa.String(length=128), nullable=True),
            sa.Column("page_number", sa.Integer(), nullable=True),
            sa.Column("section_title", sa.String(length=300), nullable=True),
            sa.Column("source_file_name", sa.String(length=300), nullable=True),
            sa.Column("score", sa.Float(), nullable=True),
            sa.Column("snippet", sa.Text(), nullable=True),
            sa.Column("entity_types", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("entity_values", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("created_by", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["case_id"], ["analyst_cases.case_id"], ondelete="CASCADE"),
            sa.CheckConstraint("page_number IS NULL OR page_number > 0", name="ck_analyst_evidence_page"),
            sa.CheckConstraint("score IS NULL OR score >= 0", name="ck_analyst_evidence_score"),
            sa.PrimaryKeyConstraint("evidence_id"),
        )
    else:
        if not _has_check("analyst_evidence_items", "ck_analyst_evidence_page"):
            op.create_check_constraint(
                "ck_analyst_evidence_page",
                "analyst_evidence_items",
                "page_number IS NULL OR page_number > 0",
            )
        if not _has_check("analyst_evidence_items", "ck_analyst_evidence_score"):
            op.create_check_constraint(
                "ck_analyst_evidence_score",
                "analyst_evidence_items",
                "score IS NULL OR score >= 0",
            )
    _create_index_if_missing("ix_analyst_evidence_case", "analyst_evidence_items", ["case_id", "created_at"])
    _create_index_if_missing("ix_analyst_evidence_document", "analyst_evidence_items", ["document_id", "document_version_id"])
    _create_index_if_missing("ix_analyst_evidence_chunk", "analyst_evidence_items", ["chunk_id"])
    _create_index_if_missing("ix_analyst_evidence_items_document_id", "analyst_evidence_items", ["document_id"])
    _create_index_if_missing("ix_analyst_evidence_items_document_version_id", "analyst_evidence_items", ["document_version_id"])
    _create_index_if_missing("ix_analyst_evidence_items_created_by", "analyst_evidence_items", ["created_by"])
    _create_index_if_missing("ix_analyst_evidence_items_created_at", "analyst_evidence_items", ["created_at"])

    op.execute(
        sa.text(
            "COMMENT ON TABLE document_versions IS "
            "'Immutable source-version coordinate for an AKB document; public and RAG reads bind to an exact version.'"
        )
    )
    op.execute(
        sa.text(
            "COMMENT ON COLUMN external_document_refs.current_document_version_id IS "
            "'Mutable projection pointer; constrained to a version of the same document.'"
        )
    )


def downgrade() -> None:
    op.drop_table("analyst_evidence_items")
    op.drop_table("analyst_saved_queries")
    op.drop_table("analyst_cases")
    op.drop_index("ix_document_files_version", table_name="document_files")
    op.drop_index("ix_document_versions_document_created", table_name="document_versions")
    op.drop_index("ix_external_document_refs_tenant_status_updated", table_name="external_document_refs")
    op.drop_constraint("fk_external_document_refs_current_file", "external_document_refs", type_="foreignkey")
    op.drop_constraint("fk_external_document_refs_current_version", "external_document_refs", type_="foreignkey")
    op.drop_constraint("ck_external_document_refs_ingestion_shape", "external_document_refs", type_="check")
    op.drop_constraint("ck_document_versions_validity", "document_versions", type_="check")
    op.drop_constraint("ck_document_versions_status", "document_versions", type_="check")
    op.drop_constraint("ck_documents_classification", "documents", type_="check")
    op.drop_constraint("ck_documents_status", "documents", type_="check")
    op.drop_constraint("ck_document_files_size", "document_files", type_="check")
    op.drop_constraint("uq_document_file_version_identity", "document_files", type_="unique")
    op.alter_column(
        "external_document_refs",
        "tenant_id",
        existing_type=sa.String(length=128),
        server_default=None,
        existing_nullable=False,
    )
    op.create_index(
        "ix_external_document_refs_document_id",
        "external_document_refs",
        ["document_id"],
    )
