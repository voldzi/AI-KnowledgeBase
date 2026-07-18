from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.mutable import MutableDict, MutableList
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def json_type():
    return JSON().with_variant(JSONB, "postgresql")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Document(Base, TimestampMixin):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint(
            "(governance_scope_type = 'own' AND governance_scope_id IS NULL "
            "AND governance_scope_owner_subject_id IS NOT NULL "
            "AND length(trim(governance_scope_owner_subject_id)) > 0) "
            "OR (governance_scope_type <> 'own' "
            "AND governance_scope_owner_subject_id IS NULL)",
            name="governance_scope_owner_shape",
        ),
        CheckConstraint(
            "status IN ('draft', 'review', 'approved', 'valid', 'superseded', 'archived', 'cancelled')",
            name="ck_documents_status",
        ),
        CheckConstraint(
            "classification IN ('public', 'internal', 'restricted', 'confidential')",
            name="ck_documents_classification",
        ),
    )

    document_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("doc")
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    document_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)
    classification: Mapped[str] = mapped_column(
        String(32), nullable=False, default="internal", index=True
    )
    organization_id: Mapped[str] = mapped_column(
        String(128), nullable=False, default="org_stratos", index=True
    )
    policy_binding_id: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    policy_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    policy_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    policy_summary: Mapped[dict[str, object]] = mapped_column(
        MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )
    governed_resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    governed_source_version: Mapped[str | None] = mapped_column(String(160), nullable=True)
    governed_parent_resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    governance_scope_type: Mapped[str] = mapped_column(
        String(64), nullable=False, default="organization"
    )
    governance_scope_id: Mapped[str | None] = mapped_column(
        String(160).evaluates_none(), nullable=True, default="org_stratos"
    )
    governance_scope_owner_subject_id: Mapped[str | None] = mapped_column(
        String(160), nullable=True, index=True
    )
    governance_registration_status: Mapped[str] = mapped_column(
        String(48), nullable=False, default="LEGACY_UNREGISTERED", index=True
    )
    governance_registered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    owner_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    gestor_unit: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    tags: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(json_type()), nullable=False, default=list
    )
    document_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )

    versions: Mapped[list["DocumentVersion"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    access_policies: Mapped[list["DocumentAccessPolicy"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    files: Mapped[list["DocumentFile"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    assignments: Mapped[list["DocumentAssignment"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    workflow_tasks: Mapped[list["WorkflowTask"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    external_refs: Mapped[list["ExternalDocumentRef"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    extractions: Mapped[list["DocumentExtraction"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    publications: Mapped[list["DocumentPublication"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )

    @property
    def owner(self) -> str:
        return self.owner_id


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (
        UniqueConstraint("document_id", "version_label", name="uq_document_version_label"),
        UniqueConstraint(
            "document_id",
            "document_version_id",
            name="uq_document_version_document_identity",
        ),
        Index("ix_document_versions_document_status", "document_id", "status"),
        Index("ix_document_versions_document_created", "document_id", "created_at"),
        CheckConstraint(
            "(governance_scope_type = 'own' AND governance_scope_id IS NULL "
            "AND governance_scope_owner_subject_id IS NOT NULL "
            "AND length(trim(governance_scope_owner_subject_id)) > 0) "
            "OR (governance_scope_type <> 'own' "
            "AND governance_scope_owner_subject_id IS NULL)",
            name="governance_scope_owner_shape",
        ),
        CheckConstraint(
            "status IN ('draft', 'review', 'approved', 'valid', 'superseded', 'archived', 'cancelled')",
            name="ck_document_versions_status",
        ),
        CheckConstraint(
            "valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to",
            name="ck_document_versions_validity",
        ),
    )

    document_version_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("ver")
    )
    document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False
    )
    version_label: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)
    organization_id: Mapped[str] = mapped_column(
        String(128), nullable=False, default="org_stratos", index=True
    )
    policy_binding_id: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    policy_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    policy_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    policy_summary: Mapped[dict[str, object]] = mapped_column(
        MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )
    governed_resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    governed_source_version: Mapped[str | None] = mapped_column(String(160), nullable=True)
    governed_parent_resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    governance_scope_type: Mapped[str] = mapped_column(
        String(64), nullable=False, default="organization"
    )
    governance_scope_id: Mapped[str | None] = mapped_column(
        String(160).evaluates_none(), nullable=True, default="org_stratos"
    )
    governance_scope_owner_subject_id: Mapped[str | None] = mapped_column(
        String(160), nullable=True, index=True
    )
    governance_registration_status: Mapped[str] = mapped_column(
        String(48), nullable=False, default="LEGACY_UNREGISTERED", index=True
    )
    governance_registered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_file_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    source_location: Mapped[dict[str, object] | None] = mapped_column(
        MutableDict.as_mutable(json_type()), nullable=True
    )
    file_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    document: Mapped[Document] = relationship(back_populates="versions")
    files: Mapped[list["DocumentFile"]] = relationship(
        back_populates="document_version", cascade="all, delete-orphan"
    )
    publication: Mapped["DocumentPublication | None"] = relationship(
        back_populates="document_version", uselist=False, cascade="all, delete-orphan"
    )


class DocumentPublication(Base, TimestampMixin):
    """Immutable public projection for one exact AKB document version.

    The snapshot deliberately excludes live document metadata, extracted text,
    chunks and storage coordinates. Source coordinates remain server-internal
    and are released only to the web delivery boundary after a fresh central
    public decision.
    """

    __tablename__ = "document_publications"
    __table_args__ = (
        UniqueConstraint("document_version_id", name="uq_document_publication_version"),
        UniqueConstraint("public_slug", name="uq_document_publication_slug"),
        CheckConstraint(
            "status IN ('DRAFT', 'PUBLISHED', 'REVOKED')",
            name="ck_document_publication_status",
        ),
        CheckConstraint(
            "source_version = document_version_id",
            name="ck_document_publication_source_version",
        ),
        CheckConstraint(
            "source_size_bytes >= 0",
            name="ck_document_publication_source_size",
        ),
        CheckConstraint(
            "snapshot_schema = 'akb-public-document-1'",
            name="ck_document_publication_snapshot_schema",
        ),
        CheckConstraint(
            "status = 'DRAFT' OR (published_at IS NOT NULL AND published_by IS NOT NULL AND approved_by IS NOT NULL)",
            name="ck_document_publication_published_actor",
        ),
        CheckConstraint(
            "status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)",
            name="ck_document_publication_revoked_actor",
        ),
        Index("ix_document_publications_status", "status"),
    )

    publication_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("pub")
    )
    document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False
    )
    document_version_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("document_versions.document_version_id", ondelete="CASCADE"),
        nullable=False,
    )
    public_slug: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="DRAFT")
    snapshot_schema: Mapped[str] = mapped_column(String(80), nullable=False)
    public_snapshot: Mapped[dict[str, object]] = mapped_column(
        MutableDict.as_mutable(json_type()), nullable=False
    )
    public_snapshot_hash: Mapped[str] = mapped_column(String(80), nullable=False)

    source_file_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    source_file_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    source_filename: Mapped[str] = mapped_column(String(300), nullable=False)
    source_mime_type: Mapped[str] = mapped_column(String(160), nullable=False)
    source_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    governed_resource_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_version: Mapped[str] = mapped_column(String(160), nullable=False)
    policy_binding_id: Mapped[str] = mapped_column(String(160), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(80), nullable=False)
    policy_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    central_publication_id: Mapped[str] = mapped_column(
        String(128), nullable=False, unique=True
    )

    approved_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    published_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)

    document: Mapped[Document] = relationship(back_populates="publications")
    document_version: Mapped[DocumentVersion] = relationship(back_populates="publication")


class DocumentFile(Base):
    __tablename__ = "document_files"
    __table_args__ = (
        UniqueConstraint(
            "document_id",
            "document_version_id",
            "file_id",
            name="uq_document_file_version_identity",
        ),
        CheckConstraint("size_bytes IS NULL OR size_bytes >= 0", name="ck_document_files_size"),
        Index("ix_document_files_version", "document_id", "document_version_id"),
    )

    file_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("file")
    )
    document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False
    )
    document_version_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("document_versions.document_version_id", ondelete="CASCADE"),
        nullable=False,
    )
    uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(160), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(128), nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    document: Mapped[Document] = relationship(back_populates="files")
    document_version: Mapped[DocumentVersion] = relationship(back_populates="files")


class ExternalDocumentRef(Base, TimestampMixin):
    __tablename__ = "external_document_refs"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "external_system",
            "external_ref",
            name="uq_external_document_ref_identity",
        ),
        Index("ix_external_document_refs_entity", "tenant_id", "entity_type", "entity_id"),
        Index("ix_external_document_refs_document", "document_id"),
        Index("ix_external_document_refs_ingestion_status", "current_ingestion_status"),
        Index(
            "ix_external_document_refs_tenant_status_updated",
            "tenant_id",
            "current_ingestion_status",
            "updated_at",
        ),
        ForeignKeyConstraint(
            ["document_id", "current_document_version_id"],
            ["document_versions.document_id", "document_versions.document_version_id"],
            name="fk_external_document_refs_current_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["document_id", "current_document_version_id", "current_file_id"],
            ["document_files.document_id", "document_files.document_version_id", "document_files.file_id"],
            name="fk_external_document_refs_current_file",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "current_ingestion_job_id IS NULL "
            "OR (current_document_version_id IS NOT NULL "
            "AND current_ingestion_status IN ('QUEUED', 'INGESTING', 'INDEXED', 'FAILED'))",
            name="ck_external_document_refs_ingestion_shape",
        ),
    )

    external_document_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("extdoc")
    )
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False, default="org_stratos")
    external_system: Mapped[str] = mapped_column(String(80), nullable=False)
    external_ref: Mapped[str] = mapped_column(String(240), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False
    )
    current_document_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    current_file_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    current_ingestion_job_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    current_ingestion_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    akb_source_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    source_location: Mapped[dict[str, object] | None] = mapped_column(
        MutableDict.as_mutable(json_type()), nullable=True
    )
    citation_base_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    preview_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    ref_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )

    document: Mapped[Document] = relationship(back_populates="external_refs")


