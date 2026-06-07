from datetime import date, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DocumentType(str, Enum):
    directive = "directive"
    regulation = "regulation"
    methodology = "methodology"
    policy = "policy"
    procedure = "procedure"
    manual = "manual"
    knowledge_base_article = "knowledge_base_article"
    project_documentation = "project_documentation"
    meeting_record = "meeting_record"
    contract = "contract"
    attachment = "attachment"
    other = "other"


class DocumentStatus(str, Enum):
    draft = "draft"
    review = "review"
    approved = "approved"
    valid = "valid"
    superseded = "superseded"
    archived = "archived"
    cancelled = "cancelled"


class Classification(str, Enum):
    public = "public"
    internal = "internal"
    restricted = "restricted"
    confidential = "confidential"


class ExternalSourceSystem(str, Enum):
    stratos_budget = "STRATOS_BUDGET"
    stratos_projectflow = "STRATOS_PROJECTFLOW"
    stratos_archflow = "STRATOS_ARCHFLOW"
    stratos_processforge = "STRATOS_PROCESSFORGE"
    stratos_executive = "STRATOS_EXECUTIVE"
    stratos_platform = "STRATOS_PLATFORM"


class SourceLocationKind(str, Enum):
    url = "url"
    uploaded_file = "uploaded_file"
    object_storage = "object_storage"
    generated_text = "generated_text"
    external_repository = "external_repository"


class SourceLocation(BaseModel):
    kind: SourceLocationKind
    uri: str | None = Field(default=None, max_length=2048)
    file_name: str | None = Field(default=None, max_length=300)
    content_type: str | None = Field(default=None, max_length=160)
    sha256: str | None = Field(default=None, max_length=128)
    storage_ref: str | None = Field(default=None, max_length=1024)
    captured_at: datetime | None = None
    display_url: str | None = Field(default=None, max_length=2048)
    repository: str | None = Field(default=None, max_length=200)
    path: str | None = Field(default=None, max_length=1024)
    version: str | None = Field(default=None, max_length=160)

    @field_validator("sha256")
    @classmethod
    def validate_sha256(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.removeprefix("sha256:")
        if len(normalized) != 64 or any(char not in "0123456789abcdefABCDEF" for char in normalized):
            raise ValueError("sha256 must be a 64-character hex digest, optionally prefixed with sha256:")
        return value


class Action(str, Enum):
    document_create = "document.create"
    document_read = "document.read"
    document_update = "document.update"
    document_delete = "document.delete"
    document_version_create = "document.version.create"
    document_version_publish = "document.version.publish"
    document_version_archive = "document.version.archive"
    document_ingest = "document.ingest"
    document_reindex = "document.reindex"
    rag_query = "rag.query"
    rag_compare = "rag.compare"
    rag_check_compliance = "rag.check_compliance"
    workflow_task_read = "workflow.task.read"
    workflow_task_write = "workflow.task.write"
    audit_read = "audit.read"
    audit_write = "audit.write"
    admin_manage = "admin.manage"


class AuditSeverity(str, Enum):
    debug = "debug"
    info = "info"
    warning = "warning"
    error = "error"
    critical = "critical"


class WorkflowTaskKind(str, Enum):
    review = "review"
    draft = "draft"
    ingestion = "ingestion"
    governance = "governance"
    audit = "audit"


class WorkflowTaskPriority(str, Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class WorkflowTaskStatus(str, Enum):
    open = "open"
    waiting = "waiting"
    blocked = "blocked"
    resolved = "resolved"
    cancelled = "cancelled"


class WorkflowTaskAction(str, Enum):
    assign = "assign"
    request_changes = "request_changes"
    approve = "approve"
    publish = "publish"
    archive = "archive"
    resolve = "resolve"


class DocumentAssignmentRole(str, Enum):
    owner = "owner"
    gestor = "gestor"
    reviewer = "reviewer"
    approver = "approver"
    auditor = "auditor"
    steward = "steward"


class AssignmentSubjectType(str, Enum):
    user = "user"
    group = "group"
    unit = "unit"
    service = "service"


class ErrorEnvelope(BaseModel):
    error: dict[str, Any]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


class AccessPolicyBase(BaseModel):
    subjects: list[str] = Field(min_length=1)
    actions: list[Action] = Field(min_length=1)
    constraints: dict[str, Any] = Field(default_factory=dict)


class AccessPolicyCreate(AccessPolicyBase):
    pass


class AccessPolicyResponse(AccessPolicyBase):
    model_config = ConfigDict(from_attributes=True)

    policy_id: str
    document_id: str
    created_at: datetime
    updated_at: datetime


class DocumentAssignmentBase(BaseModel):
    role: DocumentAssignmentRole
    subject_type: AssignmentSubjectType = AssignmentSubjectType.user
    subject_id: str = Field(min_length=1, max_length=128)
    display_label: str | None = Field(default=None, max_length=200)
    is_primary: bool = False
    active: bool = True
    sla_days: int | None = Field(default=None, ge=1, le=365)
    escalation_subject_type: AssignmentSubjectType | None = None
    escalation_subject_id: str | None = Field(default=None, max_length=128)
    escalation_label: str | None = Field(default=None, max_length=200)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentAssignmentCreate(DocumentAssignmentBase):
    pass


class DocumentAssignmentResponse(DocumentAssignmentBase):
    model_config = ConfigDict(from_attributes=True)

    assignment_id: str
    document_id: str
    assigned_by: str | None
    assigned_at: datetime
    last_audit_event_id: str | None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="assignment_metadata")
    created_at: datetime
    updated_at: datetime


class DocumentAssignmentListResponse(BaseModel):
    items: list[DocumentAssignmentResponse]


class DocumentAssignmentReplaceRequest(BaseModel):
    assignments: list[DocumentAssignmentCreate] = Field(min_length=1, max_length=50)


class DocumentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    document_type: DocumentType
    owner_id: str = Field(min_length=1, max_length=128)
    gestor_unit: str | None = Field(default=None, max_length=128)
    classification: Classification = Classification.internal
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    access_policies: list[AccessPolicyCreate] | None = None
    assignments: list[DocumentAssignmentCreate] | None = None


class DocumentPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    document_type: DocumentType | None = None
    status: DocumentStatus | None = None
    owner_id: str | None = Field(default=None, min_length=1, max_length=128)
    gestor_unit: str | None = Field(default=None, max_length=128)
    classification: Classification | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    access_policies: list[AccessPolicyCreate] | None = None
    assignments: list[DocumentAssignmentCreate] | None = None


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: str
    title: str
    document_type: DocumentType
    status: DocumentStatus
    classification: Classification
    owner_id: str
    owner: str
    gestor_unit: str | None
    tags: list[str]
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="document_metadata")
    created_at: datetime
    updated_at: datetime
    access_policies: list[AccessPolicyResponse] = Field(default_factory=list)
    assignments: list[DocumentAssignmentResponse] = Field(default_factory=list)


