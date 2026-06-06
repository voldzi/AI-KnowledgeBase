from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import desc, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from starlette import status

from app.audit import add_audit_event
from app.auth import Principal, get_current_principal
from app.config import get_settings
from app.database import get_db
from app.errors import problem
from app.middleware import get_correlation_id
from app.models import (
    AuditEvent,
    Document,
    DocumentAccessPolicy,
    DocumentFile,
    DocumentVersion,
    WorkflowTask,
    make_id,
    utcnow,
)
from app.permissions import (
    Decision,
    SubjectContext,
    context_for_principal,
    context_for_subject,
    evaluate_document_access,
    evaluate_global_action,
    require_document_action,
    require_global_action,
)
from app.schemas import (
    Action,
    AuditEventCreate,
    AuditEventListResponse,
    AuditEventResponse,
    AuthzCheckRequest,
    AuthzCheckResponse,
    AuthzFilterDocumentsRequest,
    AuthzFilterDocumentsResponse,
    Classification,
    DocumentCreate,
    DocumentListResponse,
    DocumentPatch,
    DocumentResponse,
    DocumentStatus,
    DocumentType,
    DocumentVersionCreate,
    DocumentVersionListResponse,
    DocumentVersionResponse,
    HealthResponse,
    WorkflowTaskActionRequest,
    WorkflowTaskKind,
    WorkflowTaskListResponse,
    WorkflowTaskPriority,
    WorkflowTaskResponse,
    WorkflowTaskStatus,
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


def _get_document(db: Session, document_id: str) -> Document:
    document = db.execute(
        select(Document)
        .where(Document.document_id == document_id)
        .options(selectinload(Document.access_policies))
    ).scalar_one_or_none()
    if document is None:
        raise problem(status.HTTP_404_NOT_FOUND, "document_not_found", "Document was not found")
    return document


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


def _commit_or_conflict(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise problem(status.HTTP_409_CONFLICT, "conflict", "Registry record already exists") from exc


def _require_authz_api_caller(principal: Principal, subject_id: str) -> None:
    caller = context_for_principal(principal)
    service_roles = {role for role in caller.roles if role.startswith("service_")}
    if principal.subject_id == subject_id or {"admin", "document_manager"} & caller.roles or service_roles:
        return
    raise problem(
        status.HTTP_403_FORBIDDEN,
        "forbidden",
        "Only service accounts, admins, document managers, or the same subject can call this authz check",
    )


def _authz_subject_context(
    db: Session,
    principal: Principal,
    *,
    subject_id: str,
    roles: list[str],
    groups: list[str],
) -> SubjectContext:
    if principal.subject_id == subject_id:
        caller = context_for_principal(principal)
        return context_for_subject(db, subject_id, caller.roles, caller.groups)
    return context_for_subject(db, subject_id, roles, groups)


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
            task.task_metadata = {**dict(value), **existing_metadata}
            continue
        setattr(task, key, value)


def _sync_derived_workflow_tasks(db: Session) -> None:
    documents = list(db.execute(select(Document)).scalars())
    for document in documents:
        if document.status == DocumentStatus.review.value:
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
                    "owner_id": document.owner_id,
                    "owner_label": document.gestor_unit or document.owner_id,
                    "role": "Owner / gestor",
                    "document_id": document.document_id,
                    "document_title": document.title,
                    "document_version_id": None,
                    "audit_event_id": None,
                    "job_id": None,
                    "due_at": _add_days(document.updated_at, 3),
                    "task_metadata": {"derived": True, "document_status": document.status},
                },
            )

        if document.status == DocumentStatus.draft.value:
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
                    "owner_id": document.owner_id,
                    "owner_label": document.owner_id,
                    "role": "Document manager",
                    "document_id": document.document_id,
                    "document_title": document.title,
                    "document_version_id": None,
                    "audit_event_id": None,
                    "job_id": None,
                    "due_at": _add_days(document.updated_at, 5),
                    "task_metadata": {"derived": True, "document_status": document.status},
                },
            )

        if document.classification in {Classification.restricted.value, Classification.confidential.value} and document.status != DocumentStatus.valid.value:
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
                    "owner_id": document.owner_id,
                    "owner_label": document.gestor_unit or document.owner_id,
                    "role": "Governance / auditor",
                    "document_id": document.document_id,
                    "document_title": document.title,
                    "document_version_id": None,
                    "audit_event_id": None,
                    "job_id": None,
                    "due_at": _add_days(document.updated_at, 2),
                    "task_metadata": {"derived": True, "classification": document.classification},
                },
            )

    warning_events = db.execute(
        select(AuditEvent).where(AuditEvent.severity.in_(["warning", "error", "critical"]))
    ).scalars()
    documents_by_id = {document.document_id: document for document in documents}
    for event in warning_events:
        document_id = event.event_metadata.get("document_id")
        document = documents_by_id.get(document_id) if isinstance(document_id, str) else None
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
                "owner_id": document.owner_id if document is not None else None,
                "owner_label": (document.gestor_unit or document.owner_id) if document is not None else "Auditor",
                "role": "Auditor",
                "document_id": document.document_id if document is not None else None,
                "document_title": document.title if document is not None else document_id,
                "document_version_id": None,
                "audit_event_id": event.audit_event_id,
                "job_id": event.resource_id if event.resource_type == "ingestion_job" else None,
                "due_at": _add_days(event.created_at, 1),
                "task_metadata": {"derived": True, "audit_severity": event.severity},
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
    "/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_document(
    payload: DocumentCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> Document:
    require_global_action(principal, Action.document_create)
    document = Document(
        document_id=make_id("doc"),
        title=payload.title,
        document_type=payload.document_type.value,
        status=DocumentStatus.draft.value,
        classification=payload.classification.value,
        owner_id=payload.owner_id,
        gestor_unit=payload.gestor_unit,
        tags=payload.tags,
        document_metadata=payload.metadata,
    )
    document.access_policies = _policy_models(document, payload)
    db.add(document)
    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="document.created",
        resource_type="document",
        resource_id=document.document_id,
        metadata={"classification": document.classification, "document_type": document.document_type},
    )
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
    limit: Limit = 100,
    offset: Offset = 0,
) -> DocumentListResponse:
    stmt = (
        select(Document)
        .options(selectinload(Document.access_policies))
        .order_by(desc(Document.created_at))
        .limit(limit)
        .offset(offset)
    )
    if status_filter:
        stmt = stmt.where(Document.status == status_filter.value)
    if classification:
        stmt = stmt.where(Document.classification == classification.value)
    if document_type:
        stmt = stmt.where(Document.document_type == document_type.value)
    if owner_id:
        stmt = stmt.where(Document.owner_id == owner_id)

    context = context_for_principal(principal)
    documents = []
    for document in db.execute(stmt).scalars():
        if tag and tag not in document.tags:
            continue
        decision = evaluate_document_access(context, Action.document_read.value, document)
        if decision.allowed:
            documents.append(document)

    return DocumentListResponse(items=documents, limit=limit, offset=offset)


