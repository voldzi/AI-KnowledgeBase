from datetime import date, datetime
from enum import Enum
import unicodedata
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator

from app.information_policy import (
    AiipUploadIntegrationEnvelope,
    InformationPolicyBinding,
    IntegrationEnvelope,
    canonical_policy_hash,
)


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
    ai_intake = "ai_intake"
    ai_requirement_card = "ai_requirement_card"
    ai_security_appendix = "ai_security_appendix"
    ai_governance_evidence = "ai_governance_evidence"
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
    stratos_aiip = "STRATOS_AIIP"
    stratos_processforge = "STRATOS_PROCESSFORGE"
    stratos_executive = "STRATOS_EXECUTIVE"
    stratos_platform = "STRATOS_PLATFORM"


class DocumentExtractionStatus(str, Enum):
    pending = "PENDING"
    running = "RUNNING"
    proposed = "PROPOSED"
    partial = "PARTIAL"
    failed = "FAILED"
    superseded = "SUPERSEDED"
    accepted_in_source_app = "ACCEPTED_IN_SOURCE_APP"
    rejected_in_source_app = "REJECTED_IN_SOURCE_APP"


class DocumentExtractionFeedbackDecision(str, Enum):
    accepted = "accepted"
    rejected = "rejected"
    edited = "edited"


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


class AiipSourceLocation(SourceLocation):
    model_config = ConfigDict(extra="forbid")

    sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    path: str = Field(min_length=1, max_length=1024)


