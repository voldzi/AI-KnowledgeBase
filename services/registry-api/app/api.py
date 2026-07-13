import re
import unicodedata
from collections import Counter
from datetime import date, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import desc, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from starlette import status

from app.audit import add_audit_event
from app.access_governance import GovernanceDenied, GovernanceUnavailable, governance_client
from app.auth import Principal, get_current_principal
from app.config import get_settings
from app.database import get_db
from app.errors import problem
from app.information_policy import (
    InformationPolicyBinding,
    canonical_policy_hash,
    legacy_classification,
    policy_columns,
)
from app.middleware import get_correlation_id
from app.models import (
    AnalystCase,
    AnalystEvidenceItem,
    AnalystSavedQuery,
    AuditEvent,
    AssistantConversation,
    AssistantConversationShare,
    AssistantMessage,
    Document,
    DocumentAccessPolicy,
    DocumentAssignment,
    DocumentExtraction,
    DocumentExtractionFeedback,
    DocumentFile,
    DocumentVersion,
    ExternalDocumentRef,
    IntegrationIdempotencyRecord,
    WorkflowTask,
    make_id,
    utcnow,
)
from app.permissions import (
    ACTION_CAPABILITIES,
    Decision,
    SubjectContext,
    context_for_principal,
    context_for_subject,
    document_governance_scope,
    evaluate_document_access,
    evaluate_global_action,
    evaluate_runtime_document_access,
    require_document_action,
    require_global_action,
)
from app.schemas import (
    Action,
    AnalystCaseCreate,
    AnalystCaseListResponse,
    AnalystCasePatch,
    AnalystCaseResponse,
    AnalystEvidenceCreate,
    AnalystEvidenceResponse,
    AnalystSavedQueryCreate,
    AnalystSavedQueryResponse,
    AuditEventCreate,
    AuditEventListResponse,
    AuditEventResponse,
    AuthzCheckRequest,
    AuthzCheckResponse,
    AuthzFilterDocumentsRequest,
    AuthzFilterDocumentsResponse,
    Classification,
    DocumentAssignmentCreate,
    DocumentAssignmentListResponse,
    DocumentAssignmentReplaceRequest,
    DocumentExtractionFeedbackCreate,
    DocumentExtractionFeedbackResponse,
    DocumentExtractionFeedbackStoreResponse,
    DocumentExtractionResponse,
    DocumentExtractionStatus,
    DocumentExtractionStoreRequest,
    DocumentExtractionStoreResponse,
    DocumentAssignmentRole,
    DocumentCreate,
    DocumentListResponse,
    DocumentMetadataSummaryBucket,
    DocumentMetadataSummaryResponse,
    DocumentMetadataSummaryTopic,
    DocumentPatch,
    DocumentReadinessIssue,
    DocumentReadinessResponse,
    DocumentReadinessSeverity,
    GovernanceScope,
    DocumentResponse,
    DocumentStatus,
    DocumentType,
    ExternalSourceSystem,
    DocumentVersionCreate,
    DocumentVersionListResponse,
    DocumentVersionResponse,
    ExternalDocumentCurrentUpdateRequest,
    ExternalDocumentCurrentListResponse,
    ExternalDocumentResponse,
    ExternalDocumentRefResponse,
    ExternalDocumentUpsertRequest,
    HealthResponse,
    IntegrationIdempotencyCompleteRequest,
    IntegrationIdempotencyCompleteResponse,
    IntegrationIdempotencyReserveRequest,
    IntegrationIdempotencyReserveResponse,
    ProfileSettingsBundle,
    ProfileSettingsPutRequest,
    ProfileSettingsResponse,
    WorkflowTaskActionRequest,
    WorkflowTaskKind,
    WorkflowTaskListResponse,
    WorkflowTaskPriority,
    WorkflowTaskResponse,
    WorkflowTaskStatus,
    AssistantConversationDetailResponse,
    AssistantConversationListItemResponse,
    AssistantConversationListResponse,
    AssistantConversationPatch,
    AssistantConversationShareReplaceRequest,
    AssistantConversationShareResponse,
    AssistantMessageAppendRequest,
    AssistantMessageResponse,
)

router = APIRouter(prefix="/api/v1")
health_router = APIRouter()

Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]

ACTIVE_TASK_STATUSES = {
    WorkflowTaskStatus.open.value,
    WorkflowTaskStatus.waiting.value,
    WorkflowTaskStatus.blocked.value,
}

SUPERSEDABLE_EXTRACTION_STATUSES = {
    DocumentExtractionStatus.pending.value,
    DocumentExtractionStatus.running.value,
    DocumentExtractionStatus.proposed.value,
    DocumentExtractionStatus.partial.value,
    DocumentExtractionStatus.failed.value,
}

DEFAULT_ASSIGNMENT_SLA_DAYS = {
    DocumentAssignmentRole.owner.value: 5,
    DocumentAssignmentRole.gestor.value: 3,
    DocumentAssignmentRole.reviewer.value: 3,
    DocumentAssignmentRole.approver.value: 2,
    DocumentAssignmentRole.auditor.value: 2,
    DocumentAssignmentRole.steward.value: 5,
}

DOCUMENT_STATUS_TRANSITIONS = {
    DocumentStatus.draft.value: {
        DocumentStatus.draft.value,
        DocumentStatus.review.value,
        DocumentStatus.cancelled.value,
    },
    DocumentStatus.review.value: {
        DocumentStatus.review.value,
        DocumentStatus.draft.value,
        DocumentStatus.approved.value,
        DocumentStatus.cancelled.value,
    },
    DocumentStatus.approved.value: {
        DocumentStatus.approved.value,
        DocumentStatus.review.value,
        DocumentStatus.draft.value,
        DocumentStatus.valid.value,
        DocumentStatus.cancelled.value,
    },
    DocumentStatus.valid.value: {
        DocumentStatus.valid.value,
        DocumentStatus.archived.value,
        DocumentStatus.cancelled.value,
    },
    DocumentStatus.superseded.value: {
        DocumentStatus.superseded.value,
        DocumentStatus.archived.value,
        DocumentStatus.cancelled.value,
    },
    DocumentStatus.archived.value: {
        DocumentStatus.archived.value,
        DocumentStatus.cancelled.value,
    },
    DocumentStatus.cancelled.value: {
        DocumentStatus.cancelled.value,
    },
}

READINESS_DOCUMENT_NUMBER_KEYS = {
    "document_number",
    "document_no",
    "number",
    "cislo",
    "evidencni_cislo",
    "reference",
    "reference_number",
}

READINESS_ISSUE_DATE_KEYS = {
    "issued_at",
    "issue_date",
    "date_issued",
    "published_at",
    "publication_date",
    "datum_vydani",
}

READINESS_SCOPE_KEYS = {
    "agenda",
    "area",
    "domain",
    "scope",
    "oblast",
    "pusobnost",
    "topic",
}

READINESS_REVIEW_KEYS = {
    "requires_review",
    "manual_review_required",
    "ocr_requires_review",
}

READINESS_QUALITY_KEYS = {
    "quality_tier",
    "parser_quality",
    "ocr_quality_tier",
    "ingestion_quality_tier",
}

READINESS_INGESTION_FAILED_STATUSES = {
    DocumentExtractionStatus.failed.value,
    "FAILED",
    "ERROR",
}

READINESS_INGESTION_REVIEW_STATUSES = {
    DocumentExtractionStatus.partial.value,
    DocumentExtractionStatus.rejected_in_source_app.value,
    "CANCELLED",
    "COMPLETED_WITH_WARNINGS",
}


def _action_values(actions: list[Action]) -> list[str]:
    return [action.value for action in actions]


def _default_policies(owner_id: str, classification: Classification | str) -> list[DocumentAccessPolicy]:
    classification_value = classification.value if isinstance(classification, Classification) else classification
    return [
        DocumentAccessPolicy(
            subjects=[f"user:{owner_id}", "role:admin", "role:document_manager"],
            actions=[
                Action.document_read.value,
                Action.document_update.value,
                Action.document_version_create.value,
                Action.document_version_publish.value,
                Action.document_version_archive.value,
                Action.document_ingest.value,
                Action.document_reindex.value,
            ],
            constraints={"classification_max": Classification.confidential.value},
        ),
        DocumentAccessPolicy(
            subjects=["role:reader"],
            actions=[Action.document_read.value, Action.rag_query.value],
            constraints={"classification_max": classification_value},
        ),
    ]


def _policy_models(document: Document, payload: DocumentCreate | DocumentPatch) -> list[DocumentAccessPolicy]:
    if payload.access_policies is None:
        if isinstance(payload, DocumentCreate):
            return _default_policies(payload.owner_id, payload.classification)
        return list(document.access_policies)

    return [
        DocumentAccessPolicy(
            document_id=document.document_id,
            subjects=list(policy.subjects),
            actions=_action_values(policy.actions),
            constraints=dict(policy.constraints),
        )
        for policy in payload.access_policies
    ]


def _assignment_model(
    *,
    document: Document,
    payload: DocumentAssignmentCreate,
    actor_id: str | None,
) -> DocumentAssignment:
    return DocumentAssignment(
        document_id=document.document_id,
        role=payload.role.value,
        subject_type=payload.subject_type.value,
        subject_id=payload.subject_id,
        display_label=payload.display_label,
        is_primary=payload.is_primary,
        active=payload.active,
        sla_days=payload.sla_days,
        escalation_subject_type=(
            payload.escalation_subject_type.value if payload.escalation_subject_type else None
        ),
        escalation_subject_id=payload.escalation_subject_id,
        escalation_label=payload.escalation_label,
        assigned_by=actor_id,
        assignment_metadata=payload.metadata,
    )


def _default_assignment_payloads(payload: DocumentCreate) -> list[DocumentAssignmentCreate]:
    assignments = [
        DocumentAssignmentCreate(
            role=DocumentAssignmentRole.owner,
            subject_type="user",
            subject_id=payload.owner_id,
            display_label=payload.owner_id,
            is_primary=True,
            sla_days=DEFAULT_ASSIGNMENT_SLA_DAYS[DocumentAssignmentRole.owner.value],
            metadata={"source": "document.owner_id"},
        )
    ]
    if payload.gestor_unit:
        assignments.append(
            DocumentAssignmentCreate(
                role=DocumentAssignmentRole.gestor,
                subject_type="unit",
                subject_id=payload.gestor_unit,
                display_label=payload.gestor_unit,
                is_primary=True,
                sla_days=DEFAULT_ASSIGNMENT_SLA_DAYS[DocumentAssignmentRole.gestor.value],
                metadata={"source": "document.gestor_unit"},
            )
        )
    return assignments


def _external_document_metadata(payload: ExternalDocumentUpsertRequest) -> dict[str, object]:
    external_system = payload.external_system.value
    source_location = (
        payload.source_location.model_dump(mode="json", exclude_none=True)
        if payload.source_location is not None
        else None
    )
    envelope_metadata = (
        {
            "schema_version": payload.integration_envelope.schema_version,
            "source_system": payload.integration_envelope.source_system,
            "correlation_id": payload.integration_envelope.correlation_id,
            "idempotency_key": payload.integration_envelope.idempotency_key,
            "policy_hash": payload.integration_envelope.policy_hash,
        }
        if payload.integration_envelope is not None
        else None
    )
    return {
        **dict(payload.metadata),
        **({"integration_envelope": envelope_metadata} if envelope_metadata else {}),
        "external": {
            "tenant_id": payload.tenant_id,
            "external_system": external_system,
            "external_ref": payload.external_ref,
            "entity_type": payload.entity_type,
            "entity_id": payload.entity_id,
            "source_location": source_location,
            "akb_source_uri": payload.akb_source_uri,
            "citation_base_url": payload.citation_base_url,
            "preview_url": payload.preview_url,
        },
    }


def _external_document_policies(payload: ExternalDocumentUpsertRequest) -> list[DocumentAccessPolicy]:
    if payload.access_policies is not None:
        return [
            DocumentAccessPolicy(
                subjects=list(policy.subjects),
                actions=_action_values(policy.actions),
                constraints=dict(policy.constraints),
            )
            for policy in payload.access_policies
        ]

    reader_subjects = ["role:reader"]
    if payload.external_system == ExternalSourceSystem.stratos_aiip:
        reader_subjects.append("role:service_aiip")

    return [
        DocumentAccessPolicy(
            subjects=[
                f"user:{payload.owner.user_id}",
                "role:admin",
                "role:document_manager",
                "role:stratos_service",
            ],
            actions=[
                Action.document_read.value,
                Action.document_update.value,
                Action.document_version_create.value,
                Action.document_version_publish.value,
                Action.document_version_archive.value,
                Action.document_ingest.value,
                Action.document_reindex.value,
                Action.rag_query.value,
            ],
            constraints={
                "tenant_id": payload.tenant_id,
                "classification_max": Classification.confidential.value,
            },
        ),
        DocumentAccessPolicy(
            subjects=reader_subjects,
            actions=[Action.document_read.value, Action.rag_query.value],
            constraints={
                "tenant_id": payload.tenant_id,
                "classification_max": payload.classification.value,
            },
        ),
    ]


def _assignment_models(
    *,
    document: Document,
    payloads: list[DocumentAssignmentCreate],
    actor_id: str | None,
) -> list[DocumentAssignment]:
    return [
        _assignment_model(document=document, payload=assignment, actor_id=actor_id)
        for assignment in payloads
    ]


def _validated_assignment_payloads(
    payloads: list[DocumentAssignmentCreate],
) -> list[DocumentAssignmentCreate]:
    primary_roles: set[str] = set()
    seen_subjects: set[tuple[str, str, str]] = set()
    for payload in payloads:
        key = (payload.role.value, payload.subject_type.value, payload.subject_id)
        if key in seen_subjects:
            raise problem(
                status.HTTP_400_BAD_REQUEST,
                "duplicate_assignment",
                "Assignment role and subject must be unique within a document",
            )
        seen_subjects.add(key)
        if payload.is_primary:
            if payload.role.value in primary_roles:
                raise problem(
                    status.HTTP_400_BAD_REQUEST,
                    "duplicate_primary_assignment",
                    "Only one primary assignment is allowed per role",
                )
            primary_roles.add(payload.role.value)
        if payload.escalation_subject_id and payload.escalation_subject_type is None:
            raise problem(
                status.HTTP_400_BAD_REQUEST,
                "missing_escalation_subject_type",
                "Escalation subject type is required when escalation subject id is set",
            )
    return payloads


def _sync_document_assignment_denormalized_fields(document: Document) -> None:
    active_assignments = [assignment for assignment in document.assignments if assignment.active]
    owner = _select_assignment(active_assignments, [DocumentAssignmentRole.owner.value])
    gestor = _select_assignment(active_assignments, [DocumentAssignmentRole.gestor.value])
    if owner is not None and owner.subject_type == "user":
        document.owner_id = owner.subject_id
    if gestor is not None:
        document.gestor_unit = gestor.display_label or gestor.subject_id


def _select_assignment(
    assignments: list[DocumentAssignment],
    roles: list[str],
) -> DocumentAssignment | None:
    for role in roles:
        candidates = [
            assignment
            for assignment in assignments
            if assignment.active and assignment.role == role
        ]
        if not candidates:
            continue
        primary = next((assignment for assignment in candidates if assignment.is_primary), None)
        return primary or candidates[0]
    return None


def _workflow_assignment_context(
    document: Document,
    *,
    roles: list[str],
    fallback_owner_id: str,
    fallback_owner_label: str,
    fallback_role: str,
    default_sla_days: int,
    base_time=None,
) -> dict[str, object]:
    assignment = _select_assignment(list(document.assignments), roles)
    if assignment is None:
        return {
            "owner_id": fallback_owner_id,
            "owner_label": fallback_owner_label,
            "role": fallback_role,
            "sla_days": default_sla_days,
            "assignment_metadata": {
                "assignment_id": None,
                "assignment_role": None,
                "sla_days": default_sla_days,
                "assignment_source": "document_fields",
            },
        }

    sla_days = assignment.sla_days or DEFAULT_ASSIGNMENT_SLA_DAYS.get(assignment.role, default_sla_days)
    due_at = _add_days(base_time or document.updated_at, sla_days)
    now = utcnow()
    comparable_due_at = due_at if due_at.tzinfo is not None else due_at.replace(tzinfo=now.tzinfo)
    escalated = comparable_due_at < now
    assignment_metadata = {
        "assignment_id": assignment.assignment_id,
        "assignment_role": assignment.role,
        "assignment_subject_type": assignment.subject_type,
        "assignment_subject_id": assignment.subject_id,
        "sla_days": sla_days,
        "escalated": escalated,
    }
    if assignment.escalation_subject_id:
        assignment_metadata.update(
            {
                "escalation_subject_type": assignment.escalation_subject_type,
                "escalation_subject_id": assignment.escalation_subject_id,
                "escalation_label": assignment.escalation_label,
            }
        )

    return {
        "owner_id": assignment.subject_id,
        "owner_label": assignment.display_label or assignment.subject_id,
        "role": assignment.role.replace("_", " ").title(),
        "sla_days": sla_days,
        "assignment_metadata": assignment_metadata,
    }


