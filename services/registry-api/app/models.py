from datetime import date, datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
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

    document_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("doc")
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    document_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)
    classification: Mapped[str] = mapped_column(
        String(32), nullable=False, default="internal", index=True
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

    @property
    def owner(self) -> str:
        return self.owner_id


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (
        UniqueConstraint("document_id", "version_label", name="uq_document_version_label"),
        Index("ix_document_versions_document_status", "document_id", "status"),
    )

    document_version_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("ver")
    )
    document_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False
    )
    version_label: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)
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


class DocumentFile(Base):
    __tablename__ = "document_files"

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
    )

    external_document_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: make_id("extdoc")
    )
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False, default="default")
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_actor_created", "actor_id", "created_at"),
        Index("ix_audit_events_resource", "resource_type", "resource_id"),
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
    event_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", MutableDict.as_mutable(json_type()), nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


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