class IngestionAttempt(Base, TimestampMixin):
    __tablename__ = "ingestion_attempts"
    __table_args__ = (
        CheckConstraint(
            "ingestion_status IN ('QUEUED', 'INGESTING', 'INDEXED', 'FAILED')",
            name="ck_ingestion_attempt_status",
        ),
        ForeignKeyConstraint(
            ["document_id", "document_version_id"],
            ["document_versions.document_id", "document_versions.document_version_id"],
            ondelete="CASCADE",
            name="fk_ingestion_attempt_document_version",
        ),
        Index("ix_ingestion_attempts_job_id", "ingestion_job_id", unique=True),
        Index("ix_ingestion_attempts_status", "ingestion_status"),
    )

    document_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("documents.document_id", ondelete="CASCADE"),
        primary_key=True,
    )
    document_version_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    ingestion_job_id: Mapped[str] = mapped_column(String(128), nullable=False)
    ingestion_status: Mapped[str] = mapped_column(String(40), nullable=False)


class DocumentExtraction(Base, TimestampMixin):
    __tablename__ = "document_extractions"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "external_system",
            "external_ref",
            "document_id",
            "document_version_id",
            "profile",
            "profile_version",
            name="uq_document_extraction_identity",
        ),
        Index("ix_document_extractions_entity", "tenant_id", "external_system", "entity_type", "entity_id"),
        Index("ix_document_extractions_document_version", "document_id", "document_version_id"),
        Index("ix_document_extractions_status", "status"),
    )

    extraction_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("extract")
    )
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False)
    external_system: Mapped[str] = mapped_column(String(80), nullable=False)
    external_ref: Mapped[str] = mapped_column(String(240), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False
    )
    document_version_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("document_versions.document_version_id", ondelete="CASCADE"),
        nullable=False,
    )
    profile: Mapped[str] = mapped_column(String(80), nullable=False)
    profile_version: Mapped[str] = mapped_column(String(40), nullable=False, default="1")
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="PENDING")
    classification: Mapped[str] = mapped_column(String(32), nullable=False, default="internal")
    requested_by: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    result: Mapped[dict[str, object]] = mapped_column(
        MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )
    missing_information: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(json_type()), nullable=False, default=list
    )
    warnings: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(json_type()), nullable=False, default=list
    )
    extraction_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )

    document: Mapped[Document] = relationship(back_populates="extractions")
    feedback: Mapped[list["DocumentExtractionFeedback"]] = relationship(
        back_populates="extraction", cascade="all, delete-orphan"
    )


