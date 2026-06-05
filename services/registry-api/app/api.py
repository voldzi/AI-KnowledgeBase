from datetime import date
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
)

router = APIRouter(prefix="/api/v1")
health_router = APIRouter()

Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


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
        document.status = payload.status.value
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
    if version.status == DocumentStatus.archived.value:
        raise problem(status.HTTP_409_CONFLICT, "version_archived", "Archived version cannot be published")

    active_versions = db.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_id == document_id,
            DocumentVersion.status == DocumentStatus.valid.value,
            DocumentVersion.document_version_id != version_id,
        )
    ).scalars()
    for active_version in active_versions:
        active_version.status = DocumentStatus.superseded.value

    version.status = DocumentStatus.valid.value
    version.published_at = utcnow()
    document.status = DocumentStatus.valid.value
    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="document.version.published",
        resource_type="document_version",
        resource_id=version.document_version_id,
        metadata={"document_id": document.document_id},
    )
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

    version.status = DocumentStatus.archived.value
    has_other_valid = db.execute(
        select(DocumentVersion.document_version_id).where(
            DocumentVersion.document_id == document_id,
            DocumentVersion.status == DocumentStatus.valid.value,
            DocumentVersion.document_version_id != version_id,
        )
    ).first()
    if not has_other_valid and document.status == DocumentStatus.valid.value:
        document.status = DocumentStatus.archived.value

    add_audit_event(
        db,
        actor_id=principal.subject_id,
        event_type="document.version.archived",
        resource_type="document_version",
        resource_id=version.document_version_id,
        metadata={"document_id": document.document_id},
    )
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