def _get_document(db: Session, document_id: str) -> Document:
    document = db.execute(
        select(Document)
        .where(Document.document_id == document_id)
        .options(selectinload(Document.access_policies), selectinload(Document.assignments))
    ).scalar_one_or_none()
    if document is None:
        raise problem(status.HTTP_404_NOT_FOUND, "document_not_found", "Document was not found")
    return document


def _get_external_document_ref(db: Session, external_document_id: str) -> ExternalDocumentRef:
    external_ref = db.execute(
        select(ExternalDocumentRef)
        .where(ExternalDocumentRef.external_document_id == external_document_id)
        .options(
            selectinload(ExternalDocumentRef.document).selectinload(Document.access_policies),
            selectinload(ExternalDocumentRef.document).selectinload(Document.assignments),
        )
    ).scalar_one_or_none()
    if external_ref is None:
        raise problem(
            status.HTTP_404_NOT_FOUND,
            "external_document_not_found",
            "External document reference was not found",
        )
    return external_ref


def _get_document_extraction(db: Session, extraction_id: str) -> DocumentExtraction:
    extraction = db.execute(
        select(DocumentExtraction).where(DocumentExtraction.extraction_id == extraction_id)
    ).scalar_one_or_none()
    if extraction is None:
        raise problem(
            status.HTTP_404_NOT_FOUND,
            "document_extraction_not_found",
            "Document extraction was not found",
        )
    return extraction


def _require_document_extraction_access(principal: Principal, extraction: DocumentExtraction) -> None:
    context = context_for_principal(principal)
    service_roles = {role for role in context.roles if role.startswith("service_")}
    if (
        principal.subject_id == extraction.requested_by
        or {"admin", "document_manager", "stratos_service"} & context.roles
        or service_roles
    ):
        return
    raise problem(
        status.HTTP_403_FORBIDDEN,
        "forbidden",
        "Only the requester, STRATOS services, admins, document managers, or service roles can access this extraction",
    )


def _external_document_response(
    external_ref: ExternalDocumentRef,
    *,
    created: bool,
) -> ExternalDocumentResponse:
    return ExternalDocumentResponse(
        external_document=ExternalDocumentRefResponse.model_validate(external_ref),
        document=DocumentResponse.model_validate(external_ref.document),
        created=created,
    )


def _get_version(db: Session, document_id: str, version_id: str) -> DocumentVersion:
    version = db.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_id == document_id,
            DocumentVersion.document_version_id == version_id,
        )
    ).scalar_one_or_none()
    if version is None:
        raise problem(status.HTTP_404_NOT_FOUND, "version_not_found", "Document version was not found")
    return version


def _document_version_response(version: DocumentVersion) -> DocumentVersionResponse:
    latest_file = max(
        version.files,
        key=lambda item: (item.uploaded_at, item.file_id),
        default=None,
    )
    response = DocumentVersionResponse.model_validate(version)
    return response.model_copy(update={"file_id": latest_file.file_id if latest_file else None})


def _commit_or_conflict(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise problem(status.HTTP_409_CONFLICT, "conflict", "Registry record already exists") from exc


def _require_authz_api_caller(principal: Principal, subject_id: str) -> None:
    if (
        principal.subject_id == subject_id
        or principal.service_identity
        or (not principal.dynamic_access_loaded and "admin" in principal.roles)
    ):
        return
    raise problem(
        status.HTTP_403_FORBIDDEN,
        "forbidden",
        "Only an authenticated subject or a verified service identity can call this authz check",
    )


def _authz_subject_context(
    db: Session,
    principal: Principal,
    *,
    subject_id: str,
    roles: list[str],
    groups: list[str],
    capabilities: list[str] | None = None,
    scopes: list[str] | None = None,
    organization_id: str = "org_stratos",
    identity_active: bool = True,
    membership_active: bool = True,
    application_access_active: bool = True,
) -> SubjectContext:
    if principal.subject_id == subject_id:
        caller = context_for_principal(principal, db)
        return caller
    if principal.dynamic_access_loaded or principal.service_identity:
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Dynamic access context cannot be delegated through request fields",
        )
    return context_for_subject(
        db,
        subject_id,
        roles,
        groups,
        capabilities=capabilities,
        scopes=scopes,
        organization_id=organization_id,
        identity_active=identity_active,
        membership_active=membership_active,
        application_access_active=application_access_active,
    )


def _service_action_decision(
    *,
    principal: Principal,
    subject_id: str,
    action: str,
    document: Document | None,
    capability_override: str | None = None,
    operation_override: str | None = None,
) -> Decision:
    if not principal.service_identity:
        raise problem(status.HTTP_403_FORBIDDEN, "forbidden", "Service identity is required")
    required = ACTION_CAPABILITIES.get(action, set())
    capability = capability_override or _primary_capability(action, required)
    policy_summary = dict(document.policy_summary) if document is not None else None
    policy_hash = document.policy_hash if document is not None else None
    if document is not None and (not policy_summary or not policy_hash):
        return Decision(False, "Document policy binding is unavailable", {}, ("POLICY_UNAVAILABLE",))
    try:
        response = governance_client(get_settings()).decide(
            actor_subject_id=subject_id,
            capability_id=capability,
            operation=operation_override or _central_operation(action, document is None),
            scope=(
                document_governance_scope(document)
                if document is not None
                else {"type": "organization", "id": "org_stratos"}
            ),
            policy_binding=policy_summary,
            policy_hash=policy_hash,
        )
    except GovernanceDenied as exc:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "policy_decision_credential_rejected",
            "STRATOS rejected the AKB runtime credential",
        ) from exc
    except GovernanceUnavailable as exc:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "policy_decision_unavailable",
            "STRATOS policy decision endpoint is unavailable",
        ) from exc
    reason_codes = tuple(str(item) for item in response.get("reasonCodes", []) if isinstance(item, str))
    if response.get("decision") != "ALLOW":
        return Decision(False, "STRATOS denied the delegated operation", {}, reason_codes or ("POLICY_DENY",))
    if document is None:
        return Decision(True, "STRATOS allowed the delegated operation", {}, reason_codes)
    requested_scope = document_governance_scope(document)
    scope_value = (
        f"{requested_scope['type']}:{requested_scope['id']}"
        if requested_scope.get("id")
        else requested_scope["type"]
    )
    derived = SubjectContext(
        subject_id=subject_id,
        roles=set(),
        groups=set(),
        capabilities={capability},
        scopes={scope_value},
        organization_id="org_stratos",
        identity_active=True,
        membership_active=True,
        application_access_active=True,
        access_v2=True,
    )
    return evaluate_document_access(derived, action, document)


def _primary_capability(action: str, required: set[str]) -> str:
    preferred = {
        Action.document_read.value: "akb:read_document",
        Action.rag_query.value: "akb:chat",
        Action.rag_compare.value: "akb:chat",
        Action.rag_check_compliance.value: "akb:chat",
        Action.audit_write.value: "akb:read_audit",
    }
    capability = preferred.get(action)
    if capability:
        return capability
    if not required:
        raise problem(status.HTTP_403_FORBIDDEN, "forbidden", "No central capability maps to this action")
    return sorted(required)[0]


def _central_operation(action: str, global_action: bool) -> str:
    if global_action:
        return "access"
    if action in {Action.rag_query.value, Action.rag_compare.value, Action.rag_check_compliance.value}:
        return "ai"
    if action == Action.rag_export.value:
        return "export"
    if action in {Action.document_create.value, Action.document_version_create.value}:
        return "upload"
    return "read"


def _audit_service_decision_coordinates(event_type: str) -> tuple[str, str]:
    if event_type.startswith(("aiip.", "rag.", "assistant.")):
        return "akb:chat", "ai"
    if event_type in {"chunk.opened", "citation.opened", "source.opened"}:
        return "akb:read_document", "read"
    if event_type.startswith(("ingestion.", "document_extraction.")):
        return "akb:manage_document", "upload"
    return "akb:access", "access"


def _require_v2_policy(principal: Principal, policy) -> None:
    if principal.access_v2 and policy is None:
        raise problem(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "policy_unavailable",
            "Information Policy V2 binding is required for this operation",
            {"reason_codes": ["POLICY_UNAVAILABLE"]},
        )


def _ensure_policy_binding_registered(policy) -> None:
    if policy is None:
        return
    try:
        governance_client(get_settings()).ensure_binding_registered(policy)
    except GovernanceDenied as exc:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "policy_registry_credential_rejected",
            "STRATOS Policy Registry rejected the AKB runtime credential",
        ) from exc
    except GovernanceUnavailable as exc:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "policy_registry_unavailable",
            "STRATOS Policy Registry is unavailable",
        ) from exc


def _governance_scope(
    policy: InformationPolicyBinding,
    requested: GovernanceScope | None,
    *,
    fallback_type: str | None = None,
    fallback_id: str | None = None,
) -> dict[str, str]:
    if requested is not None:
        scope = requested.model_dump(mode="json", exclude_none=True)
    elif fallback_type:
        scope = {"type": fallback_type}
        if fallback_id:
            scope["id"] = fallback_id
    else:
        audience = policy.audience
        if audience.scope_type in {"organization", "public", "recipient_set"}:
            scope = {"type": "organization", "id": "org_stratos"}
        elif len(audience.scope_ids) == 1:
            scope = {"type": audience.scope_type, "id": audience.scope_ids[0]}
        else:
            raise problem(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "governance_scope_required",
                "A policy with multiple or unspecified resource scopes requires one explicit registered governance_scope",
            )

    scope_type = scope.get("type")
    scope_id = scope.get("id")
    audience = policy.audience
    if scope_type == "organization":
        if scope_id not in {None, "org_stratos"}:
            raise problem(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "organization_mismatch",
                "AKB organization scope must identify org_stratos",
            )
    elif audience.scope_type not in {"public", "recipient_set"} and (
        scope_type != audience.scope_type or scope_id not in audience.scope_ids
    ):
        raise problem(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "governance_scope_mismatch",
            "governance_scope must be one concrete scope covered by the information policy audience",
        )
    return {key: value for key, value in scope.items() if isinstance(value, str) and value}


def _register_governed_resource(
    *,
    principal: Principal,
    resource_type: str,
    resource_id: str,
    source_version: str,
    title: str,
    policy: InformationPolicyBinding,
    requested_scope: GovernanceScope | None,
    parent_resource_id: str | None,
    reason: str,
    delegated_actor_subject_id: str | None = None,
    fallback_scope_type: str | None = None,
    fallback_scope_id: str | None = None,
) -> dict[str, object]:
    scope = _governance_scope(
        policy,
        requested_scope,
        fallback_type=fallback_scope_type,
        fallback_id=fallback_scope_id,
    )
    settings = get_settings()
    if settings.auth_mode == "mock":
        return {
            "governed_resource_id": None,
            "governed_source_version": source_version,
            "governed_parent_resource_id": parent_resource_id,
            "governance_scope_type": scope["type"],
            "governance_scope_id": scope.get("id"),
            "governance_registration_status": "MOCK_BYPASSED",
            "governance_registered_at": None,
        }

    actor_subject_id: str | None = None
    credential_token = principal.bearer_token
    if principal.service_identity:
        credential_token = settings.stratos_policy_service_token
        actor_subject_id = delegated_actor_subject_id
        if not actor_subject_id:
            raise problem(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "delegated_actor_required",
                "A verified delegated actor is required for service-initiated governed resource registration",
            )
    if not credential_token:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "governed_resource_registration_unavailable",
            "A verified on-behalf-of credential is required to register the governed resource",
        )
    try:
        registration = governance_client(settings).register_information_resource(
            credential_token=credential_token,
            actor_subject_id=actor_subject_id,
            resource_type=resource_type,
            resource_id=resource_id,
            source_version=source_version,
            title=title,
            scope=scope,
            binding=policy,
            parent_resource_id=parent_resource_id,
            reason=reason,
            metadata={"repository": "AKB", "correlationId": get_correlation_id()},
        )
    except GovernanceDenied as exc:
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "governed_resource_registration_denied",
            "STRATOS denied governed resource registration for the delegated actor",
        ) from exc
    except GovernanceUnavailable as exc:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "governed_resource_registration_unavailable",
            "STRATOS governed resource registration is unavailable",
        ) from exc
    return {
        "governed_resource_id": registration.resource_id,
        "governed_source_version": registration.source_version,
        "governed_parent_resource_id": parent_resource_id,
        "governance_scope_type": scope["type"],
        "governance_scope_id": scope.get("id"),
        "governance_registration_status": "REGISTERED",
        "governance_registered_at": utcnow(),
    }


def _add_days(value, days: int):
    return value + timedelta(days=days)


def _transition_document_status(document: Document, target_status: DocumentStatus) -> None:
    target = target_status.value
    current = document.status
    if target == current:
        return
    allowed_targets = DOCUMENT_STATUS_TRANSITIONS.get(current, {current})
    if target not in allowed_targets:
        raise problem(
            status.HTTP_409_CONFLICT,
            "invalid_document_status_transition",
            f"Document status cannot transition from {current} to {target}",
        )
    document.status = target


def _latest_document_version(db: Session, document_id: str) -> DocumentVersion | None:
    return db.execute(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == document_id)
        .order_by(desc(DocumentVersion.created_at))
        .limit(1)
    ).scalar_one_or_none()


def _current_valid_document_version(db: Session, document_id: str) -> DocumentVersion | None:
    return db.execute(
        select(DocumentVersion)
        .where(
            DocumentVersion.document_id == document_id,
            DocumentVersion.status == DocumentStatus.valid.value,
        )
        .order_by(desc(DocumentVersion.published_at), desc(DocumentVersion.created_at))
        .limit(1)
    ).scalar_one_or_none()


def _workflow_action_version(
    db: Session,
    *,
    task: WorkflowTask,
    payload: WorkflowTaskActionRequest,
    prefer_valid: bool = False,
) -> DocumentVersion | None:
    if task.document_id is None:
        return None
    requested_version_id = task.document_version_id
    metadata_version_id = payload.metadata.get("document_version_id")
    if requested_version_id is None and isinstance(metadata_version_id, str):
        requested_version_id = metadata_version_id
    if requested_version_id:
        return _get_version(db, task.document_id, requested_version_id)
    if prefer_valid:
        return _current_valid_document_version(db, task.document_id)
    return _latest_document_version(db, task.document_id)


def _approve_document_for_publication(db: Session, document: Document) -> DocumentVersion | None:
    _transition_document_status(document, DocumentStatus.approved)
    version = _latest_document_version(db, document.document_id)
    if version is not None and version.status in {DocumentStatus.draft.value, DocumentStatus.review.value}:
        version.status = DocumentStatus.approved.value
    return version


def _request_document_changes(document: Document, version: DocumentVersion | None = None) -> None:
    if document.status in {DocumentStatus.review.value, DocumentStatus.approved.value}:
        _transition_document_status(document, DocumentStatus.draft)
    if version is not None and version.status == DocumentStatus.approved.value:
        version.status = DocumentStatus.draft.value


def _publish_version(
    db: Session,
    *,
    document: Document,
    version: DocumentVersion,
    actor_id: str,
) -> None:
    if version.status == DocumentStatus.valid.value:
        return
    if version.status in {
        DocumentStatus.archived.value,
        DocumentStatus.superseded.value,
        DocumentStatus.cancelled.value,
    }:
        raise problem(status.HTTP_409_CONFLICT, "version_not_publishable", "Version cannot be published")
    if document.status != DocumentStatus.approved.value:
        raise problem(
            status.HTTP_409_CONFLICT,
            "publish_requires_approval",
            "Document must be approved before a version can be published",
        )

    active_versions = db.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_id == document.document_id,
            DocumentVersion.status == DocumentStatus.valid.value,
            DocumentVersion.document_version_id != version.document_version_id,
        )
    ).scalars()
    for active_version in active_versions:
        active_version.status = DocumentStatus.superseded.value

    version.status = DocumentStatus.valid.value
    version.published_at = utcnow()
    _transition_document_status(document, DocumentStatus.valid)
    add_audit_event(
        db,
        actor_id=actor_id,
        event_type="document.version.published",
        resource_type="document_version",
        resource_id=version.document_version_id,
        metadata={"document_id": document.document_id},
    )