class GovernanceScope(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    type: Literal[
        "own",
        "organization",
        "organization_unit",
        "budget_scope",
        "portfolio",
        "project",
        "document",
        "recipient_set",
    ]
    id: str | None = Field(default=None, min_length=1, max_length=160)
    owner_subject_id: str | None = Field(
        default=None,
        alias="ownerSubjectId",
        min_length=1,
        max_length=160,
    )

    @model_validator(mode="after")
    def require_scope_id(self) -> "GovernanceScope":
        if self.type == "own":
            if self.id is not None or not self.owner_subject_id:
                raise ValueError("An own governance scope requires ownerSubjectId and forbids id")
            return self
        if self.owner_subject_id is not None:
            raise ValueError("ownerSubjectId is valid only for an own governance scope")
        if self.type != "organization" and not self.id:
            raise ValueError("A non-organization governance scope requires id")
        if self.type == "organization" and self.id not in {None, "org_stratos"}:
            raise ValueError("AKB organization scope must identify org_stratos")
        return self


def _is_aiip_secret_sensitivity(value: str) -> bool:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return normalized.strip().casefold() == "tajne"


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
    rag_export = "rag.export"
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
    information_policy: InformationPolicyBinding | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    access_policies: list[AccessPolicyCreate] | None = None
    assignments: list[DocumentAssignmentCreate] | None = None
    governance_scope: GovernanceScope | None = None
    parent_governed_resource_id: str | None = Field(default=None, max_length=128)


class DocumentPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    document_type: DocumentType | None = None
    status: DocumentStatus | None = None
    owner_id: str | None = Field(default=None, min_length=1, max_length=128)
    gestor_unit: str | None = Field(default=None, max_length=128)
    classification: Classification | None = None
    information_policy: InformationPolicyBinding | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    access_policies: list[AccessPolicyCreate] | None = None
    assignments: list[DocumentAssignmentCreate] | None = None
    governance_scope: GovernanceScope | None = None
    parent_governed_resource_id: str | None = Field(default=None, max_length=128)


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: str
    title: str
    document_type: DocumentType
    status: DocumentStatus
    classification: Classification
    organization_id: str
    policy_binding_id: str | None
    policy_version: str | None
    policy_hash: str | None
    policy_summary: dict[str, Any] = Field(default_factory=dict)
    governed_resource_id: str | None = None
    governed_source_version: str | None = None
    governed_parent_resource_id: str | None = None
    governance_scope_type: str = "organization"
    governance_scope_id: str | None = "org_stratos"
    governance_scope_owner_subject_id: str | None = None
    governance_registration_status: str = "LEGACY_UNREGISTERED"
    governance_registered_at: datetime | None = None
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


class DocumentMetadataSummaryBucket(BaseModel):
    key: str
    label: str
    count: int


class DocumentMetadataSummaryTopic(BaseModel):
    topic: str
    document_count: int
    valid_or_approved_count: int
    document_types: list[DocumentMetadataSummaryBucket] = Field(default_factory=list)
    classifications: list[DocumentMetadataSummaryBucket] = Field(default_factory=list)
    statuses: list[DocumentMetadataSummaryBucket] = Field(default_factory=list)
    owners: list[DocumentMetadataSummaryBucket] = Field(default_factory=list)
    example_documents: list[str] = Field(default_factory=list)


class DocumentMetadataSummaryResponse(BaseModel):
    total_visible_documents: int
    total_matched_documents: int
    topics: list[DocumentMetadataSummaryTopic]
    by_document_type: list[DocumentMetadataSummaryBucket]
    by_classification: list[DocumentMetadataSummaryBucket]
    by_status: list[DocumentMetadataSummaryBucket]
    by_owner: list[DocumentMetadataSummaryBucket]
    warnings: list[str] = Field(default_factory=list)


class DocumentReadinessSeverity(str, Enum):
    critical = "critical"
    warning = "warning"
    info = "info"


class DocumentReadinessIssue(BaseModel):
    code: str
    severity: DocumentReadinessSeverity
    document_id: str
    title: str
    recommendation: str
    details: dict[str, Any] = Field(default_factory=dict)


class DocumentReadinessResponse(BaseModel):
    generated_at: datetime
    total_visible_documents: int
    ready_documents: int
    review_documents: int
    blocked_documents: int
    readiness_score: float = Field(ge=0.0, le=1.0)
    issue_counts: list[DocumentMetadataSummaryBucket] = Field(default_factory=list)
    by_severity: list[DocumentMetadataSummaryBucket] = Field(default_factory=list)
    by_document_type: list[DocumentMetadataSummaryBucket] = Field(default_factory=list)
    by_classification: list[DocumentMetadataSummaryBucket] = Field(default_factory=list)
    by_status: list[DocumentMetadataSummaryBucket] = Field(default_factory=list)
    issues: list[DocumentReadinessIssue] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


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
    information_policy: InformationPolicyBinding | None = None
    integration_envelope: IntegrationEnvelope | None = None
    owner: ExternalDocumentOwner
    tenant_id: str = Field(default="org_stratos", min_length=1, max_length=128)
    gestor_unit: str | None = Field(default=None, max_length=128)
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    source_location: SourceLocation | None = None
    akb_source_uri: str | None = Field(default=None, max_length=1024)
    citation_base_url: str | None = Field(default=None, max_length=512)
    preview_url: str | None = Field(default=None, max_length=2048)
    access_policies: list[AccessPolicyCreate] | None = None
    assignments: list[DocumentAssignmentCreate] | None = None
    governance_scope: GovernanceScope | None = None
    parent_governed_resource_id: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def reject_aiip_classified_sensitivity(self) -> "ExternalDocumentUpsertRequest":
        if self.external_system != ExternalSourceSystem.stratos_aiip:
            return self
        aiip_metadata = self.metadata.get("aiip")
        if not isinstance(aiip_metadata, dict):
            return self
        for key in ("sensitivity", "input_data_sensitivity", "output_data_sensitivity"):
            value = aiip_metadata.get(key)
            if isinstance(value, str) and _is_aiip_secret_sensitivity(value):
                raise ValueError("AIIP documents marked as Tajne require a classified boundary and cannot be ingested")
        return self

    @model_validator(mode="after")
    def validate_information_envelope(self) -> "ExternalDocumentUpsertRequest":
        if self.integration_envelope is None:
            return self
        if self.information_policy is None:
            raise ValueError("integration_envelope requires information_policy")
        envelope = self.integration_envelope
        policy = self.information_policy
        if envelope.policy_binding_id != policy.policy_binding_id:
            raise ValueError("integration envelope policyBindingId does not match information_policy")
        if envelope.policy_hash != canonical_policy_hash(policy):
            raise ValueError("integration envelope policyHash does not match information_policy")
        if envelope.classification.handling_class != policy.handling_class:
            raise ValueError("integration envelope handlingClass does not match information_policy")
        if envelope.classification.tlp != policy.tlp or envelope.classification.pap != policy.pap:
            raise ValueError("integration envelope TLP/PAP does not match information_policy")
        return self


class ExternalDocumentCurrentUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_document_version_id: str | None = Field(default=None, max_length=64)
    current_file_id: str | None = Field(default=None, max_length=64)
    expected_current_ingestion_job_id: str | None = Field(default=None, max_length=128)
    current_ingestion_job_id: str | None = Field(default=None, max_length=128)
    current_ingestion_status: str | None = Field(default=None, max_length=40)
    akb_source_uri: str | None = Field(default=None, max_length=1024)
    source_location: SourceLocation | None = None


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


class IngestionAttemptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: str
    document_version_id: str
    ingestion_job_id: str
    ingestion_status: Literal["QUEUED", "INGESTING", "INDEXED", "FAILED"]
    created_at: datetime
    updated_at: datetime


class ExternalDocumentCurrentListResponse(BaseModel):
    document_id: str
    updated: int
    items: list[ExternalDocumentRefResponse] = Field(default_factory=list)
    ingestion_attempt: IngestionAttemptResponse | None = None


class ExternalDocumentResponse(BaseModel):
    external_document: ExternalDocumentRefResponse
    document: DocumentResponse
    created: bool = False


class AiipExternalDocumentUpsertRequest(BaseModel):
    """Narrow server-to-server contract for the AIIP document upload preflight."""

    model_config = ConfigDict(extra="forbid")

    tenant_id: Literal["org_stratos"]
    external_system: Literal["STRATOS_AIIP"]
    external_ref: str = Field(min_length=1, max_length=240)
    entity_type: Literal["InnovationRequest", "InnovationRequestImport"]
    entity_id: str = Field(min_length=1, max_length=128)
    document_type: Literal[
        "ai_intake",
        "ai_requirement_card",
        "ai_security_appendix",
        "ai_governance_evidence",
        "knowledge_base_article",
        "project_documentation",
        "attachment",
        "other",
    ]
    title: str = Field(min_length=1, max_length=300)
    classification: Classification
    information_policy: InformationPolicyBinding
    integration_envelope: AiipUploadIntegrationEnvelope
    governance_scope: GovernanceScope
    tags: list[str] = Field(default_factory=list)
    source_location: AiipSourceLocation
    citation_base_url: str | None = Field(default=None, max_length=512)
    preview_url: str | None = Field(default=None, max_length=2048)

    @model_validator(mode="after")
    def validate_governed_source(self) -> "AiipExternalDocumentUpsertRequest":
        envelope = self.integration_envelope
        policy = self.information_policy
        if envelope.source_system != "STRATOS_AIIP" or envelope.actor.type != "person":
            raise ValueError("AIIP upload requires a person-authored STRATOS_AIIP envelope")
        if envelope.source_resource is None:
            raise ValueError("AIIP upload requires sourceResource")
        if envelope.external_ref != self.external_ref:
            raise ValueError("integration envelope externalRef does not match external_ref")
        if envelope.policy_binding_id != policy.policy_binding_id:
            raise ValueError("integration envelope policyBindingId does not match information_policy")
        if envelope.classification.handling_class != policy.handling_class:
            raise ValueError("integration envelope handlingClass does not match information_policy")
        if envelope.classification.tlp != policy.tlp or envelope.classification.pap != policy.pap:
            raise ValueError("integration envelope TLP/PAP does not match information_policy")
        policy_handling_class = (
            policy.handling_class.value
            if hasattr(policy.handling_class, "value")
            else str(policy.handling_class)
        )
        expected_classification = {
            "PUBLIC": Classification.public,
            "INTERNAL": Classification.internal,
            "RESTRICTED": Classification.restricted,
        }[policy_handling_class]
        if self.classification != expected_classification:
            raise ValueError("classification does not match information_policy")
        envelope_payload = envelope.payload
        if (
            envelope_payload.entity_type != self.entity_type
            or envelope_payload.entity_id != self.entity_id
            or envelope.source_resource.resource_id != self.entity_id
            or envelope_payload.source_document_id != self.source_location.path
            or envelope_payload.sha256 != self.source_location.sha256
        ):
            raise ValueError("AIIP payload does not match entity/source_location lineage")
        if envelope.source_resource.scope.model_dump(
            mode="json", by_alias=True, exclude_none=True
        ) != self.governance_scope.model_dump(mode="json", by_alias=True, exclude_none=True):
            raise ValueError("governance_scope does not match sourceResource.scope")
        return self


class AiipGovernanceParentSourceResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    governed_resource_id: str = Field(min_length=1)
    application: Literal["AIIP"]
    resource_type: Literal["idea"]
    resource_id: str = Field(min_length=1)
    source_version: str = Field(min_length=1)
    scope: GovernanceScope

    @field_serializer("scope")
    def serialize_scope(self, value: GovernanceScope) -> dict[str, object]:
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)


class AiipGovernanceEffectivePolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy_binding_id: str = Field(min_length=1)
    policy_version: Literal["information-policy-2.0.0"]
    policy_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    originator_id: str | None
    issued_at: datetime | None
    review_at: datetime | None


class AiipGovernedResourceConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    application: Literal["AKB"]
    resource_type: Literal["document", "document-version"]
    resource_id: str = Field(min_length=1)
    source_version: str = Field(min_length=1)
    parent_id: str = Field(min_length=1)
    scope: GovernanceScope
    policy_assignment: Literal["INHERITED"]
    explicit_policy_binding_id: None
    inherited_from_resource_id: str = Field(min_length=1)
    effective_policy: AiipGovernanceEffectivePolicy
    registered_by_subject_id: str = Field(min_length=1)
    confirmed_by_subject_id: str = Field(min_length=1)

    @field_serializer("scope")
    def serialize_scope(self, value: GovernanceScope) -> dict[str, object]:
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)


class AiipGovernanceConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parent_source_resource: AiipGovernanceParentSourceResource
    governed_resource: AiipGovernedResourceConfirmation
    document_policy_binding_id: str = Field(min_length=1)
    document_policy_version: Literal["information-policy-2.0.0"]
    document_policy_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    actor_subject_id: str = Field(min_length=1)
    correlation_id: str = Field(min_length=8)
    idempotency_key: str = Field(min_length=8)