class DocumentExtractionFeedback(Base):
    __tablename__ = "document_extraction_feedback"
    __table_args__ = (
        Index("ix_document_extraction_feedback_extraction", "extraction_id", "created_at"),
        Index("ix_document_extraction_feedback_source", "source_app", "source_entity_id"),
    )

    feedback_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("extfb")
    )
    extraction_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("document_extractions.extraction_id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False)
    field: Mapped[str] = mapped_column(String(160), nullable=False)
    ai_value: Mapped[Any | None] = mapped_column(json_type(), nullable=True)
    final_value: Mapped[Any | None] = mapped_column(json_type(), nullable=True)
    decision: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    source_app: Mapped[str] = mapped_column(String(80), nullable=False)
    source_entity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    feedback_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    extraction: Mapped[DocumentExtraction] = relationship(back_populates="feedback")


class DocumentAccessPolicy(Base, TimestampMixin):
    __tablename__ = "document_access_policies"

    policy_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("pol")
    )
    document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False
    )
    subjects: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(json_type()), nullable=False, default=list
    )
    actions: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(json_type()), nullable=False, default=list
    )
    constraints: Mapped[dict[str, object]] = mapped_column(
        MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )

    document: Mapped[Document] = relationship(back_populates="access_policies")


class DocumentAssignment(Base, TimestampMixin):
    __tablename__ = "document_assignments"
    __table_args__ = (
        UniqueConstraint(
            "document_id",
            "role",
            "subject_type",
            "subject_id",
            name="uq_document_assignment_subject_role",
        ),
        Index("ix_document_assignments_document_role", "document_id", "role"),
        Index("ix_document_assignments_subject", "subject_type", "subject_id"),
        Index("ix_document_assignments_active", "active"),
    )

    assignment_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("assign")
    )
    document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    subject_type: Mapped[str] = mapped_column(String(32), nullable=False, default="user", index=True)
    subject_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    display_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sla_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    escalation_subject_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    escalation_subject_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    escalation_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    assigned_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_audit_event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    assignment_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )

    document: Mapped[Document] = relationship(back_populates="assignments")