def _archive_version(
    db: Session,
    *,
    document: Document,
    version: DocumentVersion,
    actor_id: str,
) -> None:
    version.status = DocumentStatus.archived.value
    has_other_valid = db.execute(
        select(DocumentVersion.document_version_id).where(
            DocumentVersion.document_id == document.document_id,
            DocumentVersion.status == DocumentStatus.valid.value,
            DocumentVersion.document_version_id != version.document_version_id,
        )
    ).first()
    if not has_other_valid and document.status == DocumentStatus.valid.value:
        _transition_document_status(document, DocumentStatus.archived)

    add_audit_event(
        db,
        actor_id=actor_id,
        event_type="document.version.archived",
        resource_type="document_version",
        resource_id=version.document_version_id,
        metadata={"document_id": document.document_id},
    )


def _upsert_derived_task(db: Session, *, source_key: str, values: dict[str, object]) -> None:
    task = db.execute(select(WorkflowTask).where(WorkflowTask.source_key == source_key)).scalar_one_or_none()
    if task is None:
        db.add(WorkflowTask(task_id=make_id("task"), source_key=source_key, **values))
        return
    if task.status not in ACTIVE_TASK_STATUSES:
        return
    existing_metadata = dict(task.task_metadata or {})
    has_manual_decision = "last_action" in existing_metadata
    for key, value in values.items():
        if has_manual_decision and key in {"status", "owner_id", "owner_label"}:
            continue
        if key == "task_metadata":
            if has_manual_decision:
                task.task_metadata = {**dict(value), **existing_metadata}
            else:
                task.task_metadata = {**existing_metadata, **dict(value)}
            continue
        setattr(task, key, value)


def _sync_derived_workflow_tasks(db: Session) -> None:
    documents = list(db.execute(select(Document).options(selectinload(Document.assignments))).scalars())
    for document in documents:
        if document.status == DocumentStatus.review.value:
            review_context = _workflow_assignment_context(
                document,
                roles=[
                    DocumentAssignmentRole.reviewer.value,
                    DocumentAssignmentRole.approver.value,
                    DocumentAssignmentRole.gestor.value,
                    DocumentAssignmentRole.owner.value,
                ],
                fallback_owner_id=document.owner_id,
                fallback_owner_label=document.gestor_unit or document.owner_id,
                fallback_role="Owner / gestor",
                default_sla_days=3,
            )
            _upsert_derived_task(
                db,
                source_key=f"document-review:{document.document_id}",
                values={
                    "kind": WorkflowTaskKind.review.value,
                    "priority": (
                        WorkflowTaskPriority.high.value
                        if document.classification in {Classification.restricted.value, Classification.confidential.value}
                        else WorkflowTaskPriority.medium.value
                    ),
                    "status": WorkflowTaskStatus.open.value,
                    "title": "Document review required",
                    "description": "Review metadata, source context, access classification and publication readiness.",
                    "source": "Registry document status",
                    "owner_id": review_context["owner_id"],
                    "owner_label": review_context["owner_label"],
                    "role": review_context["role"],
                    "document_id": document.document_id,
                    "document_title": document.title,
                    "document_version_id": None,
                    "audit_event_id": None,
                    "job_id": None,
                    "due_at": _add_days(document.updated_at, int(review_context["sla_days"])),
                    "task_metadata": {
                        "derived": True,
                        "document_status": document.status,
                        **dict(review_context["assignment_metadata"]),
                    },
                },
            )

        if document.status == DocumentStatus.draft.value:
            draft_context = _workflow_assignment_context(
                document,
                roles=[DocumentAssignmentRole.owner.value, DocumentAssignmentRole.gestor.value],
                fallback_owner_id=document.owner_id,
                fallback_owner_label=document.owner_id,
                fallback_role="Document manager",
                default_sla_days=5,
            )
            _upsert_derived_task(
                db,
                source_key=f"document-draft:{document.document_id}",
                values={
                    "kind": WorkflowTaskKind.draft.value,
                    "priority": WorkflowTaskPriority.medium.value,
                    "status": WorkflowTaskStatus.waiting.value,
                    "title": "Draft needs completion",
                    "description": "Complete source file, validity metadata and ingestion preparation before review.",
                    "source": "Registry draft state",
                    "owner_id": draft_context["owner_id"],
                    "owner_label": draft_context["owner_label"],
                    "role": draft_context["role"],
                    "document_id": document.document_id,
                    "document_title": document.title,
                    "document_version_id": None,
                    "audit_event_id": None,
                    "job_id": None,
                    "due_at": _add_days(document.updated_at, int(draft_context["sla_days"])),
                    "task_metadata": {
                        "derived": True,
                        "document_status": document.status,
                        **dict(draft_context["assignment_metadata"]),
                    },
                },
            )

        if document.classification in {Classification.restricted.value, Classification.confidential.value} and document.status != DocumentStatus.valid.value:
            governance_context = _workflow_assignment_context(
                document,
                roles=[
                    DocumentAssignmentRole.auditor.value,
                    DocumentAssignmentRole.gestor.value,
                    DocumentAssignmentRole.owner.value,
                ],
                fallback_owner_id=document.owner_id,
                fallback_owner_label=document.gestor_unit or document.owner_id,
                fallback_role="Governance / auditor",
                default_sla_days=2,
            )
            _upsert_derived_task(
                db,
                source_key=f"document-governance:{document.document_id}",
                values={
                    "kind": WorkflowTaskKind.governance.value,
                    "priority": (
                        WorkflowTaskPriority.critical.value
                        if document.classification == Classification.confidential.value
                        else WorkflowTaskPriority.high.value
                    ),
                    "status": WorkflowTaskStatus.open.value,
                    "title": "Governance check before publication",
                    "description": "Restricted sources require access, conflict and compliance checks before publication.",
                    "source": "Document classification policy",
                    "owner_id": governance_context["owner_id"],
                    "owner_label": governance_context["owner_label"],
                    "role": governance_context["role"],
                    "document_id": document.document_id,
                    "document_title": document.title,
                    "document_version_id": None,
                    "audit_event_id": None,
                    "job_id": None,
                    "due_at": _add_days(document.updated_at, int(governance_context["sla_days"])),
                    "task_metadata": {
                        "derived": True,
                        "classification": document.classification,
                        **dict(governance_context["assignment_metadata"]),
                    },
                },
            )

    warning_events = db.execute(
        select(AuditEvent).where(AuditEvent.severity.in_(["warning", "error", "critical"]))
    ).scalars()
    documents_by_id = {document.document_id: document for document in documents}
    for event in warning_events:
        document_id = event.event_metadata.get("document_id")
        document = documents_by_id.get(document_id) if isinstance(document_id, str) else None
        audit_context = (
            _workflow_assignment_context(
                document,
                roles=[
                    DocumentAssignmentRole.auditor.value,
                    DocumentAssignmentRole.owner.value,
                    DocumentAssignmentRole.gestor.value,
                ],
                fallback_owner_id=document.owner_id,
                fallback_owner_label=document.gestor_unit or document.owner_id,
                fallback_role="Auditor",
                default_sla_days=1,
                base_time=event.created_at,
            )
            if document is not None
            else None
        )
        _upsert_derived_task(
            db,
            source_key=f"audit:{event.audit_event_id}",
            values={
                "kind": WorkflowTaskKind.audit.value,
                "priority": (
                    WorkflowTaskPriority.critical.value
                    if event.severity in {"critical", "error"}
                    else WorkflowTaskPriority.high.value
                ),
                "status": (
                    WorkflowTaskStatus.blocked.value
                    if event.severity in {"critical", "error"}
                    else WorkflowTaskStatus.open.value
                ),
                "title": "Audit event needs review",
                "description": "Review the audit signal and confirm whether a document, ingestion or access policy action is needed.",
                "source": event.event_type,
                "owner_id": audit_context["owner_id"] if audit_context is not None else None,
                "owner_label": audit_context["owner_label"] if audit_context is not None else "Auditor",
                "role": audit_context["role"] if audit_context is not None else "Auditor",
                "document_id": document.document_id if document is not None else None,
                "document_title": document.title if document is not None else document_id,
                "document_version_id": None,
                "audit_event_id": event.audit_event_id,
                "job_id": event.resource_id if event.resource_type == "ingestion_job" else None,
                "due_at": (
                    _add_days(event.created_at, int(audit_context["sla_days"]))
                    if document is not None and audit_context is not None
                    else _add_days(event.created_at, 1)
                ),
                "task_metadata": {
                    "derived": True,
                    "audit_severity": event.severity,
                    **(dict(audit_context["assignment_metadata"]) if audit_context is not None else {}),
                },
            },
        )


_PRIORITY_ESCALATION = {
    WorkflowTaskPriority.low.value: WorkflowTaskPriority.medium.value,
    WorkflowTaskPriority.medium.value: WorkflowTaskPriority.high.value,
    WorkflowTaskPriority.high.value: WorkflowTaskPriority.critical.value,
    WorkflowTaskPriority.critical.value: WorkflowTaskPriority.critical.value,
}


def _escalate_overdue_tasks(db: Session) -> None:
    """SLA escalation pass: overdue active tasks get a priority bump, are
    reassigned to the configured escalation subject when one exists, and an
    audit event is written. Idempotent via the sla_escalated metadata flag."""
    now = utcnow()
    tasks = db.execute(
        select(WorkflowTask).where(WorkflowTask.status.in_(ACTIVE_TASK_STATUSES))
    ).scalars()
    for task in tasks:
        metadata = dict(task.task_metadata or {})
        if metadata.get("sla_escalated"):
            continue
        due_at = task.due_at
        comparable_due_at = due_at if due_at.tzinfo is not None else due_at.replace(tzinfo=now.tzinfo)
        if comparable_due_at >= now:
            continue

        previous_owner_id = task.owner_id
        escalation_subject_id = metadata.get("escalation_subject_id")
        if isinstance(escalation_subject_id, str) and escalation_subject_id:
            task.owner_id = escalation_subject_id
            task.owner_label = str(metadata.get("escalation_label") or escalation_subject_id)
        task.priority = _PRIORITY_ESCALATION.get(task.priority, WorkflowTaskPriority.critical.value)
        task.task_metadata = {
            **metadata,
            "sla_escalated": True,
            "sla_escalated_at": now.isoformat(),
            "previous_owner_id": previous_owner_id,
        }
        add_audit_event(
            db,
            actor_id="system",
            event_type="workflow.task.sla_escalated",
            resource_type="workflow_task",
            resource_id=task.task_id,
            severity="warning",
            metadata={
                "document_id": task.document_id,
                "previous_owner_id": previous_owner_id,
                "escalated_to": task.owner_id,
                "due_at": due_at.isoformat(),
                "priority": task.priority,
            },
        )


def _get_workflow_task(db: Session, task_id: str) -> WorkflowTask:
    task = db.execute(select(WorkflowTask).where(WorkflowTask.task_id == task_id)).scalar_one_or_none()
    if task is None:
        raise problem(status.HTTP_404_NOT_FOUND, "workflow_task_not_found", "Workflow task was not found")
    return task


@health_router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(status="ok", service=settings.service_name, version=settings.service_version)