class AiipExternalDocumentUpsertResponse(ExternalDocumentResponse):
    model_config = ConfigDict(extra="forbid")

    governance_confirmation: AiipGovernanceConfirmation


class DocumentExtractionStoreRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=128)
    external_system: ExternalSourceSystem
    external_ref: str = Field(min_length=1, max_length=240)
    entity_type: str = Field(min_length=1, max_length=80)
    entity_id: str = Field(min_length=1, max_length=128)
    document_id: str = Field(min_length=1, max_length=64)
    document_version_id: str = Field(min_length=1, max_length=64)
    profile: str = Field(min_length=1, max_length=80)
    profile_version: str = Field(default="1", min_length=1, max_length=40)
    status: DocumentExtractionStatus = DocumentExtractionStatus.proposed
    classification: Classification = Classification.internal
    requested_by: str = Field(min_length=1, max_length=128)
    correlation_id: str | None = Field(default=None, max_length=128)
    result: dict[str, Any] = Field(default_factory=dict)
    missing_information: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentExtractionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    extraction_id: str
    tenant_id: str
    external_system: str
    external_ref: str
    entity_type: str
    entity_id: str
    document_id: str
    document_version_id: str
    profile: str
    profile_version: str
    status: DocumentExtractionStatus
    classification: Classification
    requested_by: str
    correlation_id: str | None
    result: dict[str, Any] = Field(default_factory=dict)
    missing_information: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="extraction_metadata")
    created_at: datetime
    updated_at: datetime


class DocumentExtractionStoreResponse(BaseModel):
    extraction: DocumentExtractionResponse
    created: bool = False


class DocumentExtractionFeedbackCreate(BaseModel):
    field: str = Field(min_length=1, max_length=160)
    ai_value: Any | None = None
    final_value: Any | None = None
    decision: DocumentExtractionFeedbackDecision
    reason: str | None = Field(default=None, max_length=2000)
    actor: str = Field(min_length=1, max_length=128)
    source_app: ExternalSourceSystem
    source_entity_id: str = Field(min_length=1, max_length=128)
    correlation_id: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentExtractionFeedbackResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    feedback_id: str
    extraction_id: str
    tenant_id: str
    field: str
    ai_value: Any | None = None
    final_value: Any | None = None
    decision: DocumentExtractionFeedbackDecision
    reason: str | None
    actor_id: str
    source_app: str
    source_entity_id: str
    correlation_id: str | None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="feedback_metadata")
    created_at: datetime


class DocumentExtractionFeedbackStoreResponse(BaseModel):
    feedback: DocumentExtractionFeedbackResponse
    extraction: DocumentExtractionResponse


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


class AiipDocumentFileCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=300)
    mime_type: str = Field(min_length=1, max_length=160)
    size_bytes: int = Field(ge=1)
    sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class AiipDocumentVersionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_label: str = Field(min_length=1, max_length=80)
    valid_from: date | None = None
    valid_to: date | None = None
    source_file_uri: str = Field(min_length=1, max_length=1024)
    source_location: AiipSourceLocation
    file_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    change_summary: str | None = None
    information_policy: InformationPolicyBinding
    integration_envelope: AiipUploadIntegrationEnvelope
    governance_scope: GovernanceScope
    file: AiipDocumentFileCreate

    @model_validator(mode="after")
    def validate_governed_version(self) -> "AiipDocumentVersionCreate":
        envelope = self.integration_envelope
        policy = self.information_policy
        if envelope.source_system != "STRATOS_AIIP" or envelope.actor.type != "person":
            raise ValueError("AIIP upload requires a person-authored STRATOS_AIIP envelope")
        if envelope.source_resource is None:
            raise ValueError("AIIP upload requires sourceResource")
        if (
            envelope.source_resource.scope.type == "own"
            and envelope.source_resource.scope.owner_subject_id
            != envelope.actor.subject_id
        ):
            raise ValueError("AIIP own upload scope must belong to the envelope actor")
        if envelope.policy_binding_id != policy.policy_binding_id:
            raise ValueError("integration envelope policyBindingId does not match information_policy")
        if envelope.classification.handling_class != policy.handling_class:
            raise ValueError("integration envelope handlingClass does not match information_policy")
        if envelope.classification.tlp != policy.tlp or envelope.classification.pap != policy.pap:
            raise ValueError("integration envelope TLP/PAP does not match information_policy")
        if self.file.sha256 != self.file_hash:
            raise ValueError("file.sha256 does not match file_hash")
        if (
            envelope.payload.sha256 != self.file_hash
            or envelope.payload.source_document_id != self.source_location.path
            or self.source_location.sha256 != self.file_hash
        ):
            raise ValueError("AIIP envelope/source_location does not match file_hash")
        if envelope.source_resource.scope.model_dump(
            mode="json", by_alias=True, exclude_none=True
        ) != self.governance_scope.model_dump(mode="json", by_alias=True, exclude_none=True):
            raise ValueError("governance_scope does not match sourceResource.scope")
        return self