class DocumentListResponse(BaseModel):
    items: list[DocumentResponse]
    limit: int
    offset: int


class ExternalDocumentOwner(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=200)


class ExternalDocumentUpsertRequest(BaseModel):
    external_system: ExternalSourceSystem
    external_ref: str = Field(min_length=1, max_length=240)
    entity_type: str = Field(min_length=1, max_length=80)
    entity_id: str = Field(min_length=1, max_length=128)
    document_type: DocumentType
    title: str = Field(min_length=1, max_length=300)
    classification: Classification = Classification.internal
    owner: ExternalDocumentOwner
    tenant_id: str = Field(default="default", min_length=1, max_length=128)
    gestor_unit: str | None = Field(default=None, max_length=128)
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    source_location: SourceLocation | None = None
    akb_source_uri: str | None = Field(default=None, max_length=1024)
    citation_base_url: str | None = Field(default=None, max_length=512)
    preview_url: str | None = Field(default=None, max_length=2048)
    access_policies: list[AccessPolicyCreate] | None = None
    assignments: list[DocumentAssignmentCreate] | None = None


class ExternalDocumentRefResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    external_document_id: str
    tenant_id: str
    external_system: str
    external_ref: str
    entity_type: str
    entity_id: str
    document_id: str
    current_document_version_id: str | None
    current_file_id: str | None
    current_ingestion_job_id: str | None
    current_ingestion_status: str | None
    akb_source_uri: str | None
    source_location: SourceLocation | None
    citation_base_url: str | None
    preview_url: str | None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="ref_metadata")
    created_at: datetime
    updated_at: datetime