@health_router.get("/ready")
def ready(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ready", "service": "registry-api"}


@router.post(
    "/external-documents/upsert",
    response_model=ExternalDocumentResponse,
    status_code=status.HTTP_200_OK,
)
def upsert_external_document(
    payload: ExternalDocumentUpsertRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> ExternalDocumentResponse:
    _require_v2_policy(principal, payload.information_policy)
    existing_ref = db.execute(
        select(ExternalDocumentRef)
        .where(
            ExternalDocumentRef.tenant_id == payload.tenant_id,
            ExternalDocumentRef.external_system == payload.external_system.value,
            ExternalDocumentRef.external_ref == payload.external_ref,
        )
        .options(
            selectinload(ExternalDocumentRef.document).selectinload(Document.access_policies),
            selectinload(ExternalDocumentRef.document).selectinload(Document.assignments),
        )
    ).scalar_one_or_none()
    if existing_ref is not None:
        require_document_action(principal, Action.document_read, existing_ref.document, db)
        return _external_document_response(existing_ref, created=False)

    require_global_action(principal, Action.document_create, db)
    _ensure_policy_binding_registered(payload.information_policy)
    if payload.information_policy is not None and payload.tenant_id not in {
        "org_stratos",
        payload.information_policy.audience.organization_id,
    }:
        raise problem(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "organization_mismatch",
            "tenant_id must identify org_stratos for Information Policy V2 documents",
        )
    binding_columns = policy_columns(payload.information_policy)
    document_id = make_id("doc")
    governance_columns = (
        _register_governed_resource(
            principal=principal,
            resource_type="document",
            resource_id=document_id,
            source_version=make_id("gresver"),
            title=payload.title,
            policy=payload.information_policy,
            requested_scope=payload.governance_scope,
            parent_resource_id=payload.parent_governed_resource_id,
            reason="Register external AKB document policy root",
            delegated_actor_subject_id=(
                payload.integration_envelope.actor.subject_id
                if payload.integration_envelope is not None
                else None
            ),
        )
        if payload.information_policy is not None
        else {}
    )
    document = Document(
        document_id=document_id,
        title=payload.title,
        document_type=payload.document_type.value,
        status=DocumentStatus.draft.value,
        classification=(
            legacy_classification(payload.information_policy)
            if payload.information_policy is not None
            else payload.classification.value
        ),
        owner_id=payload.owner.user_id,
        gestor_unit=payload.gestor_unit,
        tags=sorted({*payload.tags, "external", payload.external_system.value.lower()}),
        document_metadata=_external_document_metadata(payload),
        **binding_columns,
        **governance_columns,
    )
    document.access_policies = _external_document_policies(payload)
    assignment_payloads = _validated_assignment_payloads(
        payload.assignments
        if payload.assignments is not None
        else _default_assignment_payloads(
            DocumentCreate(
                title=payload.title,
                document_type=payload.document_type,
                owner_id=payload.owner.user_id,
                gestor_unit=payload.gestor_unit,
                classification=payload.classification,
                tags=payload.tags,
                metadata=payload.metadata,
            )
        )
    )
    document.assignments = _assignment_models(
        document=document,
        payloads=assignment_payloads,
        actor_id=principal.subject_id,
    )
    _sync_document_assignment_denormalized_fields(document)

    external_ref = ExternalDocumentRef(
        external_document_id=make_id("extdoc"),
        tenant_id=payload.tenant_id,
        external_system=payload.external_system.value,
        external_ref=payload.external_ref,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        document=document,
        akb_source_uri=payload.akb_source_uri,
        source_location=(
            payload.source_location.model_dump(mode="json", exclude_none=True)
            if payload.source_location is not None
            else None
        ),
        citation_base_url=payload.citation_base_url,
        preview_url=payload.preview_url,
        ref_metadata=payload.metadata,
    )
    db.add(document)
    db.add(external_ref)
    audit_event = add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="external_document.upserted",
        resource_type="external_document",
        resource_id=external_ref.external_document_id,
        correlation_id=get_correlation_id(),
        metadata={
            "created": True,
            "tenant_id": payload.tenant_id,
            "external_system": payload.external_system.value,
            "external_ref": payload.external_ref,
            "entity_type": payload.entity_type,
            "entity_id": payload.entity_id,
            "document_id": document.document_id,
            "source_location": (
                payload.source_location.model_dump(mode="json", exclude_none=True)
                if payload.source_location is not None
                else None
            ),
        },
    )
    for assignment in document.assignments:
        assignment.last_audit_event_id = audit_event.audit_event_id
    _commit_or_conflict(db)
    db.refresh(external_ref)
    return _external_document_response(external_ref, created=True)


@router.get(
    "/external-documents/{external_document_id}",
    response_model=ExternalDocumentResponse,
)
def get_external_document(
    external_document_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> ExternalDocumentResponse:
    external_ref = _get_external_document_ref(db, external_document_id)
    require_document_action(principal, Action.document_read, external_ref.document, db)
    return _external_document_response(external_ref, created=False)


@router.patch(
    "/external-documents/{external_document_id}/current",
    response_model=ExternalDocumentResponse,
)
def update_external_document_current(
    external_document_id: str,
    payload: ExternalDocumentCurrentUpdateRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> ExternalDocumentResponse:
    external_ref = _get_external_document_ref(db, external_document_id)
    require_document_action(principal, Action.document_ingest, external_ref.document, db)
    _apply_external_document_current(db, external_ref, payload)
    _audit_external_document_current(db, external_ref, principal.subject_id, source="external-document")
    _commit_or_conflict(db)
    db.refresh(external_ref)
    return _external_document_response(external_ref, created=False)


@router.patch(
    "/documents/{document_id}/external-references/current",
    response_model=ExternalDocumentCurrentListResponse,
)
def update_document_external_references_current(
    document_id: str,
    payload: ExternalDocumentCurrentUpdateRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> ExternalDocumentCurrentListResponse:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_ingest, document, db)
    if payload.current_document_version_id is not None:
        _get_version(db, document_id, payload.current_document_version_id)

    external_refs = list(
        db.execute(
            select(ExternalDocumentRef)
            .where(ExternalDocumentRef.document_id == document_id)
            .order_by(ExternalDocumentRef.external_document_id)
        ).scalars()
    )
    if payload.current_document_version_id is not None:
        external_refs = [
            external_ref
            for external_ref in external_refs
            if external_ref.current_document_version_id in {None, payload.current_document_version_id}
        ]
    for external_ref in external_refs:
        _apply_external_document_current(db, external_ref, payload)
        _audit_external_document_current(db, external_ref, principal.subject_id, source="ingestion-service")

    _commit_or_conflict(db)
    for external_ref in external_refs:
        db.refresh(external_ref)
    return ExternalDocumentCurrentListResponse(
        document_id=document_id,
        updated=len(external_refs),
        items=[ExternalDocumentRefResponse.model_validate(external_ref) for external_ref in external_refs],
    )


def _apply_external_document_current(
    db: Session,
    external_ref: ExternalDocumentRef,
    payload: ExternalDocumentCurrentUpdateRequest,
) -> None:
    if "current_document_version_id" in payload.model_fields_set:
        if payload.current_document_version_id is not None:
            _get_version(db, external_ref.document_id, payload.current_document_version_id)
        external_ref.current_document_version_id = payload.current_document_version_id

    if "current_file_id" in payload.model_fields_set:
        if payload.current_file_id is not None:
            file = db.execute(
                select(DocumentFile).where(
                    DocumentFile.file_id == payload.current_file_id,
                    DocumentFile.document_id == external_ref.document_id,
                )
            ).scalar_one_or_none()
            if file is None:
                raise problem(status.HTTP_404_NOT_FOUND, "document_file_not_found", "Document file was not found")
        external_ref.current_file_id = payload.current_file_id

    if "current_ingestion_job_id" in payload.model_fields_set:
        external_ref.current_ingestion_job_id = payload.current_ingestion_job_id
    if "current_ingestion_status" in payload.model_fields_set:
        external_ref.current_ingestion_status = payload.current_ingestion_status
    if "akb_source_uri" in payload.model_fields_set:
        external_ref.akb_source_uri = payload.akb_source_uri
    if "source_location" in payload.model_fields_set:
        external_ref.source_location = (
            payload.source_location.model_dump(mode="json", exclude_none=True)
            if payload.source_location is not None
            else None
        )


def _audit_external_document_current(
    db: Session,
    external_ref: ExternalDocumentRef,
    actor_id: str,
    *,
    source: str,
) -> None:
    add_audit_event(
        db,
        actor_id=actor_id,
        event_type="external_document.current_updated",
        resource_type="external_document",
        resource_id=external_ref.external_document_id,
        correlation_id=get_correlation_id(),
        metadata={
            "document_id": external_ref.document_id,
            "current_document_version_id": external_ref.current_document_version_id,
            "current_file_id": external_ref.current_file_id,
            "current_ingestion_job_id": external_ref.current_ingestion_job_id,
            "current_ingestion_status": external_ref.current_ingestion_status,
            "source": source,
        },
    )


@router.post(
    "/document-extractions",
    response_model=DocumentExtractionStoreResponse,
    status_code=status.HTTP_201_CREATED,
)
def store_document_extraction(
    payload: DocumentExtractionStoreRequest,
    response: Response,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentExtractionStoreResponse:
    require_global_action(principal, Action.rag_query, db)
    _get_version(db, payload.document_id, payload.document_version_id)

    existing = db.execute(
        select(DocumentExtraction).where(
            DocumentExtraction.tenant_id == payload.tenant_id,
            DocumentExtraction.external_system == payload.external_system.value,
            DocumentExtraction.external_ref == payload.external_ref,
            DocumentExtraction.document_id == payload.document_id,
            DocumentExtraction.document_version_id == payload.document_version_id,
            DocumentExtraction.profile == payload.profile,
            DocumentExtraction.profile_version == payload.profile_version,
        )
    ).scalar_one_or_none()
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return DocumentExtractionStoreResponse(extraction=DocumentExtractionResponse.model_validate(existing), created=False)

    older_extractions = list(
        db.execute(
            select(DocumentExtraction).where(
                DocumentExtraction.tenant_id == payload.tenant_id,
                DocumentExtraction.external_system == payload.external_system.value,
                DocumentExtraction.external_ref == payload.external_ref,
                DocumentExtraction.document_id == payload.document_id,
                DocumentExtraction.document_version_id != payload.document_version_id,
                DocumentExtraction.profile == payload.profile,
                DocumentExtraction.profile_version == payload.profile_version,
                DocumentExtraction.status.in_(SUPERSEDABLE_EXTRACTION_STATUSES),
            )
        ).scalars()
    )
    for older in older_extractions:
        older.status = DocumentExtractionStatus.superseded.value

    extraction = DocumentExtraction(
        extraction_id=make_id("extract"),
        tenant_id=payload.tenant_id,
        external_system=payload.external_system.value,
        external_ref=payload.external_ref,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        document_id=payload.document_id,
        document_version_id=payload.document_version_id,
        profile=payload.profile,
        profile_version=payload.profile_version,
        status=payload.status.value,
        classification=payload.classification.value,
        requested_by=payload.requested_by,
        correlation_id=payload.correlation_id or get_correlation_id(),
        result=payload.result,
        missing_information=payload.missing_information,
        warnings=payload.warnings,
        extraction_metadata=payload.metadata,
    )
    db.add(extraction)
    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="document_extraction.stored",
        resource_type="document_extraction",
        resource_id=extraction.extraction_id,
        correlation_id=payload.correlation_id or get_correlation_id(),
        metadata={
            "tenant_id": payload.tenant_id,
            "external_system": payload.external_system.value,
            "external_ref": payload.external_ref,
            "document_id": payload.document_id,
            "document_version_id": payload.document_version_id,
            "profile": payload.profile,
            "profile_version": payload.profile_version,
            "status": payload.status.value,
            "superseded_extraction_ids": [item.extraction_id for item in older_extractions],
        },
    )
    _commit_or_conflict(db)
    db.refresh(extraction)
    return DocumentExtractionStoreResponse(extraction=DocumentExtractionResponse.model_validate(extraction), created=True)


@router.get(
    "/document-extractions/{extraction_id}",
    response_model=DocumentExtractionResponse,
)
def get_document_extraction(
    extraction_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentExtractionResponse:
    extraction = _get_document_extraction(db, extraction_id)
    _require_document_extraction_access(principal, extraction)
    return DocumentExtractionResponse.model_validate(extraction)


@router.post(
    "/document-extractions/{extraction_id}/feedback",
    response_model=DocumentExtractionFeedbackStoreResponse,
    status_code=status.HTTP_201_CREATED,
)
def store_document_extraction_feedback(
    extraction_id: str,
    payload: DocumentExtractionFeedbackCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentExtractionFeedbackStoreResponse:
    extraction = _get_document_extraction(db, extraction_id)
    _require_document_extraction_access(principal, extraction)
    if payload.source_app.value != extraction.external_system:
        raise problem(
            status.HTTP_409_CONFLICT,
            "source_app_mismatch",
            "Feedback source_app must match extraction external_system",
        )

    feedback = DocumentExtractionFeedback(
        feedback_id=make_id("extfb"),
        extraction_id=extraction.extraction_id,
        tenant_id=extraction.tenant_id,
        field=payload.field,
        ai_value=payload.ai_value,
        final_value=payload.final_value,
        decision=payload.decision.value,
        reason=payload.reason,
        actor_id=payload.actor,
        source_app=payload.source_app.value,
        source_entity_id=payload.source_entity_id,
        correlation_id=payload.correlation_id or get_correlation_id(),
        feedback_metadata=payload.metadata,
    )
    db.add(feedback)
    if payload.decision.value in {"accepted", "edited"}:
        extraction.status = DocumentExtractionStatus.accepted_in_source_app.value
    elif payload.decision.value == "rejected":
        extraction.status = DocumentExtractionStatus.rejected_in_source_app.value
    extraction.updated_at = utcnow()
    add_audit_event(
        db,
        actor_id=payload.actor,
        event_type="document_extraction.feedback_recorded",
        resource_type="document_extraction",
        resource_id=extraction.extraction_id,
        correlation_id=payload.correlation_id or get_correlation_id(),
        metadata={
            "tenant_id": extraction.tenant_id,
            "external_system": extraction.external_system,
            "external_ref": extraction.external_ref,
            "field": payload.field,
            "decision": payload.decision.value,
            "source_entity_id": payload.source_entity_id,
        },
    )
    _commit_or_conflict(db)
    db.refresh(feedback)
    db.refresh(extraction)
    return DocumentExtractionFeedbackStoreResponse(
        feedback=DocumentExtractionFeedbackResponse.model_validate(feedback),
        extraction=DocumentExtractionResponse.model_validate(extraction),
    )


@router.post(
    "/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_document(
    payload: DocumentCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> Document:
    _require_v2_policy(principal, payload.information_policy)
    require_global_action(principal, Action.document_create, db)
    _ensure_policy_binding_registered(payload.information_policy)
    binding_columns = policy_columns(payload.information_policy)
    document_id = make_id("doc")
    governance_columns = (
        _register_governed_resource(
            principal=principal,
            resource_type="document",
            resource_id=document_id,
            source_version=make_id("gresver"),
            title=payload.title,
            policy=payload.information_policy,
            requested_scope=payload.governance_scope,
            parent_resource_id=payload.parent_governed_resource_id,
            reason="Register AKB document policy root",
        )
        if payload.information_policy is not None
        else {}
    )
    document = Document(
        document_id=document_id,
        title=payload.title,
        document_type=payload.document_type.value,
        status=DocumentStatus.draft.value,
        classification=(
            legacy_classification(payload.information_policy)
            if payload.information_policy is not None
            else payload.classification.value
        ),
        owner_id=payload.owner_id,
        gestor_unit=payload.gestor_unit,
        tags=payload.tags,
        document_metadata=payload.metadata,
        **binding_columns,
        **governance_columns,
    )
    document.access_policies = _policy_models(document, payload)
    assignment_payloads = _validated_assignment_payloads(
        payload.assignments if payload.assignments is not None else _default_assignment_payloads(payload)
    )
    document.assignments = _assignment_models(
        document=document,
        payloads=assignment_payloads,
        actor_id=principal.subject_id,
    )
    _sync_document_assignment_denormalized_fields(document)
    db.add(document)
    audit_event = add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="document.created",
        resource_type="document",
        resource_id=document.document_id,
        metadata={
            "classification": document.classification,
            "document_type": document.document_type,
            "assignment_count": len(document.assignments),
        },
    )
    for assignment in document.assignments:
        assignment.last_audit_event_id = audit_event.audit_event_id
    _commit_or_conflict(db)
    db.refresh(document)
    return document


@router.get("/documents", response_model=DocumentListResponse)
def list_documents(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
    status_filter: DocumentStatus | None = Query(default=None, alias="status"),
    classification: Classification | None = None,
    document_type: DocumentType | None = None,
    owner_id: str | None = None,
    tag: str | None = None,
    topic: list[str] | None = Query(default=None),
    tenant_id: str | None = None,
    external_system: ExternalSourceSystem | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    external_ref: str | None = None,
    context_tag: list[str] | None = Query(default=None),
    limit: Limit = 100,
    offset: Offset = 0,
) -> DocumentListResponse:
    topics = [candidate.strip() for candidate in topic or [] if candidate.strip()]
    documents = _authorized_document_metadata_rows(
        db=db,
        principal=principal,
        status_filter=status_filter,
        classification=classification,
        document_type=document_type,
        owner_id=owner_id,
        tag=tag,
        tenant_id=tenant_id,
        external_system=external_system,
        entity_type=entity_type,
        entity_id=entity_id,
        external_ref=external_ref,
        context_tags=[candidate.strip() for candidate in context_tag or [] if candidate.strip()],
    )
    if topics:
        documents = [
            document
            for document in documents
            if any(_document_matches_metadata_topic(document, candidate) for candidate in topics)
        ]

    return DocumentListResponse(items=documents[offset : offset + limit], limit=limit, offset=offset)


@router.get("/documents/metadata-summary", response_model=DocumentMetadataSummaryResponse)
def document_metadata_summary(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
    status_filter: DocumentStatus | None = Query(default=None, alias="status"),
    classification: Classification | None = None,
    document_type: DocumentType | None = None,
    owner_id: str | None = None,
    tag: str | None = None,
    topic: list[str] | None = Query(default=None),
    tenant_id: str | None = None,
    external_system: ExternalSourceSystem | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    external_ref: str | None = None,
    context_tag: list[str] | None = Query(default=None),
) -> DocumentMetadataSummaryResponse:
    documents = _authorized_document_metadata_rows(
        db=db,
        principal=principal,
        status_filter=status_filter,
        classification=classification,
        document_type=document_type,
        owner_id=owner_id,
        tag=tag,
        tenant_id=tenant_id,
        external_system=external_system,
        entity_type=entity_type,
        entity_id=entity_id,
        external_ref=external_ref,
        context_tags=[candidate.strip() for candidate in context_tag or [] if candidate.strip()],
    )
    topics = [candidate.strip() for candidate in topic or [] if candidate.strip()]
    if not topics:
        topics = ["all documents"]

    topic_summaries: list[DocumentMetadataSummaryTopic] = []
    matched_document_ids: set[str] = set()
    for topic_label in topics[:12]:
        topic_documents = (
            documents
            if _is_all_documents_topic(topic_label)
            else [
                document
                for document in documents
                if _document_matches_metadata_topic(document, topic_label)
            ]
        )
        matched_document_ids.update(document.document_id for document in topic_documents)
        topic_summaries.append(_document_metadata_topic_summary(topic_label, topic_documents))

    return DocumentMetadataSummaryResponse(
        total_visible_documents=len(documents),
        total_matched_documents=len(matched_document_ids),
        topics=topic_summaries,
        by_document_type=_counter_buckets(Counter(document.document_type for document in documents)),
        by_classification=_counter_buckets(Counter(document.classification for document in documents)),
        by_status=_counter_buckets(Counter(document.status for document in documents)),
        by_owner=_counter_buckets(
            Counter((document.gestor_unit or document.owner_id) for document in documents)
        ),
        warnings=["REGISTRY_METADATA_SUMMARY"],
    )


@router.get("/documents/readiness-report", response_model=DocumentReadinessResponse)
def document_readiness_report(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
    status_filter: DocumentStatus | None = Query(default=None, alias="status"),
    classification: Classification | None = None,
    document_type: DocumentType | None = None,
    owner_id: str | None = None,
    tag: str | None = None,
    topic: list[str] | None = Query(default=None),
    tenant_id: str | None = None,
    external_system: ExternalSourceSystem | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    external_ref: str | None = None,
    context_tag: list[str] | None = Query(default=None),
    max_issues: Annotated[int, Query(ge=0, le=200)] = 50,
) -> DocumentReadinessResponse:
    documents = _authorized_document_metadata_rows(
        db=db,
        principal=principal,
        status_filter=status_filter,
        classification=classification,
        document_type=document_type,
        owner_id=owner_id,
        tag=tag,
        tenant_id=tenant_id,
        external_system=external_system,
        entity_type=entity_type,
        entity_id=entity_id,
        external_ref=external_ref,
        context_tags=[candidate.strip() for candidate in context_tag or [] if candidate.strip()],
    )
    topics = [candidate.strip() for candidate in topic or [] if candidate.strip()]
    if topics:
        documents = [
            document
            for document in documents
            if any(_document_matches_metadata_topic(document, candidate) for candidate in topics)
        ]

    duplicate_hashes = _duplicate_source_hashes(documents)
    issues: list[DocumentReadinessIssue] = []
    ready_documents = 0
    review_documents = 0
    blocked_documents = 0

    for document in documents:
        document_issues = _document_readiness_issues(document, duplicate_hashes)
        issues.extend(document_issues)
        severities = {issue.severity for issue in document_issues}
        if DocumentReadinessSeverity.critical in severities:
            blocked_documents += 1
        elif DocumentReadinessSeverity.warning in severities:
            review_documents += 1
        else:
            ready_documents += 1

    total = len(documents)
    return DocumentReadinessResponse(
        generated_at=utcnow(),
        total_visible_documents=total,
        ready_documents=ready_documents,
        review_documents=review_documents,
        blocked_documents=blocked_documents,
        readiness_score=round(ready_documents / total, 4) if total else 1.0,
        issue_counts=_counter_buckets(Counter(issue.code for issue in issues), limit=50),
        by_severity=_counter_buckets(Counter(issue.severity.value for issue in issues), limit=3),
        by_document_type=_counter_buckets(Counter(document.document_type for document in documents)),
        by_classification=_counter_buckets(Counter(document.classification for document in documents)),
        by_status=_counter_buckets(Counter(document.status for document in documents)),
        issues=issues[:max_issues],
        warnings=["REGISTRY_DOCUMENT_READINESS_REPORT"],
    )


def _document_readiness_issues(
    document: Document,
    duplicate_hashes: set[str],
) -> list[DocumentReadinessIssue]:
    issues: list[DocumentReadinessIssue] = []
    versions = list(document.versions)
    metadata = dict(document.document_metadata or {})

    if not document.owner_id and not _has_active_assignment(document, DocumentAssignmentRole.owner.value):
        issues.append(
            _readiness_issue(
                document,
                code="owner_missing",
                severity=DocumentReadinessSeverity.critical,
                recommendation="Assign a document owner before the record can be used in pilot evidence.",
            )
        )
    if not document.gestor_unit and not _has_active_assignment(document, DocumentAssignmentRole.gestor.value):
        issues.append(
            _readiness_issue(
                document,
                code="gestor_missing",
                severity=DocumentReadinessSeverity.warning,
                recommendation="Assign the responsible gestor or unit required by the controlled-document lifecycle.",
            )
        )

    if not document.access_policies:
        issues.append(
            _readiness_issue(
                document,
                code="access_policy_missing",
                severity=DocumentReadinessSeverity.critical,
                recommendation="Add explicit access policies before the document is available for retrieval or source opening.",
            )
        )
    elif not _has_policy_for_action(document, Action.rag_query.value):
        issues.append(
            _readiness_issue(
                document,
                code="rag_access_policy_missing",
                severity=DocumentReadinessSeverity.warning,
                recommendation="Add a policy granting rag.query to the intended authorized role or group.",
            )
        )
    elif not _has_authorized_group_policy(document):
        issues.append(
            _readiness_issue(
                document,
                code="authorized_group_missing",
                severity=DocumentReadinessSeverity.warning,
                recommendation="Bind document access to an operational role or group, not only to named users or administrators.",
            )
        )

    if document.classification == Classification.public.value:
        issues.append(
            _readiness_issue(
                document,
                code="classification_public_review",
                severity=DocumentReadinessSeverity.info,
                recommendation="Confirm that a public classification is intentional for an internal AKB controlled-document corpus.",
            )
        )

    if not versions:
        issues.append(
            _readiness_issue(
                document,
                code="source_version_missing",
                severity=DocumentReadinessSeverity.critical,
                recommendation="Create at least one source-backed document version before ingestion or RAG use.",
            )
        )
    else:
        valid_versions = [version for version in versions if version.status == DocumentStatus.valid.value]
        if not valid_versions:
            severity = (
                DocumentReadinessSeverity.critical
                if document.status in {DocumentStatus.approved.value, DocumentStatus.valid.value}
                else DocumentReadinessSeverity.warning
            )
            issues.append(
                _readiness_issue(
                    document,
                    code="valid_version_missing",
                    severity=severity,
                    recommendation="Publish one reviewed version so answers can prefer a valid source.",
                )
            )
        if not any(version.valid_from for version in versions):
            issues.append(
                _readiness_issue(
                    document,
                    code="validity_date_missing",
                    severity=DocumentReadinessSeverity.warning,
                    recommendation="Record validity/effectivity dates for lifecycle and stale-source checks.",
                )
            )
        if not any(_normalized_source_hash(version.file_hash) for version in versions):
            issues.append(
                _readiness_issue(
                    document,
                    code="source_hash_missing",
                    severity=DocumentReadinessSeverity.warning,
                    recommendation="Store the source file hash to support duplicate detection and reproducible audit evidence.",
                )
            )
        document_hashes = {
            normalized_hash
            for normalized_hash in (_normalized_source_hash(version.file_hash) for version in versions)
            if normalized_hash
        }
        if document_hashes.intersection(duplicate_hashes):
            issues.append(
                _readiness_issue(
                    document,
                    code="duplicate_source_hash",
                    severity=DocumentReadinessSeverity.warning,
                    recommendation="Review whether this source file is intentionally reused or should be consolidated as a duplicate.",
                    details={"duplicate_hashes": sorted(document_hashes.intersection(duplicate_hashes))},
                )
            )

    if not _metadata_has_any_key(metadata, READINESS_DOCUMENT_NUMBER_KEYS):
        issues.append(
            _readiness_issue(
                document,
                code="document_number_missing",
                severity=DocumentReadinessSeverity.warning,
                recommendation="Add the document number or reference identifier to Registry metadata.",
            )
        )
    if not _metadata_has_any_key(metadata, READINESS_ISSUE_DATE_KEYS):
        issues.append(
            _readiness_issue(
                document,
                code="issue_date_missing",
                severity=DocumentReadinessSeverity.warning,
                recommendation="Add the issue/publication date to Registry metadata.",
            )
        )
    if not document.tags and not _metadata_has_any_key(metadata, READINESS_SCOPE_KEYS):
        issues.append(
            _readiness_issue(
                document,
                code="scope_metadata_missing",
                severity=DocumentReadinessSeverity.warning,
                recommendation="Add tags or scope/domain metadata so users can find the document by area of responsibility.",
            )
        )

    issues.extend(_ingestion_readiness_issues(document))
    issues.extend(_quality_readiness_issues(document))
    return issues


def _ingestion_readiness_issues(document: Document) -> list[DocumentReadinessIssue]:
    statuses = [
        str(external_ref.current_ingestion_status).upper()
        for external_ref in document.external_refs
        if external_ref.current_ingestion_status
    ]
    if not statuses:
        return [
            _readiness_issue(
                document,
                code="ingestion_status_missing",
                severity=DocumentReadinessSeverity.info,
                recommendation="Link the latest ingestion job/status when the source is processed for RAG.",
            )
        ]
    if any(status in READINESS_INGESTION_FAILED_STATUSES for status in statuses):
        return [
            _readiness_issue(
                document,
                code="ingestion_failed",
                severity=DocumentReadinessSeverity.critical,
                recommendation="Repair the failed ingestion job before the document can support cited answers.",
                details={"statuses": statuses},
            )
        ]
    if any(status in READINESS_INGESTION_REVIEW_STATUSES for status in statuses):
        return [
            _readiness_issue(
                document,
                code="ingestion_requires_review",
                severity=DocumentReadinessSeverity.warning,
                recommendation="Review the ingestion output and warnings before relying on this document in answers.",
                details={"statuses": statuses},
            )
        ]
    if any(status in {"PENDING", "RUNNING", "PROPOSED"} for status in statuses):
        return [
            _readiness_issue(
                document,
                code="ingestion_in_progress",
                severity=DocumentReadinessSeverity.info,
                recommendation="Wait for ingestion completion before pilot acceptance sampling.",
                details={"statuses": statuses},
            )
        ]
    return []


def _quality_readiness_issues(document: Document) -> list[DocumentReadinessIssue]:
    metadata_sources: list[object] = [document.document_metadata]
    metadata_sources.extend(external_ref.ref_metadata for external_ref in document.external_refs)
    review_flags = [
        value
        for metadata in metadata_sources
        for value in _metadata_values_for_keys(metadata, READINESS_REVIEW_KEYS)
    ]
    quality_values = [
        str(value).strip().lower()
        for metadata in metadata_sources
        for value in _metadata_values_for_keys(metadata, READINESS_QUALITY_KEYS)
        if value is not None
    ]
    if any(str(value).strip().lower() in {"1", "true", "yes", "ano"} for value in review_flags):
        return [
            _readiness_issue(
                document,
                code="quality_review_required",
                severity=DocumentReadinessSeverity.warning,
                recommendation="Resolve extraction/OCR quality review before using the document as a primary source.",
            )
        ]
    if any(value == "poor" for value in quality_values):
        return [
            _readiness_issue(
                document,
                code="low_extraction_quality",
                severity=DocumentReadinessSeverity.critical,
                recommendation="Reprocess or manually verify low-quality extraction/OCR before RAG use.",
                details={"quality_values": quality_values},
            )
        ]
    if any(value == "review" for value in quality_values):
        return [
            _readiness_issue(
                document,
                code="quality_review_required",
                severity=DocumentReadinessSeverity.warning,
                recommendation="Resolve extraction/OCR quality review before using the document as a primary source.",
                details={"quality_values": quality_values},
            )
        ]
    return []


def _readiness_issue(
    document: Document,
    *,
    code: str,
    severity: DocumentReadinessSeverity,
    recommendation: str,
    details: dict[str, object] | None = None,
) -> DocumentReadinessIssue:
    return DocumentReadinessIssue(
        code=code,
        severity=severity,
        document_id=document.document_id,
        title=document.title,
        recommendation=recommendation,
        details=dict(details or {}),
    )


def _duplicate_source_hashes(documents: list[Document]) -> set[str]:
    document_ids_by_hash: dict[str, set[str]] = {}
    for document in documents:
        for version in document.versions:
            source_hash = _normalized_source_hash(version.file_hash)
            if source_hash:
                document_ids_by_hash.setdefault(source_hash, set()).add(document.document_id)
    return {
        source_hash
        for source_hash, document_ids in document_ids_by_hash.items()
        if len(document_ids) > 1
    }


def _normalized_source_hash(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower()
    return normalized.removeprefix("sha256:")


def _has_active_assignment(document: Document, role: str) -> bool:
    return any(assignment.active and assignment.role == role for assignment in document.assignments)


def _has_policy_for_action(document: Document, action: str) -> bool:
    return any(action in policy.actions or "*" in policy.actions for policy in document.access_policies)


def _has_authorized_group_policy(document: Document) -> bool:
    for policy in document.access_policies:
        if (
            "*" not in policy.actions
            and Action.document_read.value not in policy.actions
            and Action.rag_query.value not in policy.actions
        ):
            continue
        for subject in policy.subjects:
            if subject.startswith("group:"):
                return True
            if subject.startswith("role:") and subject not in {"role:admin"}:
                return True
    return False


def _metadata_has_any_key(value: object, expected_keys: set[str]) -> bool:
    return bool(_metadata_values_for_keys(value, expected_keys))


def _metadata_values_for_keys(value: object, expected_keys: set[str]) -> list[object]:
    if value is None:
        return []
    if isinstance(value, dict):
        values: list[object] = []
        for key, item in value.items():
            normalized_key = _normalize_metadata_text(str(key)).replace(" ", "_")
            if normalized_key in expected_keys:
                values.append(item)
            values.extend(_metadata_values_for_keys(item, expected_keys))
        return values
    if isinstance(value, list):
        values: list[object] = []
        for item in value:
            values.extend(_metadata_values_for_keys(item, expected_keys))
        return values
    return []


def _authorized_document_metadata_rows(
    *,
    db: Session,
    principal: Principal,
    status_filter: DocumentStatus | None,
    classification: Classification | None,
    document_type: DocumentType | None,
    owner_id: str | None,
    tag: str | None,
    tenant_id: str | None,
    external_system: ExternalSourceSystem | None,
    entity_type: str | None,
    entity_id: str | None,
    external_ref: str | None,
    context_tags: list[str],
) -> list[Document]:
    stmt = (
        select(Document)
        .options(
            selectinload(Document.access_policies),
            selectinload(Document.assignments),
            selectinload(Document.external_refs),
            selectinload(Document.versions),
        )
        .order_by(desc(Document.created_at))
    )
    if any([tenant_id, external_system, entity_type, entity_id, external_ref]):
        stmt = stmt.join(ExternalDocumentRef, ExternalDocumentRef.document_id == Document.document_id).distinct()
    if tenant_id:
        stmt = stmt.where(ExternalDocumentRef.tenant_id == tenant_id)
    if external_system:
        stmt = stmt.where(ExternalDocumentRef.external_system == external_system.value)
    if entity_type:
        stmt = stmt.where(ExternalDocumentRef.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(ExternalDocumentRef.entity_id == entity_id)
    if external_ref:
        stmt = stmt.where(ExternalDocumentRef.external_ref == external_ref)
    if status_filter:
        stmt = stmt.where(Document.status == status_filter.value)
    if classification:
        stmt = stmt.where(Document.classification == classification.value)
    if document_type:
        stmt = stmt.where(Document.document_type == document_type.value)
    if owner_id:
        stmt = stmt.where(Document.owner_id == owner_id)

    context = context_for_principal(principal, db)
    documents: list[Document] = []
    for document in db.execute(stmt).scalars():
        if tag and tag not in document.tags:
            continue
        if context_tags and not all(_document_matches_context_tag(document, candidate) for candidate in context_tags):
            continue
        decision = evaluate_document_access(context, Action.document_read.value, document)
        if decision.allowed:
            documents.append(document)
    return documents


def _document_metadata_topic_summary(
    topic_label: str,
    documents: list[Document],
) -> DocumentMetadataSummaryTopic:
    return DocumentMetadataSummaryTopic(
        topic=topic_label,
        document_count=len(documents),
        valid_or_approved_count=len(
            [
                document
                for document in documents
                if document.status in {DocumentStatus.valid.value, DocumentStatus.approved.value}
            ]
        ),
        document_types=_counter_buckets(Counter(document.document_type for document in documents)),
        classifications=_counter_buckets(Counter(document.classification for document in documents)),
        statuses=_counter_buckets(Counter(document.status for document in documents)),
        owners=_counter_buckets(Counter((document.gestor_unit or document.owner_id) for document in documents)),
        example_documents=[document.title for document in documents[:5]],
    )


def _counter_buckets(counter: Counter[str], limit: int = 12) -> list[DocumentMetadataSummaryBucket]:
    return [
        DocumentMetadataSummaryBucket(key=key, label=key, count=count)
        for key, count in sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:limit]
        if key
    ]


def _document_matches_metadata_topic(document: Document, topic: str) -> bool:
    topic_text = _normalize_metadata_text(topic)
    if not topic_text:
        return False
    haystack = _document_metadata_search_text(document)
    if topic_text in haystack:
        return True
    topic_tokens = [token for token in topic_text.split() if len(token) >= 3]
    return bool(topic_tokens) and all(token in haystack for token in topic_tokens)


def _document_matches_context_tag(document: Document, context_tag: str) -> bool:
    tag_text = _normalize_metadata_text(context_tag)
    if not tag_text:
        return True
    normalized_tags = {_normalize_metadata_text(tag) for tag in document.tags}
    if tag_text in normalized_tags:
        return True
    return tag_text in _document_external_ref_search_text(document)


def _document_metadata_search_text(document: Document) -> str:
    parts: list[str] = [
        document.document_id,
        document.title,
        document.document_type,
        document.status,
        document.classification,
        document.owner_id,
        document.gestor_unit or "",
        *document.tags,
        *_metadata_scalar_values(document.document_metadata),
    ]
    for assignment in document.assignments:
        parts.extend(
            [
                assignment.role,
                assignment.subject_type,
                assignment.subject_id,
                assignment.display_label or "",
                *_metadata_scalar_values(assignment.assignment_metadata),
            ]
        )
    parts.append(_document_external_ref_search_text(document))
    return _normalize_metadata_text(" ".join(parts))


def _document_external_ref_search_text(document: Document) -> str:
    parts: list[str] = []
    for external_ref in document.external_refs:
        parts.extend(
            [
                external_ref.external_document_id,
                external_ref.tenant_id,
                external_ref.external_system,
                external_ref.external_ref,
                external_ref.entity_type,
                external_ref.entity_id,
                external_ref.current_ingestion_status or "",
                external_ref.akb_source_uri or "",
                external_ref.preview_url or "",
                *_metadata_scalar_values(external_ref.ref_metadata),
            ]
        )
    return _normalize_metadata_text(" ".join(parts))


def _metadata_scalar_values(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str | int | float | bool):
        return [str(value)]
    if isinstance(value, dict):
        values: list[str] = []
        for key, item in value.items():
            values.append(str(key))
            values.extend(_metadata_scalar_values(item))
        return values
    if isinstance(value, list):
        values: list[str] = []
        for item in value:
            values.extend(_metadata_scalar_values(item))
        return values
    return []


def _normalize_metadata_text(value: str) -> str:
    without_marks = "".join(
        char
        for char in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(char)
    )
    return re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9._/-]+", " ", without_marks).lower()).strip()


def _is_all_documents_topic(topic: str) -> bool:
    return _normalize_metadata_text(topic) in {"all documents", "vsechny dokumenty", "dokumenty"}


@router.get("/documents/{document_id}", response_model=DocumentResponse)
def get_document(
    document_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> Document:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_read, document, db)
    return document


@router.get("/documents/{document_id}/assignments", response_model=DocumentAssignmentListResponse)
def list_document_assignments(
    document_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentAssignmentListResponse:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_read, document, db)
    items = sorted(
        document.assignments,
        key=lambda assignment: (
            assignment.role,
            not assignment.is_primary,
            assignment.subject_type,
            assignment.subject_id,
        ),
    )
    return DocumentAssignmentListResponse(items=items)


@router.put("/documents/{document_id}/assignments", response_model=DocumentAssignmentListResponse)
def replace_document_assignments(
    document_id: str,
    payload: DocumentAssignmentReplaceRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentAssignmentListResponse:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_update, document, db)
    assignment_payloads = _validated_assignment_payloads(payload.assignments)

    document.assignments.clear()
    db.flush()
    document.assignments = _assignment_models(
        document=document,
        payloads=assignment_payloads,
        actor_id=principal.subject_id,
    )
    _sync_document_assignment_denormalized_fields(document)
    audit_event = add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="document.assignments.updated",
        resource_type="document",
        resource_id=document.document_id,
        metadata={
            "assignment_count": len(document.assignments),
            "roles": sorted({assignment.role for assignment in document.assignments}),
        },
    )
    for assignment in document.assignments:
        assignment.last_audit_event_id = audit_event.audit_event_id

    _commit_or_conflict(db)
    db.refresh(document)
    return DocumentAssignmentListResponse(items=document.assignments)


@router.patch("/documents/{document_id}", response_model=DocumentResponse)
def patch_document(
    document_id: str,
    payload: DocumentPatch,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> Document:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_update, document, db)

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise problem(status.HTTP_400_BAD_REQUEST, "empty_patch", "PATCH body must contain at least one field")

    if payload.title is not None:
        document.title = payload.title
    if payload.document_type is not None:
        document.document_type = payload.document_type.value
    if payload.status is not None:
        _transition_document_status(document, payload.status)
    if payload.owner_id is not None:
        document.owner_id = payload.owner_id
    if "gestor_unit" in changes:
        document.gestor_unit = payload.gestor_unit
    if payload.classification is not None:
        document.classification = payload.classification.value
    governance_update_requested = any(
        key in changes
        for key in ("information_policy", "governance_scope", "parent_governed_resource_id")
    )
    if governance_update_requested:
        effective_policy = payload.information_policy
        if effective_policy is None:
            try:
                effective_policy = InformationPolicyBinding.model_validate(document.policy_summary)
            except ValueError as exc:
                raise problem(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "policy_unavailable",
                    "A valid Information Policy V2 binding is required to change governance coordinates",
                ) from exc
        _ensure_policy_binding_registered(effective_policy)
        governance_columns = _register_governed_resource(
            principal=principal,
            resource_type="document",
            resource_id=document.document_id,
            source_version=make_id("gresver"),
            title=payload.title or document.title,
            policy=effective_policy,
            requested_scope=payload.governance_scope,
            parent_resource_id=(
                payload.parent_governed_resource_id
                if "parent_governed_resource_id" in changes
                else document.governed_parent_resource_id
            ),
            reason="Register a new immutable AKB document policy version",
            fallback_scope_type=document.governance_scope_type,
            fallback_scope_id=document.governance_scope_id,
        )
        for field, value in governance_columns.items():
            setattr(document, field, value)
    if payload.information_policy is not None:
        _ensure_policy_binding_registered(payload.information_policy)
        for field, value in policy_columns(payload.information_policy).items():
            setattr(document, field, value)
        document.classification = legacy_classification(payload.information_policy)
    if payload.tags is not None:
        document.tags = payload.tags
    if payload.metadata is not None:
        document.document_metadata = payload.metadata
    if payload.access_policies is not None:
        document.access_policies = _policy_models(document, payload)
    if payload.assignments is not None:
        assignment_payloads = _validated_assignment_payloads(payload.assignments)
        document.assignments.clear()
        db.flush()
        document.assignments = _assignment_models(
            document=document,
            payloads=assignment_payloads,
            actor_id=principal.subject_id,
        )
        _sync_document_assignment_denormalized_fields(document)

    audit_event = add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="document.updated",
        resource_type="document",
        resource_id=document.document_id,
        metadata={"changed_fields": sorted(changes.keys())},
    )
    if payload.assignments is not None:
        for assignment in document.assignments:
            assignment.last_audit_event_id = audit_event.audit_event_id
    _commit_or_conflict(db)
    db.refresh(document)
    return document


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> Response:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_delete, document, db)
    document.status = DocumentStatus.cancelled.value
    for version in document.versions:
        if version.status == DocumentStatus.valid.value:
            version.status = DocumentStatus.archived.value

    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="document.deleted",
        resource_type="document",
        resource_id=document.document_id,
        metadata={"delete_mode": "logical", "status": document.status},
    )
    _commit_or_conflict(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/documents/{document_id}/versions",
    response_model=DocumentVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_document_version(
    document_id: str,
    payload: DocumentVersionCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentVersionResponse:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_version_create, document, db)
    _ensure_policy_binding_registered(payload.information_policy)

    binding_columns = (
        policy_columns(payload.information_policy)
        if payload.information_policy is not None
        else {
            "organization_id": document.organization_id,
            "policy_binding_id": document.policy_binding_id,
            "policy_version": document.policy_version,
            "policy_hash": document.policy_hash,
            "policy_summary": dict(document.policy_summary),
        }
    )

    version = DocumentVersion(
        document_version_id=make_id("ver"),
        document_id=document.document_id,
        version_label=payload.version_label,
        status=DocumentStatus.draft.value,
        valid_from=payload.valid_from,
        valid_to=payload.valid_to,
        source_file_uri=payload.source_file_uri,
        source_location=(
            payload.source_location.model_dump(mode="json", exclude_none=True)
            if payload.source_location is not None
            else None
        ),
        file_hash=payload.file_hash,
        change_summary=payload.change_summary,
        **binding_columns,
    )
    effective_policy = payload.information_policy
    if effective_policy is None and document.policy_summary:
        effective_policy = InformationPolicyBinding.model_validate(document.policy_summary)
    governance_columns = (
        _register_governed_resource(
            principal=principal,
            resource_type="document_version",
            resource_id=version.document_version_id,
            source_version=version.document_version_id,
            title=f"{document.title} — {payload.version_label}",
            policy=effective_policy,
            requested_scope=payload.governance_scope,
            parent_resource_id=document.governed_resource_id,
            reason="Register immutable AKB document version",
            fallback_scope_type=document.governance_scope_type,
            fallback_scope_id=document.governance_scope_id,
        )
        if effective_policy is not None
        else {}
    )
    for field, value in governance_columns.items():
        setattr(version, field, value)
    db.add(version)
    file: DocumentFile | None = None
    if payload.file is not None:
        file = DocumentFile(
            document_id=document.document_id,
            document_version=version,
            uri=payload.source_file_uri,
            filename=payload.file.filename,
            mime_type=payload.file.mime_type,
            size_bytes=payload.file.size_bytes,
            sha256=payload.file.sha256 or payload.file_hash,
            uploaded_by=payload.file.uploaded_by or principal.subject_id,
        )
        db.add(file)
    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="document.version.created",
        resource_type="document_version",
        resource_id=version.document_version_id,
        metadata={"document_id": document.document_id, "version_label": version.version_label},
    )
    _commit_or_conflict(db)
    db.refresh(version)
    return _document_version_response(version)


@router.get("/documents/{document_id}/versions", response_model=DocumentVersionListResponse)
def list_document_versions(
    document_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
    status_filter: DocumentStatus | None = Query(default=None, alias="status"),
    valid_on: date | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> DocumentVersionListResponse:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_read, document, db)

    stmt = (
        select(DocumentVersion)
        .where(DocumentVersion.document_id == document_id)
        .order_by(desc(DocumentVersion.created_at))
        .limit(limit)
        .offset(offset)
    )
    if status_filter:
        stmt = stmt.where(DocumentVersion.status == status_filter.value)
    if valid_on:
        stmt = stmt.where(
            (DocumentVersion.valid_from.is_(None) | (DocumentVersion.valid_from <= valid_on)),
            (DocumentVersion.valid_to.is_(None) | (DocumentVersion.valid_to >= valid_on)),
        )
    versions = list(db.execute(stmt).scalars())
    return DocumentVersionListResponse(
        items=[_document_version_response(version) for version in versions],
        limit=limit,
        offset=offset,
    )


@router.get(
    "/documents/{document_id}/versions/{version_id}",
    response_model=DocumentVersionResponse,
)
def get_document_version(
    document_id: str,
    version_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentVersionResponse:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_read, document, db)
    return _document_version_response(_get_version(db, document_id, version_id))


@router.post(
    "/documents/{document_id}/versions/{version_id}/publish",
    response_model=DocumentVersionResponse,
)
def publish_document_version(
    document_id: str,
    version_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentVersionResponse:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_version_publish, document, db)
    version = _get_version(db, document_id, version_id)
    _publish_version(db, document=document, version=version, actor_id=principal.subject_id)
    _commit_or_conflict(db)
    db.refresh(version)
    return _document_version_response(version)


@router.post(
    "/documents/{document_id}/versions/{version_id}/archive",
    response_model=DocumentVersionResponse,
)
def archive_document_version(
    document_id: str,
    version_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentVersionResponse:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_version_archive, document, db)
    version = _get_version(db, document_id, version_id)

    _archive_version(db, document=document, version=version, actor_id=principal.subject_id)
    _commit_or_conflict(db)
    db.refresh(version)
    return _document_version_response(version)


@router.post("/authz/check", response_model=AuthzCheckResponse)
def check_authorization(
    payload: AuthzCheckRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AuthzCheckResponse:
    _require_authz_api_caller(principal, payload.subject_id)
    if payload.resource.document_id:
        document = _get_document(db, payload.resource.document_id)
        decision = (
            _service_action_decision(
                principal=principal,
                subject_id=payload.subject_id,
                action=payload.action.value,
                document=document,
            )
            if principal.service_identity
            else evaluate_runtime_document_access(
                principal,
                payload.action.value,
                document,
                evaluate_document_access(
                    _authz_subject_context(
                    db,
                    principal,
                    subject_id=payload.subject_id,
                    roles=payload.roles,
                    groups=payload.groups,
                    capabilities=payload.capabilities,
                    scopes=payload.scopes,
                    organization_id=payload.organization_id,
                    identity_active=payload.identity_active,
                    membership_active=payload.membership_active,
                    application_access_active=payload.application_access_active,
                    ),
                    payload.action.value,
                    document,
                ),
            )
        )
    else:
        if principal.service_identity:
            decision = _service_action_decision(
                principal=principal,
                subject_id=payload.subject_id,
                action=payload.action.value,
                document=None,
            )
        else:
            context = _authz_subject_context(
                db,
                principal,
                subject_id=payload.subject_id,
                roles=payload.roles,
                groups=payload.groups,
                capabilities=payload.capabilities,
                scopes=payload.scopes,
                organization_id=payload.organization_id,
                identity_active=payload.identity_active,
                membership_active=payload.membership_active,
                application_access_active=payload.application_access_active,
            )
            classification = payload.resource.classification.value if payload.resource.classification else None
            decision = evaluate_global_action(context, payload.action.value, classification)

    return AuthzCheckResponse(
        allowed=decision.allowed,
        reason=decision.reason,
        reason_codes=list(decision.reason_codes),
        constraints=decision.constraints,
    )


@router.post("/authz/filter-documents", response_model=AuthzFilterDocumentsResponse)
def filter_authorized_documents(
    payload: AuthzFilterDocumentsRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AuthzFilterDocumentsResponse:
    _require_authz_api_caller(principal, payload.subject_id)
    context = None if principal.service_identity else _authz_subject_context(
        db,
        principal,
        subject_id=payload.subject_id,
        roles=payload.roles,
        groups=payload.groups,
        capabilities=payload.capabilities,
        scopes=payload.scopes,
        organization_id=payload.organization_id,
        identity_active=payload.identity_active,
        membership_active=payload.membership_active,
        application_access_active=payload.application_access_active,
    )

    rows = db.execute(
        select(Document)
        .where(Document.document_id.in_(payload.candidate_document_ids))
        .options(selectinload(Document.access_policies))
    ).scalars()
    documents_by_id = {document.document_id: document for document in rows}
    candidate_version_ids = {
        version_id
        for values in payload.candidate_document_versions.values()
        for version_id in values
    }
    version_rows = db.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_version_id.in_(candidate_version_ids)
        )
    ).scalars() if candidate_version_ids else []
    versions_by_id = {version.document_version_id: version for version in version_rows}

    allowed_document_ids = []
    denied_document_ids = []
    for document_id in payload.candidate_document_ids:
        document = documents_by_id.get(document_id)
        if document is None:
            denied_document_ids.append(document_id)
            continue
        decision: Decision = (
            _service_action_decision(
                principal=principal,
                subject_id=payload.subject_id,
                action=payload.action.value,
                document=document,
            )
            if principal.service_identity
            else evaluate_runtime_document_access(
                principal,
                payload.action.value,
                document,
                evaluate_document_access(context, payload.action.value, document),
            )
        )
        candidate_hashes = set(payload.candidate_policy_hashes.get(document_id, []))
        policy_hash_matches = (
            (context is not None and not context.access_v2)
            or (bool(document.policy_hash) and candidate_hashes == {document.policy_hash})
        )
        candidate_versions = set(payload.candidate_document_versions.get(document_id, []))
        versions_match = (
            (context is not None and not context.access_v2)
            or (
                bool(candidate_versions)
                and all(
                    (version := versions_by_id.get(version_id)) is not None
                    and version.document_id == document_id
                    and version.status == DocumentStatus.valid.value
                    and version.policy_hash == document.policy_hash
                    for version_id in candidate_versions
                )
            )
        )
        if decision.allowed and policy_hash_matches and versions_match:
            allowed_document_ids.append(document_id)
        else:
            denied_document_ids.append(document_id)

    return AuthzFilterDocumentsResponse(
        allowed_document_ids=allowed_document_ids,
        denied_document_ids=denied_document_ids,
    )


@router.get("/workflow/tasks", response_model=WorkflowTaskListResponse)
def list_workflow_tasks(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
    status_filter: WorkflowTaskStatus | None = Query(default=None, alias="status"),
    kind: WorkflowTaskKind | None = None,
    priority: WorkflowTaskPriority | None = None,
    document_id: str | None = None,
    owner_id: str | None = None,
    include_resolved: bool = False,
    limit: Limit = 100,
    offset: Offset = 0,
) -> WorkflowTaskListResponse:
    require_global_action(principal, Action.workflow_task_read, db)
    _sync_derived_workflow_tasks(db)
    _escalate_overdue_tasks(db)
    _commit_or_conflict(db)

    stmt = select(WorkflowTask).order_by(WorkflowTask.due_at, WorkflowTask.created_at).limit(limit).offset(offset)
    if status_filter:
        stmt = stmt.where(WorkflowTask.status == status_filter.value)
    elif not include_resolved:
        stmt = stmt.where(WorkflowTask.status.in_(ACTIVE_TASK_STATUSES))
    if kind:
        stmt = stmt.where(WorkflowTask.kind == kind.value)
    if priority:
        stmt = stmt.where(WorkflowTask.priority == priority.value)
    if document_id:
        stmt = stmt.where(WorkflowTask.document_id == document_id)
    if owner_id:
        stmt = stmt.where(WorkflowTask.owner_id == owner_id)

    tasks = list(db.execute(stmt).scalars())
    context = context_for_principal(principal, db)
    document_ids = {task.document_id for task in tasks if task.document_id}
    documents_by_id = {
        document.document_id: document
        for document in db.execute(
            select(Document)
            .where(Document.document_id.in_(document_ids))
            .options(selectinload(Document.access_policies))
        ).scalars()
    }
    elevated_task_roles = {"admin", "document_manager", "auditor", "service_governance"}
    visible_tasks = []
    for task in tasks:
        if task.document_id is None:
            if context.roles & elevated_task_roles:
                visible_tasks.append(task)
            continue
        document = documents_by_id.get(task.document_id)
        if document is None:
            continue
        decision = evaluate_document_access(context, Action.document_read.value, document)
        if decision.allowed:
            visible_tasks.append(task)

    return WorkflowTaskListResponse(items=visible_tasks, limit=limit, offset=offset)


@router.post("/workflow/tasks/{task_id}/actions", response_model=WorkflowTaskResponse)
def apply_workflow_task_action(
    task_id: str,
    payload: WorkflowTaskActionRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> WorkflowTask:
    require_global_action(principal, Action.workflow_task_write, db)
    task = _get_workflow_task(db, task_id)
    document: Document | None = None
    if task.document_id:
        document = _get_document(db, task.document_id)
        require_document_action(principal, Action.document_read, document, db)

    now = utcnow()
    if payload.assignee_id:
        task.owner_id = payload.assignee_id
        task.owner_label = payload.assignee_id

    if payload.action.value == "approve":
        if document is not None and task.kind == WorkflowTaskKind.review.value:
            require_document_action(principal, Action.document_update, document, db)
            _approve_document_for_publication(db, document)
        task.status = WorkflowTaskStatus.resolved.value
        task.resolved_at = now
    elif payload.action.value == "publish":
        if document is None:
            raise problem(status.HTTP_409_CONFLICT, "workflow_task_without_document", "Workflow task has no document to publish")
        require_document_action(principal, Action.document_version_publish, document, db)
        version = _workflow_action_version(db, task=task, payload=payload)
        if version is None:
            raise problem(status.HTTP_409_CONFLICT, "no_publishable_version", "Workflow task has no version to publish")
        _publish_version(db, document=document, version=version, actor_id=principal.subject_id)
        task.document_version_id = version.document_version_id
        task.status = WorkflowTaskStatus.resolved.value
        task.resolved_at = now
    elif payload.action.value == "archive":
        if document is None:
            raise problem(status.HTTP_409_CONFLICT, "workflow_task_without_document", "Workflow task has no document to archive")
        require_document_action(principal, Action.document_version_archive, document, db)
        version = _workflow_action_version(db, task=task, payload=payload, prefer_valid=True)
        if version is None:
            raise problem(status.HTTP_409_CONFLICT, "no_archivable_version", "Workflow task has no version to archive")
        _archive_version(db, document=document, version=version, actor_id=principal.subject_id)
        task.document_version_id = version.document_version_id
        task.status = WorkflowTaskStatus.resolved.value
        task.resolved_at = now
    elif payload.action.value == "resolve":
        task.status = WorkflowTaskStatus.resolved.value
        task.resolved_at = now
    elif payload.action.value == "request_changes":
        if document is not None:
            require_document_action(principal, Action.document_update, document, db)
            version = _workflow_action_version(db, task=task, payload=payload)
            _request_document_changes(document, version)
        task.status = WorkflowTaskStatus.open.value
        task.resolved_at = None
    elif payload.action.value == "assign":
        task.status = WorkflowTaskStatus.open.value

    task.task_metadata = {
        **dict(task.task_metadata),
        "last_action": payload.action.value,
        "last_actor_id": principal.subject_id,
        "last_comment": payload.comment,
        "last_action_at": now.isoformat(),
        "decision_metadata": payload.metadata,
    }
    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type=f"workflow.task.{payload.action.value}",
        resource_type="workflow_task",
        resource_id=task.task_id,
        metadata={
            "document_id": task.document_id,
            "document_version_id": task.document_version_id,
            "status": task.status,
            "document_status": document.status if document is not None else None,
            "assignment_id": task.task_metadata.get("assignment_id"),
            "assignment_role": task.task_metadata.get("assignment_role"),
            "escalation_subject_id": task.task_metadata.get("escalation_subject_id"),
        },
    )
    _commit_or_conflict(db)
    db.refresh(task)
    return task


ANALYST_CASE_ADMIN_ROLES = {"admin", "document_manager", "auditor"}


def _analyst_case_query():
    return select(AnalystCase).options(
        selectinload(AnalystCase.saved_queries),
        selectinload(AnalystCase.evidence_items),
    )


def _analyst_case_allowed(case: AnalystCase, context: SubjectContext) -> bool:
    return case.owner_id == context.subject_id or bool(context.roles & ANALYST_CASE_ADMIN_ROLES)


def _get_analyst_case_for_principal(
    db: Session,
    case_id: str,
    principal: Principal,
    *,
    owner_required: bool = False,
) -> tuple[AnalystCase, SubjectContext]:
    context = require_global_action(principal, Action.rag_query, db)
    case = db.execute(_analyst_case_query().where(AnalystCase.case_id == case_id)).scalar_one_or_none()
    if case is None:
        raise problem(status.HTTP_404_NOT_FOUND, "analyst_case_not_found", "Analyst case was not found")
    if not _analyst_case_allowed(case, context):
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "analyst_case_access_denied",
            "Analyst case is not visible to the current subject",
        )
    if owner_required and case.owner_id != context.subject_id and "admin" not in context.roles:
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "analyst_case_owner_required",
            "Only the analyst case owner can update this case",
        )
    return case, context