class UserProfile(Base, TimestampMixin):
    __tablename__ = "user_profiles"

    user_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    username: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    identity_source: Mapped[str] = mapped_column(String(32), nullable=False, default="oidc", index=True)
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    profile_settings: Mapped[dict[str, object]] = mapped_column(
        "settings", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )


class RoleMapping(Base):
    __tablename__ = "role_mappings"
    __table_args__ = (
        UniqueConstraint("subject_type", "subject_id", "role", name="uq_role_mapping_subject_role"),
    )

    role_mapping_id: Mapped[str] = mapped_column(
        String(80), primary_key=True, default=lambda: make_id("rolemap")
    )
    subject_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    subject_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    assigned_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class AssistantConversation(Base, TimestampMixin):
    __tablename__ = "assistant_conversations"

    conversation_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    visibility: Mapped[str] = mapped_column(String(32), nullable=False, default="private", index=True)
    retention_until: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    messages: Mapped[list["AssistantMessage"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="AssistantMessage.created_at",
    )
    shares: Mapped[list["AssistantConversationShare"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
    )


class AssistantConversationShare(Base, TimestampMixin):
    __tablename__ = "assistant_conversation_shares"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id",
            "subject_type",
            "subject_id",
            name="uq_assistant_conversation_share_subject",
        ),
        Index("ix_assistant_conversation_shares_subject", "subject_type", "subject_id", "status"),
    )

    conversation_share_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("share")
    )
    conversation_id: Mapped[str] = mapped_column(
        String(80),
        ForeignKey("assistant_conversations.conversation_id", ondelete="CASCADE"),
        nullable=False,
    )
    subject_type: Mapped[str] = mapped_column(String(32), nullable=False, default="user", index=True)
    subject_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    subject_display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    permission: Mapped[str] = mapped_column(String(32), nullable=False, default="viewer")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False)

    conversation: Mapped[AssistantConversation] = relationship(back_populates="shares")


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"
    __table_args__ = (
        Index("ix_assistant_messages_conversation_created", "conversation_id", "created_at"),
        Index(
            "ix_assistant_messages_author_created",
            "author_subject_type",
            "author_subject_id",
            "created_at",
        ),
        CheckConstraint(
            "author_subject_type IN ('user', 'service')",
            name="assistant_messages_author_subject_type",
        ),
    )

    message_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("msg")
    )
    conversation_id: Mapped[str] = mapped_column(
        String(80),
        ForeignKey("assistant_conversations.conversation_id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    author_subject_id: Mapped[str] = mapped_column(String(128), nullable=False)
    author_subject_type: Mapped[str] = mapped_column(String(32), nullable=False)
    author_display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    response_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    citations: Mapped[list[dict[str, object]]] = mapped_column(
        MutableList.as_mutable(json_type()), nullable=False, default=list
    )
    message_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    conversation: Mapped[AssistantConversation] = relationship(back_populates="messages")
    feedback: Mapped[list["AssistantMessageFeedback"]] = relationship(
        back_populates="message",
        cascade="all, delete-orphan",
    )


class AssistantMessageFeedback(Base, TimestampMixin):
    __tablename__ = "assistant_message_feedback"
    __table_args__ = (
        UniqueConstraint(
            "message_id",
            "actor_id",
            name="uq_assistant_message_feedback_actor",
        ),
        Index(
            "ix_assistant_message_feedback_conversation_created",
            "conversation_id",
            "created_at",
        ),
        CheckConstraint(
            "rating IN ('helpful', 'not_helpful')",
            name="assistant_message_feedback_rating",
        ),
        CheckConstraint(
            "reason_code IS NULL OR reason_code IN "
            "('accurate_useful', 'incomplete', 'incorrect', "
            "'citation_problem', 'access_problem', 'other')",
            name="assistant_message_feedback_reason",
        ),
    )

    feedback_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("msgfb")
    )
    conversation_id: Mapped[str] = mapped_column(
        String(80),
        ForeignKey("assistant_conversations.conversation_id", ondelete="CASCADE"),
        nullable=False,
    )
    message_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("assistant_messages.message_id", ondelete="CASCADE"),
        nullable=False,
    )
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    rating: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    reason_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    message: Mapped[AssistantMessage] = relationship(back_populates="feedback")