class DocumentVersionCreate(BaseModel):
    version_label: str = Field(min_length=1, max_length=80)
    valid_from: date | None = None
    valid_to: date | None = None
    source_file_uri: str = Field(min_length=1, max_length=1024)
    source_location: SourceLocation | None = None
    file_hash: str | None = Field(default=None, max_length=128)
    change_summary: str | None = None
    information_policy: InformationPolicyBinding | None = None
    file: DocumentFileCreate | None = None
    governance_scope: GovernanceScope | None = None

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
    file_id: str | None = None
    version_label: str
    status: DocumentStatus
    organization_id: str
    policy_binding_id: str | None
    policy_version: str | None
    policy_hash: str | None
    policy_summary: dict[str, Any] = Field(default_factory=dict)
    governed_resource_id: str | None = None
    governed_source_version: str | None = None
    governed_parent_resource_id: str | None = None
    governance_scope_type: str = "organization"
    governance_scope_id: str | None = "org_stratos"
    governance_scope_owner_subject_id: str | None = None
    governance_registration_status: str = "LEGACY_UNREGISTERED"
    governance_registered_at: datetime | None = None
    valid_from: date | None
    valid_to: date | None
    source_file_uri: str
    source_location: SourceLocation | None
    file_hash: str | None
    change_summary: str | None
    created_at: datetime
    published_at: datetime | None


class AiipDocumentVersionCreateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: DocumentVersionResponse
    external_document: ExternalDocumentResponse
    created: bool
    governance_confirmation: AiipGovernanceConfirmation


class AiipExternalDocumentCurrentUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1, max_length=64)
    expected_current_document_version_id: str | None = Field(default=None, min_length=1, max_length=64)
    document_version_id: str = Field(min_length=1, max_length=64)
    file_id: str = Field(min_length=1, max_length=64)
    ingestion_job_id: str | None = Field(default=None, min_length=1, max_length=128)
    ingestion_status: Literal[
        "REGISTERED",
        "VERSION_CREATED",
        "UPLOADING",
        "INGESTING",
        "INDEXED",
        "FAILED",
        "PERMISSION_DENIED",
        "STALE",
    ]
    information_policy: InformationPolicyBinding
    integration_envelope: AiipUploadIntegrationEnvelope
    governance_scope: GovernanceScope

    @model_validator(mode="after")
    def validate_governed_current(self) -> "AiipExternalDocumentCurrentUpdateRequest":
        envelope = self.integration_envelope
        policy = self.information_policy
        source = envelope.source_resource
        if envelope.source_system != "STRATOS_AIIP" or envelope.actor.type != "person":
            raise ValueError("AIIP upload requires a person-authored STRATOS_AIIP envelope")
        if source is None:
            raise ValueError("AIIP upload requires sourceResource")
        if source.scope.type == "own" and source.scope.owner_subject_id != envelope.actor.subject_id:
            raise ValueError("AIIP own upload scope must belong to the envelope actor")
        if envelope.policy_binding_id != policy.policy_binding_id:
            raise ValueError("integration envelope policyBindingId does not match information_policy")
        if envelope.classification.handling_class != policy.handling_class:
            raise ValueError("integration envelope handlingClass does not match information_policy")
        if envelope.classification.tlp != policy.tlp or envelope.classification.pap != policy.pap:
            raise ValueError("integration envelope TLP/PAP does not match information_policy")
        if source.scope.model_dump(
            mode="json", by_alias=True, exclude_none=True
        ) != self.governance_scope.model_dump(mode="json", by_alias=True, exclude_none=True):
            raise ValueError("governance_scope does not match sourceResource.scope")
        if self.ingestion_job_id is None and self.ingestion_status != "VERSION_CREATED":
            raise ValueError("a current version without an ingestion job must use VERSION_CREATED")
        if self.ingestion_job_id is not None and self.ingestion_status == "VERSION_CREATED":
            raise ValueError("VERSION_CREATED must not name an ingestion job")
        return self


class AiipExternalDocumentCurrentUpdateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    external_document: ExternalDocumentResponse
    updated: bool
    governance_confirmation: AiipGovernanceConfirmation


class DocumentVersionListResponse(BaseModel):
    items: list[DocumentVersionResponse]
    limit: int
    offset: int


class DocumentPublicationStatus(str, Enum):
    draft = "DRAFT"
    published = "PUBLISHED"
    revoked = "REVOKED"


class DocumentPublicationPutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    status: DocumentPublicationStatus
    public_slug: str | None = Field(default=None, alias="publicSlug", min_length=3, max_length=120)
    public_description: str | None = Field(
        default=None,
        alias="publicDescription",
        max_length=2000,
    )
    reason: str = Field(min_length=3, max_length=1000)


class DocumentPublicationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    publication_id: str
    document_id: str
    document_version_id: str
    public_slug: str
    status: DocumentPublicationStatus
    snapshot_schema: str
    public_snapshot_hash: str
    governed_resource_id: str
    source_version: str
    policy_binding_id: str
    policy_version: str
    policy_hash: str
    central_publication_id: str
    approved_by: str | None
    published_by: str | None
    published_at: datetime | None
    revoked_by: str | None
    revoked_at: datetime | None
    reason: str
    created_at: datetime
    updated_at: datetime


class PublicDocumentSnapshotFile(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    filename: str
    mime_type: str = Field(alias="mimeType")
    size_bytes: int = Field(alias="sizeBytes", ge=0)
    sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class PublicDocumentSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_version: Literal["akb-public-document-1"] = Field(alias="schemaVersion")
    document_id: str = Field(alias="documentId")
    document_version_id: str = Field(alias="documentVersionId")
    title: str
    document_type: str = Field(alias="documentType")
    version_label: str = Field(alias="versionLabel")
    valid_from: str | None = Field(alias="validFrom")
    valid_to: str | None = Field(alias="validTo")
    published_at: str = Field(alias="publishedAt")
    description: str | None
    file: PublicDocumentSnapshotFile


class PublicDocumentMetadataResponse(BaseModel):
    snapshot: PublicDocumentSnapshot
    decision_id: str


class PublicDocumentSourceResolutionResponse(BaseModel):
    publication_id: str
    public_slug: str
    document_id: str
    document_version_id: str
    source_version: str
    source_file_uri: str
    filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    policy_binding_id: str
    policy_version: str
    policy_hash: str
    decision_id: str


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
    capabilities: list[str] = Field(default_factory=list)
    scopes: list[str] = Field(default_factory=list)
    organization_id: str = "org_stratos"
    identity_active: bool = True
    membership_active: bool = True
    application_access_active: bool = True


class AuthzCheckResponse(BaseModel):
    allowed: bool
    reason: str
    reason_codes: list[str] = Field(default_factory=list)
    constraints: dict[str, Any] = Field(default_factory=dict)


class IngestionAuthorizationIssueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["document.ingest", "document.read", "document.reindex"]
    correlation_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/-]*$",
    )
    idempotency_key: str = Field(
        min_length=8,
        max_length=200,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]+$",
    )


class IngestionAuthorizationConfirmRequest(IngestionAuthorizationIssueRequest):
    authorization_token: str = Field(min_length=32, max_length=4096)
    expected_subject_id: str = Field(
        min_length=2,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/-]+$",
    )
    document_id: str = Field(min_length=1, max_length=128)
    document_version_id: str = Field(min_length=1, max_length=128)


class IngestionAuthorizationResponse(BaseModel):
    authorization_token: str | None = None
    authorization_id: str
    confirmed_subject_id: str
    action: Literal["document.ingest", "document.read", "document.reindex"]
    document_id: str
    document_version_id: str
    correlation_id: str
    idempotency_key: str
    expires_at: datetime


class IntelligenceScopeAuthorizationIssueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_ids: list[str] = Field(min_length=1, max_length=500)
    correlation_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/-]*$",
    )
    idempotency_key: str = Field(
        min_length=8,
        max_length=200,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]+$",
    )

    @field_validator("document_ids")
    @classmethod
    def normalize_document_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() if isinstance(value, str) else "" for value in values]
        if any(not value or len(value) > 128 for value in normalized):
            raise ValueError("Each document id must contain between 1 and 128 characters")
        if len(set(normalized)) != len(normalized):
            raise ValueError("Intelligence document scope must not contain duplicates")
        return sorted(normalized)


class IntelligenceDocumentCoordinate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1, max_length=128)
    document_version_id: str = Field(min_length=1, max_length=128)
    policy_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class IntelligenceScopeAuthorizationConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    authorization_token: str = Field(min_length=32, max_length=4096)
    expected_subject_id: str = Field(
        min_length=2,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/-]+$",
    )
    documents: list[IntelligenceDocumentCoordinate] = Field(min_length=1, max_length=500)
    correlation_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/-]*$",
    )
    idempotency_key: str = Field(
        min_length=8,
        max_length=200,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]+$",
    )

    @field_validator("documents")
    @classmethod
    def normalize_documents(
        cls,
        values: list[IntelligenceDocumentCoordinate],
    ) -> list[IntelligenceDocumentCoordinate]:
        if len({item.document_id for item in values}) != len(values):
            raise ValueError("Intelligence coordinates must contain each document once")
        return sorted(values, key=lambda item: item.document_id)