@router.get("/intelligence/cases", response_model=AnalystCaseListResponse)
def list_analyst_cases(
    include_archived: bool = False,
    limit: Limit = 50,
    offset: Offset = 0,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AnalystCaseListResponse:
    context = require_global_action(principal, Action.rag_query, db)
    stmt = _analyst_case_query().order_by(desc(AnalystCase.updated_at)).limit(limit).offset(offset)
    if "admin" not in context.roles:
        stmt = stmt.where(AnalystCase.owner_id == context.subject_id)
    if not include_archived:
        stmt = stmt.where(AnalystCase.status != "archived")
    cases = list(db.execute(stmt).scalars())
    return AnalystCaseListResponse(items=cases, limit=limit, offset=offset)


@router.post(
    "/intelligence/cases",
    response_model=AnalystCaseResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_analyst_case(
    payload: AnalystCaseCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AnalystCase:
    context = require_global_action(principal, Action.rag_query, db)
    case = AnalystCase(
        case_id=make_id("case"),
        title=payload.title,
        description=payload.description,
        owner_id=context.subject_id,
        classification=payload.classification.value,
        tags=payload.tags,
        case_metadata=payload.metadata,
    )
    db.add(case)
    add_audit_event(
        db,
        actor_id=context.subject_id,
        event_type="intelligence.case.created",
        resource_type="analyst_case",
        resource_id=case.case_id,
        metadata={
            "classification": case.classification,
            "tag_count": len(case.tags),
        },
    )
    _commit_or_conflict(db)
    db.refresh(case)
    db.refresh(case, attribute_names=["saved_queries", "evidence_items"])
    return case


@router.get("/intelligence/cases/{case_id}", response_model=AnalystCaseResponse)
def get_analyst_case(
    case_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AnalystCase:
    case, _ = _get_analyst_case_for_principal(db, case_id, principal)
    return case


@router.patch("/intelligence/cases/{case_id}", response_model=AnalystCaseResponse)
def update_analyst_case(
    case_id: str,
    payload: AnalystCasePatch,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AnalystCase:
    case, context = _get_analyst_case_for_principal(db, case_id, principal, owner_required=True)
    if payload.title is not None:
        case.title = payload.title
    if payload.description is not None:
        case.description = payload.description
    if payload.status is not None:
        case.status = payload.status
    if payload.classification is not None:
        case.classification = payload.classification.value
    if payload.tags is not None:
        case.tags = payload.tags
    if payload.metadata is not None:
        case.case_metadata = payload.metadata
    case.updated_at = utcnow()
    add_audit_event(
        db,
        actor_id=context.subject_id,
        event_type="intelligence.case.updated",
        resource_type="analyst_case",
        resource_id=case.case_id,
        metadata={
            "status": case.status,
            "classification": case.classification,
            "tag_count": len(case.tags),
        },
    )
    _commit_or_conflict(db)
    db.refresh(case)
    db.refresh(case, attribute_names=["saved_queries", "evidence_items"])
    return case


@router.post(
    "/intelligence/cases/{case_id}/saved-queries",
    response_model=AnalystSavedQueryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_analyst_saved_query(
    case_id: str,
    payload: AnalystSavedQueryCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AnalystSavedQuery:
    case, context = _get_analyst_case_for_principal(db, case_id, principal, owner_required=True)
    saved_query = AnalystSavedQuery(
        saved_query_id=make_id("qry"),
        case_id=case.case_id,
        title=payload.title,
        query_text=payload.query_text,
        query_mode=payload.query_mode,
        search_fields=payload.search_fields,
        filters=payload.filters,
        created_by=context.subject_id,
    )
    db.add(saved_query)
    case.updated_at = utcnow()
    add_audit_event(
        db,
        actor_id=context.subject_id,
        event_type="intelligence.case.query_saved",
        resource_type="analyst_case",
        resource_id=case.case_id,
        metadata={
            "saved_query_id": saved_query.saved_query_id,
            "query_mode": saved_query.query_mode,
            "query_length": len(saved_query.query_text),
            "search_field_count": len(saved_query.search_fields),
        },
    )
    _commit_or_conflict(db)
    db.refresh(saved_query)
    return saved_query


@router.post(
    "/intelligence/cases/{case_id}/evidence",
    response_model=AnalystEvidenceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_analyst_evidence(
    case_id: str,
    payload: AnalystEvidenceCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AnalystEvidenceItem:
    case, context = _get_analyst_case_for_principal(db, case_id, principal, owner_required=True)
    if payload.document_id:
        document = _get_document(db, payload.document_id)
        require_document_action(principal, Action.document_read, document, db)
    evidence = AnalystEvidenceItem(
        evidence_id=make_id("evd"),
        case_id=case.case_id,
        title=payload.title,
        note=payload.note,
        document_id=payload.document_id,
        document_version_id=payload.document_version_id,
        document_title=payload.document_title,
        chunk_id=payload.chunk_id,
        page_number=payload.page_number,
        section_title=payload.section_title,
        source_file_name=payload.source_file_name,
        score=payload.score,
        snippet=payload.snippet,
        entity_types=payload.entity_types,
        entity_values=payload.entity_values,
        evidence_metadata=payload.metadata,
        created_by=context.subject_id,
    )
    db.add(evidence)
    case.updated_at = utcnow()
    add_audit_event(
        db,
        actor_id=context.subject_id,
        event_type="intelligence.case.evidence_added",
        resource_type="analyst_case",
        resource_id=case.case_id,
        metadata={
            "evidence_id": evidence.evidence_id,
            "document_id": evidence.document_id,
            "document_version_id": evidence.document_version_id,
            "chunk_id": evidence.chunk_id,
            "entity_type_count": len(evidence.entity_types),
            "entity_value_count": len(evidence.entity_values),
        },
    )
    _commit_or_conflict(db)
    db.refresh(evidence)
    return evidence


@router.post(
    "/audit/events",
    response_model=AuditEventResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_audit_event(
    payload: AuditEventCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AuditEvent:
    if principal.service_identity:
        capability, operation = _audit_service_decision_coordinates(payload.event_type)
        decision = _service_action_decision(
            principal=principal,
            subject_id=payload.actor_id,
            action=Action.audit_write.value,
            document=None,
            capability_override=capability,
            operation_override=operation,
        )
        if not decision.allowed:
            raise problem(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                decision.reason,
                {"reason_codes": list(decision.reason_codes)},
            )
    else:
        require_global_action(principal, Action.audit_write, db)
    event = add_audit_event(
        db,
        actor_id=payload.actor_id,
        event_type=payload.event_type,
        resource_type=payload.resource_type,
        resource_id=payload.resource_id,
        severity=payload.severity.value,
        correlation_id=payload.correlation_id or get_correlation_id(),
        metadata=payload.metadata,
    )
    _commit_or_conflict(db)
    db.refresh(event)
    return event


@router.post(
    "/integrations/idempotency/reserve",
    response_model=IntegrationIdempotencyReserveResponse,
)
def reserve_integration_idempotency(
    payload: IntegrationIdempotencyReserveRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> IntegrationIdempotencyReserveResponse:
    if not principal.service_identity and not (
        not principal.dynamic_access_loaded
        and principal.roles.intersection({"service_aiip", "service_rag", "admin"})
    ):
        raise problem(status.HTTP_403_FORBIDDEN, "forbidden", "Integration idempotency access denied")

    now = utcnow()
    record = db.scalar(
        select(IntegrationIdempotencyRecord).where(
            IntegrationIdempotencyRecord.client_id == payload.client_id,
            IntegrationIdempotencyRecord.operation == payload.operation,
            IntegrationIdempotencyRecord.idempotency_key == payload.idempotency_key,
        ).with_for_update()
    )
    if record is not None:
        expires_at = (
            record.expires_at
            if record.expires_at.tzinfo is not None
            else record.expires_at.replace(tzinfo=timezone.utc)
        )
    else:
        expires_at = None
    if record is not None and expires_at is not None and expires_at <= now:
        db.delete(record)
        db.flush()
        record = None

    if record is not None:
        if record.input_hash != payload.input_hash:
            state = "conflict"
        elif record.status == "completed" and record.response_body is not None:
            state = "replay"
        else:
            updated_at = (
                record.updated_at
                if record.updated_at.tzinfo is not None
                else record.updated_at.replace(tzinfo=timezone.utc)
            )
            if updated_at <= now - timedelta(minutes=5):
                record.expires_at = now + timedelta(seconds=payload.retention_seconds)
                record.updated_at = now
                record.response_status = None
                record.response_body = None
                record.audit_event_id = None
                db.commit()
                db.refresh(record)
                state = "reserved"
            else:
                state = "processing"
        return IntegrationIdempotencyReserveResponse(
            state=state,
            record_id=record.record_id,
            response_status=record.response_status,
            response_body=record.response_body,
            audit_event_id=record.audit_event_id,
            expires_at=record.expires_at,
        )

    record = IntegrationIdempotencyRecord(
        client_id=payload.client_id,
        operation=payload.operation,
        idempotency_key=payload.idempotency_key,
        input_hash=payload.input_hash,
        status="processing",
        expires_at=now + timedelta(seconds=payload.retention_seconds),
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return reserve_integration_idempotency(payload, db, principal)
    db.refresh(record)
    return IntegrationIdempotencyReserveResponse(
        state="reserved",
        record_id=record.record_id,
        expires_at=record.expires_at,
    )


@router.post(
    "/integrations/idempotency/{record_id}/complete",
    response_model=IntegrationIdempotencyCompleteResponse,
)
def complete_integration_idempotency(
    record_id: str,
    payload: IntegrationIdempotencyCompleteRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> IntegrationIdempotencyCompleteResponse:
    if not principal.service_identity and not (
        not principal.dynamic_access_loaded
        and principal.roles.intersection({"service_aiip", "service_rag", "admin"})
    ):
        raise problem(status.HTTP_403_FORBIDDEN, "forbidden", "Integration idempotency access denied")
    record = db.get(IntegrationIdempotencyRecord, record_id)
    expires_at = None
    if record is not None:
        expires_at = (
            record.expires_at
            if record.expires_at.tzinfo is not None
            else record.expires_at.replace(tzinfo=timezone.utc)
        )
    if record is None or expires_at is None or expires_at <= utcnow():
        raise problem(status.HTTP_404_NOT_FOUND, "idempotency_record_not_found", "Idempotency record was not found")
    record.status = "completed"
    record.response_status = payload.response_status
    record.response_body = payload.response_body
    record.audit_event_id = payload.audit_event_id
    db.commit()
    db.refresh(record)
    return IntegrationIdempotencyCompleteResponse(
        record_id=record.record_id,
        status="completed",
        expires_at=record.expires_at,
    )


@router.get("/audit/events", response_model=AuditEventListResponse)
def list_audit_events(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
    actor_id: str | None = None,
    event_type: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> AuditEventListResponse:
    require_global_action(principal, Action.audit_read, db)
    stmt = select(AuditEvent).order_by(desc(AuditEvent.created_at)).limit(limit).offset(offset)
    if actor_id:
        stmt = stmt.where(AuditEvent.actor_id == actor_id)
    if event_type:
        stmt = stmt.where(AuditEvent.event_type == event_type)
    if resource_type:
        stmt = stmt.where(AuditEvent.resource_type == resource_type)
    if resource_id:
        stmt = stmt.where(AuditEvent.resource_id == resource_id)

    events = list(db.execute(stmt).scalars())
    return AuditEventListResponse(items=events, limit=limit, offset=offset)


@router.get("/audit/events/{event_id}", response_model=AuditEventResponse)
def get_audit_event(
    event_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AuditEvent:
    require_global_action(principal, Action.audit_read, db)
    event = db.execute(
        select(AuditEvent).where(AuditEvent.audit_event_id == event_id)
    ).scalar_one_or_none()
    if event is None:
        raise problem(status.HTTP_404_NOT_FOUND, "audit_event_not_found", "Audit event was not found")
    return event


# --- STRATOS identity & access administration ---

from functools import lru_cache

from app.keycloak_directory import DirectoryUser, KeycloakDirectoryAdapter
from app.models import RoleMapping, UserProfile
from app.schemas import (
    DirectoryUserImportRequest,
    DirectoryUserListResponse,
    DirectoryUserResponse,
    RoleMappingListResponse,
    RoleMappingResponse,
    RoleMappingStatusPatch,
    UpsertRoleMappingRequest,
)


@lru_cache
def _directory_adapter() -> KeycloakDirectoryAdapter:
    return KeycloakDirectoryAdapter(get_settings())


def _directory_user_response(user: DirectoryUser) -> DirectoryUserResponse:
    return DirectoryUserResponse(
        subject_id=user.subject,
        display_name=user.name,
        email=user.email,
        username=user.username,
        enabled=user.enabled,
        groups=[],
    )


def _role_mapping_response(mapping: RoleMapping, display_name: str | None) -> RoleMappingResponse:
    response = RoleMappingResponse.model_validate(mapping)
    response.display_name = display_name
    return response


def _normalize_profile_settings(value: object) -> ProfileSettingsBundle:
    if isinstance(value, ProfileSettingsBundle):
        return value
    if not isinstance(value, dict):
        return ProfileSettingsBundle()

    core = value.get("core")
    apps = value.get("apps")
    normalized_apps: dict[str, dict[str, object]] = {}
    if isinstance(apps, dict):
        for app_key, app_value in apps.items():
            if isinstance(app_key, str) and isinstance(app_value, dict):
                normalized_apps[app_key] = dict(app_value)

    return ProfileSettingsBundle(
        core=dict(core) if isinstance(core, dict) else {},
        apps=normalized_apps,
    )


def _get_or_create_self_profile(db: Session, principal: Principal) -> UserProfile:
    profile = db.get(UserProfile, principal.subject_id)
    if profile is None:
        profile = UserProfile(user_id=principal.subject_id)
        db.add(profile)
    return profile


def _profile_settings_response(profile: UserProfile, principal: Principal) -> ProfileSettingsResponse:
    return ProfileSettingsResponse(
        subject_id=principal.subject_id,
        settings=_normalize_profile_settings(profile.profile_settings),
        roles=sorted(principal.roles),
        groups=sorted(principal.groups),
    )


@router.get("/user-profiles/me/settings", response_model=ProfileSettingsResponse)
def get_profile_settings(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> ProfileSettingsResponse:
    profile = _get_or_create_self_profile(db, principal)
    db.commit()
    db.refresh(profile)
    return _profile_settings_response(profile, principal)


@router.put("/user-profiles/me/settings", response_model=ProfileSettingsResponse)
def put_profile_settings(
    payload: ProfileSettingsPutRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> ProfileSettingsResponse:
    profile = _get_or_create_self_profile(db, principal)
    settings = _normalize_profile_settings(payload.settings.model_dump(mode="json"))
    settings.core.pop("role", None)
    profile.profile_settings = settings.model_dump(mode="json")
    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="user.profile_settings.updated",
        resource_type="user_profile",
        resource_id=principal.subject_id,
        metadata={
            "core_keys": sorted(settings.core.keys()),
            "app_keys": sorted(settings.apps.keys()),
        },
    )
    db.commit()
    db.refresh(profile)
    return _profile_settings_response(profile, principal)


@router.get("/admin/directory/users", response_model=DirectoryUserListResponse)
def search_directory_users(
    query: str = Query(min_length=1, max_length=200),
    limit: Limit = 20,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DirectoryUserListResponse:
    require_global_action(principal, Action.admin_manage, db)
    users = _directory_adapter().search_users(query, max_results=min(limit, 50))
    return DirectoryUserListResponse(users=[_directory_user_response(user) for user in users])


@router.get("/directory/users", response_model=DirectoryUserListResponse)
def search_workflow_directory_users(
    query: str = Query(default="", max_length=200),
    limit: Limit = 20,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DirectoryUserListResponse:
    require_global_action(principal, Action.workflow_task_write, db)
    users = _directory_adapter().search_users(query, max_results=min(limit, 50))
    return DirectoryUserListResponse(users=[_directory_user_response(user) for user in users])


@router.post(
    "/admin/directory/users/import",
    response_model=DirectoryUserResponse,
    status_code=status.HTTP_201_CREATED,
)
def import_directory_user(
    payload: DirectoryUserImportRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DirectoryUserResponse:
    require_global_action(principal, Action.admin_manage, db)
    user = _directory_adapter().get_user(payload.subject_id)
    if user is None:
        raise problem(
            status.HTTP_404_NOT_FOUND,
            "directory_user_not_found",
            "Directory user was not found in the identity provider",
        )

    profile = db.get(UserProfile, user.subject)
    if profile is None:
        profile = UserProfile(user_id=user.subject)
        db.add(profile)
    profile.display_name = user.name
    profile.email = user.email
    profile.username = user.username
    profile.identity_source = "directory"
    profile.provider = user.provider
    profile.enabled = user.enabled
    profile.status = "active" if user.enabled else "disabled"

    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="admin.directory_user.imported",
        resource_type="user_profile",
        resource_id=user.subject,
    )
    db.commit()
    return _directory_user_response(user)


@router.get("/admin/role-mappings", response_model=RoleMappingListResponse)
def list_role_mappings(
    include_removed: bool = False,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> RoleMappingListResponse:
    require_global_action(principal, Action.admin_manage, db)
    stmt = select(RoleMapping).order_by(RoleMapping.subject_id, RoleMapping.role)
    if not include_removed:
        stmt = stmt.where(RoleMapping.status != "removed")
    mappings = list(db.execute(stmt).scalars())

    subject_ids = {mapping.subject_id for mapping in mappings if mapping.subject_type == "user"}
    profiles: dict[str, str | None] = {}
    if subject_ids:
        rows = db.execute(select(UserProfile).where(UserProfile.user_id.in_(subject_ids))).scalars()
        profiles = {row.user_id: row.display_name for row in rows}

    return RoleMappingListResponse(
        members=[
            _role_mapping_response(mapping, profiles.get(mapping.subject_id))
            for mapping in mappings
        ]
    )


@router.post("/admin/role-mappings", response_model=RoleMappingResponse)
def upsert_role_mapping(
    payload: UpsertRoleMappingRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> RoleMappingResponse:
    require_global_action(principal, Action.admin_manage, db)
    mapping = db.execute(
        select(RoleMapping).where(
            RoleMapping.subject_type == payload.subject_type,
            RoleMapping.subject_id == payload.subject_id,
            RoleMapping.role == payload.role,
        )
    ).scalar_one_or_none()
    if mapping is None:
        mapping = RoleMapping(
            subject_type=payload.subject_type,
            subject_id=payload.subject_id,
            role=payload.role,
        )
        db.add(mapping)
    mapping.status = payload.status
    mapping.assigned_by = principal.subject_id
    mapping.updated_at = utcnow()

    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="admin.role_mapping.upserted",
        resource_type="role_mapping",
        resource_id=f"{payload.subject_type}:{payload.subject_id}:{payload.role}",
        metadata={"status": payload.status},
    )
    db.commit()
    db.refresh(mapping)

    profile = db.get(UserProfile, mapping.subject_id) if mapping.subject_type == "user" else None
    return _role_mapping_response(mapping, profile.display_name if profile else None)


@router.patch("/admin/role-mappings/{role_mapping_id}/status", response_model=RoleMappingResponse)
def update_role_mapping_status(
    role_mapping_id: str,
    payload: RoleMappingStatusPatch,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> RoleMappingResponse:
    require_global_action(principal, Action.admin_manage, db)
    mapping = db.get(RoleMapping, role_mapping_id)
    if mapping is None:
        raise problem(status.HTTP_404_NOT_FOUND, "role_mapping_not_found", "Role mapping was not found")
    mapping.status = payload.status
    mapping.assigned_by = principal.subject_id
    mapping.updated_at = utcnow()

    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="admin.role_mapping.status_changed",
        resource_type="role_mapping",
        resource_id=role_mapping_id,
        metadata={"status": payload.status},
    )
    db.commit()
    db.refresh(mapping)

    profile = db.get(UserProfile, mapping.subject_id) if mapping.subject_type == "user" else None
    return _role_mapping_response(mapping, profile.display_name if profile else None)


ASSISTANT_CONVERSATION_DEFAULT_RETENTION_DAYS = 180
CONVERSATION_SERVICE_ROLES = {"admin", "service_rag", "stratos_service"}


def _assistant_message_response(message: AssistantMessage) -> AssistantMessageResponse:
    return AssistantMessageResponse(
        message_id=message.message_id,
        role=message.role,
        content=message.content,
        response_type=message.response_type,
        citations=message.citations,
        metadata=message.message_metadata,
        created_at=message.created_at,
    )


def _assistant_share_response(share: AssistantConversationShare) -> AssistantConversationShareResponse:
    return AssistantConversationShareResponse(
        conversation_share_id=share.conversation_share_id,
        subject_type=share.subject_type,
        subject_id=share.subject_id,
        permission=share.permission,
        status=share.status,
        created_by=share.created_by,
        created_at=share.created_at,
        updated_at=share.updated_at,
    )


def _conversation_response(conversation: AssistantConversation) -> AssistantConversationDetailResponse:
    return AssistantConversationDetailResponse(
        conversation_id=conversation.conversation_id,
        user_id=conversation.user_id,
        status=conversation.status,
        title=conversation.title,
        visibility=conversation.visibility,
        retention_until=conversation.retention_until,
        archived_at=conversation.archived_at,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        shared_with=[_assistant_share_response(share) for share in conversation.shares if share.status == "active"],
        messages=[_assistant_message_response(message) for message in conversation.messages],
    )


def _conversation_list_item_response(conversation: AssistantConversation) -> AssistantConversationListItemResponse:
    return AssistantConversationListItemResponse(
        conversation_id=conversation.conversation_id,
        user_id=conversation.user_id,
        status=conversation.status,
        title=conversation.title,
        visibility=conversation.visibility,
        retention_until=conversation.retention_until,
        archived_at=conversation.archived_at,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        shared_with=[_assistant_share_response(share) for share in conversation.shares if share.status == "active"],
        message_count=len(conversation.messages),
    )


def _conversation_retained(conversation: AssistantConversation) -> bool:
    if conversation.retention_until is None:
        return True
    retention_until = conversation.retention_until
    if retention_until.tzinfo is None:
        retention_until = retention_until.replace(tzinfo=timezone.utc)
    return retention_until > utcnow()


def _conversation_subject_allowed(
    conversation: AssistantConversation,
    context: SubjectContext,
    *,
    allow_comment: bool = False,
    include_admin: bool = True,
) -> bool:
    if conversation.user_id == context.subject_id or (include_admin and "admin" in context.roles):
        return True
    for share in conversation.shares:
        if share.status != "active":
            continue
        if allow_comment and share.permission != "commenter":
            continue
        if share.subject_type == "user" and share.subject_id == context.subject_id:
            return True
        if share.subject_type == "group" and share.subject_id in context.groups:
            return True
    return False


def _conversation_for_principal(
    db: Session,
    conversation_id: str,
    principal: Principal,
    *,
    allow_comment: bool = False,
) -> tuple[AssistantConversation, SubjectContext]:
    context = require_global_action(principal, Action.rag_query, db)
    conversation = db.execute(
        select(AssistantConversation)
        .options(selectinload(AssistantConversation.messages), selectinload(AssistantConversation.shares))
        .where(AssistantConversation.conversation_id == conversation_id)
    ).scalar_one_or_none()
    if conversation is None or not _conversation_retained(conversation):
        raise problem(
            status.HTTP_404_NOT_FOUND,
            "conversation_not_found",
            "Assistant conversation was not found",
        )
    if not _conversation_subject_allowed(conversation, context, allow_comment=allow_comment):
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "conversation_access_denied",
            "Assistant conversation is not visible to the current subject",
        )
    return conversation, context


def _can_persist_for_user(context: SubjectContext, user_id: str) -> bool:
    return context.subject_id == user_id or bool(context.roles.intersection(CONVERSATION_SERVICE_ROLES))


def _default_conversation_retention_until():
    return utcnow() + timedelta(days=ASSISTANT_CONVERSATION_DEFAULT_RETENTION_DAYS)


@router.get(
    "/assistant/conversation-history",
    response_model=AssistantConversationListResponse,
)
def list_assistant_conversations(
    include_archived: bool = False,
    limit: Limit = 50,
    offset: Offset = 0,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AssistantConversationListResponse:
    context = require_global_action(principal, Action.rag_query, db)
    conversations = db.execute(
        select(AssistantConversation)
        .options(selectinload(AssistantConversation.messages), selectinload(AssistantConversation.shares))
        .order_by(desc(AssistantConversation.updated_at))
    ).scalars()
    visible: list[AssistantConversation] = []
    for conversation in conversations:
        if not _conversation_retained(conversation):
            continue
        if not include_archived and conversation.status == "archived":
            continue
        if _conversation_subject_allowed(conversation, context):
            visible.append(conversation)
    return AssistantConversationListResponse(
        items=[_conversation_list_item_response(conversation) for conversation in visible[offset : offset + limit]],
        limit=limit,
        offset=offset,
    )


@router.post(
    "/assistant/conversations/{conversation_id}/messages",
    response_model=AssistantConversationDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
def append_assistant_messages(
    conversation_id: str,
    payload: AssistantMessageAppendRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AssistantConversationDetailResponse:
    subject_context = require_global_action(principal, Action.rag_query, db)
    if not _can_persist_for_user(subject_context, payload.user_id):
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "conversation_user_mismatch",
            "Conversation can only be persisted for the current user",
        )
    conversation = db.get(AssistantConversation, conversation_id)
    if conversation is None:
        conversation = AssistantConversation(
            conversation_id=conversation_id,
            user_id=payload.user_id,
            title=payload.title,
            visibility=payload.visibility or "private",
            retention_until=payload.retention_until or _default_conversation_retention_until(),
        )
        db.add(conversation)
    else:
        db.refresh(conversation, attribute_names=["shares"])
    if conversation.user_id != payload.user_id and not _conversation_subject_allowed(
        conversation,
        subject_context,
        allow_comment=True,
        include_admin=False,
    ):
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "conversation_user_mismatch",
            "Conversation belongs to a different user",
        )
    if payload.title and not conversation.title:
        conversation.title = payload.title
    if payload.visibility:
        conversation.visibility = payload.visibility
    if payload.retention_until:
        conversation.retention_until = payload.retention_until

    for message in payload.messages:
        db.add(
            AssistantMessage(
                conversation_id=conversation_id,
                role=message.role,
                content=message.content,
                response_type=message.response_type,
                citations=message.citations,
                message_metadata=message.metadata,
            )
        )
    conversation.updated_at = utcnow()
    db.commit()
    db.refresh(conversation)
    db.refresh(conversation, attribute_names=["messages", "shares"])
    return _conversation_response(conversation)


@router.get(
    "/assistant/conversation-history/{conversation_id}",
    response_model=AssistantConversationDetailResponse,
)
def get_assistant_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AssistantConversationDetailResponse:
    conversation, _ = _conversation_for_principal(db, conversation_id, principal)
    return _conversation_response(conversation)


@router.patch(
    "/assistant/conversation-history/{conversation_id}",
    response_model=AssistantConversationDetailResponse,
)
def update_assistant_conversation(
    conversation_id: str,
    payload: AssistantConversationPatch,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AssistantConversationDetailResponse:
    conversation, context = _conversation_for_principal(db, conversation_id, principal)
    if conversation.user_id != context.subject_id and "admin" not in context.roles:
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "conversation_owner_required",
            "Only the conversation owner can update retention, title or archive status",
        )
    if payload.title is not None:
        conversation.title = payload.title
    if payload.visibility is not None:
        conversation.visibility = payload.visibility
    if payload.retention_until is not None:
        conversation.retention_until = payload.retention_until
    if payload.status is not None:
        conversation.status = payload.status
        conversation.archived_at = utcnow() if payload.status == "archived" else None
    conversation.updated_at = utcnow()
    db.commit()
    db.refresh(conversation)
    db.refresh(conversation, attribute_names=["messages", "shares"])
    return _conversation_response(conversation)


@router.put(
    "/assistant/conversation-history/{conversation_id}/shares",
    response_model=AssistantConversationDetailResponse,
)
def replace_assistant_conversation_shares(
    conversation_id: str,
    payload: AssistantConversationShareReplaceRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AssistantConversationDetailResponse:
    conversation, context = _conversation_for_principal(db, conversation_id, principal)
    if conversation.user_id != context.subject_id and "admin" not in context.roles:
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "conversation_owner_required",
            "Only the conversation owner can change sharing",
        )

    requested = {(share.subject_type, share.subject_id): share for share in payload.shares}
    for share in conversation.shares:
        if (share.subject_type, share.subject_id) not in requested:
            share.status = "removed"
            share.updated_at = utcnow()
    for (subject_type, subject_id), request_share in requested.items():
        existing = next(
            (
                share
                for share in conversation.shares
                if share.subject_type == subject_type and share.subject_id == subject_id
            ),
            None,
        )
        if existing:
            existing.permission = request_share.permission
            existing.status = "active"
            existing.updated_at = utcnow()
        else:
            db.add(
                AssistantConversationShare(
                    conversation_id=conversation_id,
                    subject_type=subject_type,
                    subject_id=subject_id,
                    permission=request_share.permission,
                    created_by=context.subject_id,
                )
            )
    conversation.visibility = payload.visibility if payload.shares else "private"
    conversation.updated_at = utcnow()
    add_audit_event(
        db,
        actor_id=context.subject_id,
        event_type="assistant.conversation.shared",
        resource_type="assistant_conversation",
        resource_id=conversation_id,
        metadata={
            "share_count": len(payload.shares),
            "visibility": conversation.visibility,
        },
    )
    db.commit()
    db.refresh(conversation)
    db.refresh(conversation, attribute_names=["messages", "shares"])
    return _conversation_response(conversation)