@router.get("/documents/{document_id}", response_model=DocumentResponse)
def get_document(
    document_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> Document:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_read, document)
    return document


@router.patch("/documents/{document_id}", response_model=DocumentResponse)
def patch_document(
    document_id: str,
    payload: DocumentPatch,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> Document:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_update, document)

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
    if payload.tags is not None:
        document.tags = payload.tags
    if payload.metadata is not None:
        document.document_metadata = payload.metadata
    if payload.access_policies is not None:
        document.access_policies = _policy_models(document, payload)

    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="document.updated",
        resource_type="document",
        resource_id=document.document_id,
        metadata={"changed_fields": sorted(changes.keys())},
    )
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
    require_document_action(principal, Action.document_delete, document)
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
) -> DocumentVersion:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_version_create, document)

    version = DocumentVersion(
        document_version_id=make_id("ver"),
        document_id=document.document_id,
        version_label=payload.version_label,
        status=DocumentStatus.draft.value,
        valid_from=payload.valid_from,
        valid_to=payload.valid_to,
        source_file_uri=payload.source_file_uri,
        file_hash=payload.file_hash,
        change_summary=payload.change_summary,
    )
    db.add(version)
    if payload.file is not None:
        db.add(
            DocumentFile(
                document_id=document.document_id,
                document_version=version,
                uri=payload.source_file_uri,
                filename=payload.file.filename,
                mime_type=payload.file.mime_type,
                size_bytes=payload.file.size_bytes,
                sha256=payload.file.sha256 or payload.file_hash,
                uploaded_by=payload.file.uploaded_by or principal.subject_id,
            )
        )
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
    return version


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
    require_document_action(principal, Action.document_read, document)

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
    return DocumentVersionListResponse(items=versions, limit=limit, offset=offset)


@router.get(
    "/documents/{document_id}/versions/{version_id}",
    response_model=DocumentVersionResponse,
)
def get_document_version(
    document_id: str,
    version_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentVersion:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_read, document)
    return _get_version(db, document_id, version_id)