class ExternalDocumentResponse(BaseModel):
    external_document: ExternalDocumentRefResponse
    document: DocumentResponse
    created: bool = False


class DocumentFileCreate(BaseModel):
    filename: str | None = Field(default=None, max_length=300)
    mime_type: str | None = Field(default=None, max_length=160)
    size_bytes: int | None = Field(default=None, ge=0)
    sha256: str | None = Field(default=None, max_length=128)
    uploaded_by: str | None = Field(default=None, max_length=128)

    @field_validator("sha256")
    @classmethod
    def validate_sha256(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith("sha256:"):
            raise ValueError("sha256 must use the sha256:<hash> format")
        return value


class DocumentVersionCreate(BaseModel):
    version_label: str = Field(min_length=1, max_length=80)
    valid_from: date | None = None
    valid_to: date | None = None
    source_file_uri: str = Field(min_length=1, max_length=1024)
    source_location: SourceLocation | None = None
    file_hash: str | None = Field(default=None, max_length=128)
    change_summary: str | None = None
    file: DocumentFileCreate | None = None

    @field_validator("file_hash")
    @classmethod
    def validate_file_hash(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith("sha256:"):
            raise ValueError("file_hash must use the sha256:<hash> format")
        return value


class DocumentVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_version_id: str
    document_id: str
    version_label: str
    status: DocumentStatus
    valid_from: date | None
    valid_to: date | None
    source_file_uri: str
    source_location: SourceLocation | None
    file_hash: str | None
    change_summary: str | None
    created_at: datetime
    published_at: datetime | None


class DocumentVersionListResponse(BaseModel):
    items: list[DocumentVersionResponse]
    limit: int
    offset: int


class AuthzResource(BaseModel):
    document_id: str | None = None
    document_version_id: str | None = None
    classification: Classification | None = None


class AuthzCheckRequest(BaseModel):
    subject_id: str = Field(min_length=1, max_length=128)
    action: Action
    resource: AuthzResource = Field(default_factory=AuthzResource)
    roles: list[str] = Field(default_factory=list)
    groups: list[str] = Field(default_factory=list)


class AuthzCheckResponse(BaseModel):
    allowed: bool
    reason: str
    constraints: dict[str, Any] = Field(default_factory=dict)


class AuthzFilterDocumentsRequest(BaseModel):
    subject_id: str = Field(min_length=1, max_length=128)
    action: Action
    candidate_document_ids: list[str] = Field(min_length=1, max_length=1000)
    roles: list[str] = Field(default_factory=list)
    groups: list[str] = Field(default_factory=list)


class AuthzFilterDocumentsResponse(BaseModel):
    allowed_document_ids: list[str]
    denied_document_ids: list[str]


class AuditEventCreate(BaseModel):
    actor_id: str = Field(min_length=1, max_length=128)
    event_type: str = Field(min_length=1, max_length=160)
    resource_type: str = Field(min_length=1, max_length=80)
    resource_id: str = Field(min_length=1, max_length=128)
    severity: AuditSeverity = AuditSeverity.info
    correlation_id: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AuditEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    audit_event_id: str
    actor_id: str
    event_type: str
    resource_type: str
    resource_id: str
    severity: AuditSeverity
    correlation_id: str | None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="event_metadata")
    created_at: datetime


class AuditEventListResponse(BaseModel):
    items: list[AuditEventResponse]
    limit: int
    offset: int


class WorkflowTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: str
    source_key: str | None
    kind: WorkflowTaskKind
    priority: WorkflowTaskPriority
    status: WorkflowTaskStatus
    title: str
    description: str
    source: str
    owner_id: str | None
    owner_label: str
    role: str
    document_id: str | None
    document_title: str | None
    document_version_id: str | None
    audit_event_id: str | None
    job_id: str | None
    due_at: datetime
    resolved_at: datetime | None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="task_metadata")
    created_at: datetime
    updated_at: datetime


class WorkflowTaskListResponse(BaseModel):
    items: list[WorkflowTaskResponse]
    limit: int
    offset: int


class WorkflowTaskActionRequest(BaseModel):
    action: WorkflowTaskAction
    comment: str | None = Field(default=None, max_length=1000)
    assignee_id: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)