class AnalystCase(Base, TimestampMixin):
    __tablename__ = "analyst_cases"
    __table_args__ = (
        Index("ix_analyst_cases_owner_status", "owner_id", "status"),
        Index("ix_analyst_cases_updated", "updated_at"),
        CheckConstraint("status IN ('open', 'archived')", name="ck_analyst_cases_status"),
        CheckConstraint(
            "classification IN ('public', 'internal', 'restricted', 'confidential')",
            name="ck_analyst_cases_classification",
        ),
    )

    case_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("case")
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="open", index=True)
    owner_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    classification: Mapped[str] = mapped_column(String(32), nullable=False, default="internal", index=True)
    tags: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(json_type()), nullable=False, default=list
    )
    case_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )

    saved_queries: Mapped[list["AnalystSavedQuery"]] = relationship(
        back_populates="case",
        cascade="all, delete-orphan",
        order_by="AnalystSavedQuery.created_at",
    )
    evidence_items: Mapped[list["AnalystEvidenceItem"]] = relationship(
        back_populates="case",
        cascade="all, delete-orphan",
        order_by="AnalystEvidenceItem.created_at",
    )


class AnalystSavedQuery(Base):
    __tablename__ = "analyst_saved_queries"
    __table_args__ = (
        Index("ix_analyst_saved_queries_case", "case_id", "created_at"),
        CheckConstraint(
            "query_mode IN ('smart', 'simple', 'advanced', 'fielded')",
            name="ck_analyst_saved_queries_mode",
        ),
    )

    saved_query_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("qry")
    )
    case_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("analyst_cases.case_id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    query_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="smart")
    search_fields: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(json_type()), nullable=False, default=list
    )
    filters: Mapped[dict[str, object]] = mapped_column(
        MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    case: Mapped[AnalystCase] = relationship(back_populates="saved_queries")


class AnalystEvidenceItem(Base):
    __tablename__ = "analyst_evidence_items"
    __table_args__ = (
        Index("ix_analyst_evidence_case", "case_id", "created_at"),
        Index("ix_analyst_evidence_document", "document_id", "document_version_id"),
        Index("ix_analyst_evidence_chunk", "chunk_id"),
        CheckConstraint("page_number IS NULL OR page_number > 0", name="ck_analyst_evidence_page"),
        CheckConstraint("score IS NULL OR score >= 0", name="ck_analyst_evidence_score"),
    )

    evidence_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("evd")
    )
    case_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("analyst_cases.case_id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    document_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    document_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    chunk_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    section_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    source_file_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    score: Mapped[float | None] = mapped_column(nullable=True)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    entity_types: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(json_type()), nullable=False, default=list
    )
    entity_values: Mapped[list[str]] = mapped_column(
        MutableList.as_mutable(json_type()), nullable=False, default=list
    )
    evidence_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    case: Mapped[AnalystCase] = relationship(back_populates="evidence_items")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_actor_created", "actor_id", "created_at"),
        Index("ix_audit_events_resource", "resource_type", "resource_id"),
        CheckConstraint(
            "occurrence_count >= 1",
            name="audit_event_occurrence_count_positive",
        ),
    )

    audit_event_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("audit")
    )
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    resource_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="info")
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    aggregate_key: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )
    event_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class IntegrationIdempotencyRecord(Base, TimestampMixin):
    __tablename__ = "integration_idempotency_records"
    __table_args__ = (
        UniqueConstraint(
            "client_id",
            "operation",
            "idempotency_key",
            name="uq_integration_idempotency_identity",
        ),
        Index("ix_integration_idempotency_expires", "expires_at"),
    )

    record_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("idem")
    )
    client_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    operation: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="processing", index=True)
    response_status: Mapped[int | None] = mapped_column(nullable=True)
    response_body: Mapped[dict[str, object] | None] = mapped_column(
        MutableDict.as_mutable(json_type()), nullable=True
    )
    audit_event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class WorkflowTask(Base, TimestampMixin):
    __tablename__ = "workflow_tasks"
    __table_args__ = (
        UniqueConstraint("source_key", name="uq_workflow_tasks_source_key"),
        Index("ix_workflow_tasks_status_priority", "status", "priority"),
        Index("ix_workflow_tasks_document_status", "document_id", "status"),
        Index("ix_workflow_tasks_owner_status", "owner_id", "status"),
    )

    task_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("task")
    )
    source_key: Mapped[str | None] = mapped_column(String(220), nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    priority: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="open", index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(160), nullable=False)
    owner_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    owner_label: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(120), nullable=False)
    document_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=True
    )
    document_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    document_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    audit_event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    job_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    task_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )

    document: Mapped[Document | None] = relationship(back_populates="workflow_tasks")