@router.post(
    "/documents/{document_id}/versions/{version_id}/publish",
    response_model=DocumentVersionResponse,
)
def publish_document_version(
    document_id: str,
    version_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentVersion:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_version_publish, document)
    version = _get_version(db, document_id, version_id)
    _publish_version(db, document=document, version=version, actor_id=principal.subject_id)
    _commit_or_conflict(db)
    db.refresh(version)
    return version


@router.post(
    "/documents/{document_id}/versions/{version_id}/archive",
    response_model=DocumentVersionResponse,
)
def archive_document_version(
    document_id: str,
    version_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> DocumentVersion:
    document = _get_document(db, document_id)
    require_document_action(principal, Action.document_version_archive, document)
    version = _get_version(db, document_id, version_id)

    _archive_version(db, document=document, version=version, actor_id=principal.subject_id)
    _commit_or_conflict(db)
    db.refresh(version)
    return version


@router.post("/authz/check", response_model=AuthzCheckResponse)
def check_authorization(
    payload: AuthzCheckRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AuthzCheckResponse:
    _require_authz_api_caller(principal, payload.subject_id)
    context = _authz_subject_context(
        db,
        principal,
        subject_id=payload.subject_id,
        roles=payload.roles,
        groups=payload.groups,
    )

    if payload.resource.document_id:
        document = _get_document(db, payload.resource.document_id)
        decision = evaluate_document_access(context, payload.action.value, document)
    else:
        classification = payload.resource.classification.value if payload.resource.classification else None
        decision = evaluate_global_action(context, payload.action.value, classification)

    return AuthzCheckResponse(
        allowed=decision.allowed,
        reason=decision.reason,
        constraints=decision.constraints,
    )


@router.post("/authz/filter-documents", response_model=AuthzFilterDocumentsResponse)
def filter_authorized_documents(
    payload: AuthzFilterDocumentsRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AuthzFilterDocumentsResponse:
    _require_authz_api_caller(principal, payload.subject_id)
    context = _authz_subject_context(
        db,
        principal,
        subject_id=payload.subject_id,
        roles=payload.roles,
        groups=payload.groups,
    )

    rows = db.execute(
        select(Document)
        .where(Document.document_id.in_(payload.candidate_document_ids))
        .options(selectinload(Document.access_policies))
    ).scalars()
    documents_by_id = {document.document_id: document for document in rows}

    allowed_document_ids = []
    denied_document_ids = []
    for document_id in payload.candidate_document_ids:
        document = documents_by_id.get(document_id)
        if document is None:
            denied_document_ids.append(document_id)
            continue
        decision: Decision = evaluate_document_access(context, payload.action.value, document)
        if decision.allowed:
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
    require_global_action(principal, Action.workflow_task_read)
    _sync_derived_workflow_tasks(db)
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
    context = context_for_principal(principal)
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
    require_global_action(principal, Action.workflow_task_write)
    task = _get_workflow_task(db, task_id)
    document: Document | None = None
    if task.document_id:
        document = _get_document(db, task.document_id)
        require_document_action(principal, Action.document_read, document)

    now = utcnow()
    if payload.assignee_id:
        task.owner_id = payload.assignee_id
        task.owner_label = payload.assignee_id

    if payload.action.value == "approve":
        if document is not None and task.kind == WorkflowTaskKind.review.value:
            require_document_action(principal, Action.document_update, document)
            _approve_document_for_publication(db, document)
        task.status = WorkflowTaskStatus.resolved.value
        task.resolved_at = now
    elif payload.action.value == "publish":
        if document is None:
            raise problem(status.HTTP_409_CONFLICT, "workflow_task_without_document", "Workflow task has no document to publish")
        require_document_action(principal, Action.document_version_publish, document)
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
        require_document_action(principal, Action.document_version_archive, document)
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
            require_document_action(principal, Action.document_update, document)
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
        },
    )
    _commit_or_conflict(db)
    db.refresh(task)
    return task


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
    require_global_action(principal, Action.audit_write)
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
    require_global_action(principal, Action.audit_read)
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
    require_global_action(principal, Action.audit_read)
    event = db.execute(
        select(AuditEvent).where(AuditEvent.audit_event_id == event_id)
    ).scalar_one_or_none()
    if event is None:
        raise problem(status.HTTP_404_NOT_FOUND, "audit_event_not_found", "Audit event was not found")
    return event