class IntelligenceScopeAuthorizationResponse(BaseModel):
    authorization_token: str | None = None
    authorization_id: str
    confirmed_subject_id: str
    action: Literal["intelligence.query"] = "intelligence.query"
    document_scope_hash: str
    document_count: int = Field(ge=1, le=500)
    documents: list[IntelligenceDocumentCoordinate]
    correlation_id: str
    idempotency_key: str
    expires_at: datetime


class AuthzFilterDocumentsRequest(BaseModel):
    subject_id: str = Field(min_length=1, max_length=128)
    action: Action
    candidate_document_ids: list[str] = Field(min_length=1, max_length=1000)
    candidate_policy_hashes: dict[str, list[str]] = Field(default_factory=dict)
    candidate_document_versions: dict[str, list[str]] = Field(default_factory=dict)
    roles: list[str] = Field(default_factory=list)
    groups: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    scopes: list[str] = Field(default_factory=list)
    organization_id: str = "org_stratos"
    identity_active: bool = True
    membership_active: bool = True
    application_access_active: bool = True


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
    occurrence_count: int = Field(default=1, ge=1)
    last_seen_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="event_metadata")
    created_at: datetime


class AuditEventListResponse(BaseModel):
    items: list[AuditEventResponse]
    limit: int
    offset: int


class IntegrationIdempotencyReserveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: str = Field(min_length=1, max_length=128)
    operation: str = Field(min_length=1, max_length=120)
    idempotency_key: str = Field(min_length=8, max_length=128)
    input_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    retention_seconds: int = Field(default=86400, ge=60, le=86400)


class IntegrationIdempotencyReserveResponse(BaseModel):
    state: Literal["reserved", "replay", "conflict", "processing"]
    record_id: str
    response_status: int | None = None
    response_body: dict[str, Any] | None = None
    audit_event_id: str | None = None
    expires_at: datetime


class IntegrationIdempotencyCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    response_status: int = Field(ge=200, le=599)
    response_body: dict[str, Any]
    audit_event_id: str | None = Field(default=None, max_length=64)


class IntegrationIdempotencyCompleteResponse(BaseModel):
    record_id: str
    status: Literal["completed"]
    expires_at: datetime


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


class AnalystCaseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=4000)
    classification: Classification = Classification.internal
    tags: list[str] = Field(default_factory=list, max_length=50)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, values: list[str]) -> list[str]:
        seen: set[str] = set()
        normalized_values: list[str] = []
        for value in values:
            normalized = value.strip() if isinstance(value, str) else ""
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            normalized_values.append(normalized[:80])
        return normalized_values


class AnalystCasePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=4000)
    status: Literal["open", "archived"] | None = None
    classification: Classification | None = None
    tags: list[str] | None = Field(default=None, max_length=50)
    metadata: dict[str, Any] | None = None

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        return AnalystCaseCreate.normalize_tags(values)


class AnalystSavedQueryCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    query_text: str = Field(min_length=1, max_length=1000)
    query_mode: Literal["smart", "boolean", "phrase", "proximity", "fielded"] = "smart"
    search_fields: list[Literal["all", "title", "body", "section", "entity", "source"]] = Field(
        default_factory=lambda: ["all"],
        max_length=8,
    )
    filters: dict[str, Any] = Field(default_factory=dict)

    @field_validator("search_fields")
    @classmethod
    def normalize_search_fields(cls, values: list[str]) -> list[str]:
        if not values:
            return ["all"]
        seen: set[str] = set()
        normalized_values: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            normalized_values.append(value)
        return ["all"] if "all" in normalized_values else normalized_values


class AnalystEvidenceCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    note: str | None = Field(default=None, max_length=4000)
    document_id: str | None = Field(default=None, max_length=64)
    document_version_id: str | None = Field(default=None, max_length=64)
    document_title: str | None = Field(default=None, max_length=300)
    chunk_id: str | None = Field(default=None, max_length=128)
    page_number: int | None = Field(default=None, ge=1)
    section_title: str | None = Field(default=None, max_length=300)
    source_file_name: str | None = Field(default=None, max_length=300)
    score: float | None = None
    snippet: str | None = Field(default=None, max_length=2000)
    entity_types: list[str] = Field(default_factory=list, max_length=50)
    entity_values: list[str] = Field(default_factory=list, max_length=100)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("entity_types", "entity_values")
    @classmethod
    def normalize_string_list(cls, values: list[str]) -> list[str]:
        seen: set[str] = set()
        normalized_values: list[str] = []
        for value in values:
            normalized = value.strip() if isinstance(value, str) else ""
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            normalized_values.append(normalized[:256])
        return normalized_values


class AnalystSavedQueryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    saved_query_id: str
    case_id: str
    title: str
    query_text: str
    query_mode: Literal["smart", "boolean", "phrase", "proximity", "fielded"]
    search_fields: list[str] = Field(default_factory=list)
    filters: dict[str, Any] = Field(default_factory=dict)
    created_by: str
    created_at: datetime


class AnalystEvidenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    evidence_id: str
    case_id: str
    title: str
    note: str | None = None
    document_id: str | None = None
    document_version_id: str | None = None
    document_title: str | None = None
    chunk_id: str | None = None
    page_number: int | None = None
    section_title: str | None = None
    source_file_name: str | None = None
    score: float | None = None
    snippet: str | None = None
    entity_types: list[str] = Field(default_factory=list)
    entity_values: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="evidence_metadata")
    created_by: str
    created_at: datetime


class AnalystCaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    case_id: str
    title: str
    description: str | None = None
    status: Literal["open", "archived"]
    owner_id: str
    classification: Classification
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="case_metadata")
    saved_queries: list[AnalystSavedQueryResponse] = Field(default_factory=list)
    evidence_items: list[AnalystEvidenceResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AnalystCaseListResponse(BaseModel):
    items: list[AnalystCaseResponse]
    limit: int
    offset: int


class DirectoryUserResponse(BaseModel):
    subject_id: str
    display_name: str | None = None
    email: str | None = None
    username: str | None = None
    enabled: bool = True
    groups: list[str] = Field(default_factory=list)


class DirectoryUserListResponse(BaseModel):
    users: list[DirectoryUserResponse]


class DirectoryUserImportRequest(BaseModel):
    subject_id: str = Field(min_length=1, max_length=128)


class ProfileSettingsBundle(BaseModel):
    core: dict[str, Any] = Field(default_factory=dict)
    apps: dict[str, dict[str, Any]] = Field(default_factory=dict)


class ProfileSettingsPutRequest(BaseModel):
    settings: ProfileSettingsBundle


class ProfileSettingsResponse(BaseModel):
    subject_id: str
    settings: ProfileSettingsBundle
    roles: list[str] = Field(default_factory=list)
    groups: list[str] = Field(default_factory=list)


class RoleMappingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    role_mapping_id: str
    subject_type: str
    subject_id: str
    role: str
    status: str
    display_name: str | None = None
    created_at: datetime
    updated_at: datetime


class RoleMappingListResponse(BaseModel):
    members: list[RoleMappingResponse]


class UpsertRoleMappingRequest(BaseModel):
    subject_type: str = Field(default="user", pattern="^(user|group)$")
    subject_id: str = Field(min_length=1, max_length=128)
    role: str = Field(min_length=1, max_length=64)
    status: str = Field(default="active", pattern="^(active|removed)$")


class RoleMappingStatusPatch(BaseModel):
    status: str = Field(pattern="^(active|removed)$")


class AssistantMessageCreate(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1)
    response_type: str | None = Field(default=None, max_length=64)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssistantMessageAppendRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    messages: list[AssistantMessageCreate] = Field(min_length=1, max_length=10)
    title: str | None = Field(default=None, max_length=300)
    visibility: str | None = Field(default=None, pattern="^(private|shared)$")
    retention_until: datetime | None = None


class AssistantMessageResponse(BaseModel):
    message_id: str
    role: str
    content: str
    response_type: str | None = None
    citations: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    availability: str = Field(
        default="available",
        pattern="^(available|source_access_changed)$",
    )
    created_at: datetime


class AssistantConversationShareCreate(BaseModel):
    subject_type: str = Field(default="user", pattern="^(user|group)$")
    subject_id: str = Field(min_length=1, max_length=128)
    permission: str = Field(default="viewer", pattern="^(viewer|commenter)$")


class AssistantConversationShareResponse(BaseModel):
    conversation_share_id: str
    subject_type: str
    subject_id: str
    permission: str
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime


class AssistantConversationPatch(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    status: str | None = Field(default=None, pattern="^(active|archived)$")
    visibility: str | None = Field(default=None, pattern="^(private|shared)$")
    retention_until: datetime | None = None


class AssistantConversationShareReplaceRequest(BaseModel):
    shares: list[AssistantConversationShareCreate] = Field(default_factory=list, max_length=50)
    visibility: str = Field(default="shared", pattern="^(private|shared)$")


class AssistantConversationListItemResponse(BaseModel):
    conversation_id: str
    user_id: str
    status: str
    title: str | None = None
    visibility: str
    retention_until: datetime | None = None
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    shared_with: list[AssistantConversationShareResponse] = Field(default_factory=list)
    message_count: int = 0


class AssistantConversationListResponse(BaseModel):
    items: list[AssistantConversationListItemResponse]
    limit: int
    offset: int


class AssistantConversationDetailResponse(BaseModel):
    conversation_id: str
    user_id: str
    status: str
    title: str | None = None
    visibility: str
    retention_until: datetime | None = None
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    shared_with: list[AssistantConversationShareResponse] = Field(default_factory=list)
    messages: list[AssistantMessageResponse]
