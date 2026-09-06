"""Interactive STRATOS source intake, with fresh source authority at each boundary.

Source-specific checks surround the shared document/profile/version engine. No
source service acquires the interactive person's generic Registry privileges.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import api
from app.access_governance import GovernanceDenied, GovernanceUnavailable, governance_client
from app.auth import Principal, get_authenticated_principal, get_current_principal
from app.config import get_settings
from app.database import get_db
from app.document_profile import DocumentLifecycle
from app.document_profile_inputs import DocumentVersionProfileInput
from app.document_profile_runtime import require_current_root, require_fresh_document_profile
from app.errors import problem
from app.information_policy import canonical_policy_hash
from app.middleware import get_correlation_id
from app.models import ExternalDocumentRef
from app.permissions import Action, require_document_action
from app.schemas import ExternalDocumentUpsertRequest, ExternalDocumentResponse, DocumentVersionCreate, DocumentVersionResponse, DocumentFileCreate

SOURCE_CLIENTS = {"STRATOS_PROJECTFLOW": "stratos-projectflow-akb-service", "STRATOS_ARCHFLOW": "stratos-archflow-akb-service"}
SOURCE_SYSTEMS = frozenset(SOURCE_CLIENTS)
router = APIRouter(prefix="/api/v1/integrations/stratos-source-intake", tags=["STRATOS source intake"])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceDocument(ExternalDocumentUpsertRequest):
    model_config = ConfigDict(extra="forbid")
    external_system: Literal["STRATOS_PROJECTFLOW", "STRATOS_ARCHFLOW"]
    entity_type: Literal["project", "task", "status_report", "need"]
    tenant_id: Literal["org_stratos"] = "org_stratos"
    source_document_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    project_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

    @model_validator(mode="after")
    def exact_source(self):
        import re
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", self.entity_id):
            raise ValueError("Source entity id is invalid")
        if self.tenant_id != "org_stratos" or self.integration_envelope is not None:
            raise ValueError("Source intake uses its typed source coordinates in org_stratos")
        if self.metadata or self.akb_source_uri or self.source_location or self.access_policies:
            raise ValueError("Caller metadata, storage URI, source location and local ACL overrides are forbidden")
        if self.external_system == "STRATOS_PROJECTFLOW":
            if not self.project_id or self.entity_type not in {"project", "task", "status_report"}:
                raise ValueError("ProjectFlow requires an exact project and supported entity")
            if self.entity_type == "project" and self.entity_id != self.project_id:
                raise ValueError("Project identity differs")
            prefix = f"project:{self.project_id}"
            if self.entity_type != "project":
                prefix += f":{'status-report' if self.entity_type == 'status_report' else 'task'}:{self.entity_id}"
            if not self.governance_scope or self.governance_scope.type != "project" or self.governance_scope.id != self.project_id:
                raise ValueError("ProjectFlow scope must name the exact project")
        else:
            if self.entity_type != "need" or self.project_id is not None:
                raise ValueError("ArchFlow source is an exact need record")
            prefix = f"archflow-need:{self.entity_id}"
            if not self.governance_scope or self.governance_scope.type not in {"organization", "own"}:
                raise ValueError("ArchFlow requires the authoritative organization or own scope")
            if self.governance_scope.type == "organization" and self.governance_scope.id != "org_stratos":
                raise ValueError("Organization scope must name org_stratos")
        if self.external_ref != f"{prefix}:document:{self.source_document_id}":
            raise ValueError("external_ref must be canonical and stable across versions")
        provenance = self.document_profile.provenance
        if (provenance.source_system != self.external_system or provenance.source_record_id != self.entity_id
            or not self.parent_governed_resource_id or provenance.source_governed_resource_id != self.parent_governed_resource_id):
            raise ValueError("Profile provenance must match the exact source record and governed parent")
        if self.owner.user_id != self.document_profile.accountability.owner_subject_id:
            raise ValueError("Owner must match the accountable profile")
        policy = self.information_policy
        if not policy.originator_id or "AUDIT_ACCESS" not in policy.obligations:
            raise ValueError("An explicit originator and AUDIT_ACCESS are required")
        allowed = {"organization", "recipient_set"}
        if self.project_id:
            allowed.add("project")
        if policy.audience.scope_type not in allowed or (policy.audience.scope_type == "project" and policy.audience.scope_ids != [self.project_id]):
            raise ValueError("Audience must preserve the exact source scope")
        return self

    def registration(self):
        data = self.model_dump(mode="json", by_alias=True, exclude={"source_document_id", "project_id"})
        data["metadata"] = {"source_intake": self.model_dump(mode="json", by_alias=True)}
        return ExternalDocumentUpsertRequest.model_validate(data)


class VersionDraft(Strict):
    lifecycle: DocumentLifecycle
    domain_evidence: dict[str, object]


class SourceFile(Strict):
    file_name: str = Field(min_length=1, max_length=240)
    file_size: int = Field(gt=0, le=52428800, strict=True)
    file_type: str = Field(min_length=1, max_length=160)
    sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class SourcePrepare(Strict):
    document: SourceDocument
    file: SourceFile
    source_revision: str = Field(min_length=1, max_length=128)
    version_label: str = Field(min_length=1, max_length=80)
    version_profile: VersionDraft
    actor_subject_id: str = Field(min_length=1, max_length=128)
    correlation_id: str = Field(min_length=1, max_length=128)


class SourcePrepared(Strict):
    external_document: ExternalDocumentResponse
    document_profile: DocumentVersionProfileInput
    expected_current_ingestion_job_id: str | None


class SourceAuthorization(Strict):
    external_document_id: str = Field(min_length=1, max_length=64)
    document_profile: DocumentVersionProfileInput
    file: SourceFile
    source_revision: str = Field(min_length=1, max_length=128)
    version_label: str = Field(min_length=1, max_length=80)
    actor_subject_id: str = Field(min_length=1, max_length=128)
    registered_by_subject_id: str = Field(min_length=1, max_length=128)
    correlation_id: str = Field(min_length=1, max_length=128)
    policy_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class SourceAuthorized(Strict):
    allowed: Literal[True] = True
    document_id: str
    external_document_id: str
    actor_subject_id: str
    registered_by_subject_id: str
    policy_hash: str


class SourceConfirm(SourceAuthorization):
    expected_current_document_version_id: str | None = Field(max_length=64)
    source_file_uri: str = Field(min_length=1, max_length=1024)
    upload_receipt: str = Field(min_length=1, max_length=32768)


class SourceConfirmed(Strict):
    version: DocumentVersionResponse
    external_document_id: str


def authenticate(request, service, source_system, actor_subject_id, correlation_id):
    if (not service.service_identity or service.service_client_id != SOURCE_CLIENTS[source_system]
        or "service_ingestion" not in service.roles):
        raise problem(403, "source_intake_service_denied", "The exact source service is required")
    if correlation_id != get_correlation_id():
        raise problem(409, "source_intake_correlation_conflict", "Correlation id must match the transport")
    bearer = request.headers.get("X-STRATOS-Actor-Authorization", "")
    if not bearer.startswith("Bearer ") or not bearer[7:].strip() or bearer == request.headers.get("Authorization"):
        raise problem(401, "source_intake_actor_required", "Separate fresh actor and service bearers are required")
    actor_request = Request({"type": "http", "method": "POST", "path": request.url.path,
        "headers": [(b"authorization", bearer.encode("latin-1"))]})
    actor = get_authenticated_principal(actor_request, get_settings())
    if actor.service_identity or actor.subject_id != actor_subject_id:
        raise problem(403, "source_intake_actor_mismatch", "Authenticated person differs from the source actor")
    return actor, bearer


def require_source_authority(document, *, file, source_revision, version_profile, actor, bearer, service, stage):
    """No cached or self-reported policy decision can authorize an upload."""
    settings = get_settings()
    if not settings.stratos_source_intake_authority_url or not settings.stratos_policy_service_token:
        raise problem(503, "source_intake_authority_unavailable", "Fresh STRATOS source authority is not configured")
    nonce = uuid4().hex
    context = {"schema_version": "stratos-source-intake-authorization-1", "nonce": nonce,
        "stage": stage, "document": document.model_dump(mode="json", by_alias=True), "file": file.model_dump(mode="json"),
        "source_revision": source_revision, "version_profile": version_profile.model_dump(mode="json", by_alias=True),
        "actor_subject_id": actor.subject_id, "source_client_id": service.service_client_id,
        "source_service_subject_id": service.subject_id, "correlation_id": get_correlation_id()}
    request_hash = "sha256:" + sha256(json.dumps(context, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    try:
        result = governance_client(settings)._request("POST", settings.stratos_source_intake_authority_url,
            settings.stratos_policy_service_token, {**context, "request_hash": request_hash},
            extra_headers={"X-STRATOS-Actor-Authorization": bearer, "X-Correlation-ID": get_correlation_id()})
        expires = datetime.fromisoformat(str(result.get("expires_at", "")).replace("Z", "+00:00"))
        remaining = (expires - datetime.now(timezone.utc)).total_seconds()
        if (result.get("schema_version") != "stratos-source-intake-authorization-1"
            or result.get("allowed") is not True or result.get("nonce") != nonce
            or result.get("request_hash") != request_hash or not 0 < remaining <= 60):
            raise ValueError("Conflicting or stale source decision")
    except GovernanceDenied as exc:
        raise problem(403, "source_intake_denied", "STRATOS denied the current source operation") from exc
    except (GovernanceUnavailable, ValueError, TypeError) as exc:
        raise problem(503, "source_intake_authority_unavailable", "An exact fresh STRATOS source decision is required") from exc


@router.post("/prepare", response_model=SourcePrepared, responses={403: {}, 409: {}, 503: {}})
def prepare(payload: SourcePrepare, request: Request, db: Session = Depends(get_db), service: Principal = Depends(get_current_principal)):
    actor, bearer = authenticate(request, service, payload.document.external_system, payload.actor_subject_id, payload.correlation_id)
    api.require_document_admission_policy(payload.document.information_policy)
    # Validate profile-specific lifecycle/evidence before root registration.
    from app.document_profile_inputs import build_root_snapshot
    from app.document_profile_catalog import validate_profile_version
    try:
        root = build_root_snapshot(payload.document.document_profile, document_id="doc_source_validation",
            metadata_revision="document-v1", document_type=payload.document.document_type.value)
        validate_profile_version(root, payload.version_profile)
    except ValueError as exc:
        raise problem(422, "source_intake_profile_invalid", "Lifecycle or evidence conflicts with the selected document profile") from exc
    require_source_authority(payload.document, file=payload.file, source_revision=payload.source_revision,
        version_profile=payload.version_profile, actor=actor, bearer=bearer, service=service, stage="prepare")
    natural = f"{payload.document.tenant_id}:{payload.document.external_system}:{payload.document.external_ref}"
    api._lock_budget_upload_identity(db, "source:" + natural)
    external = api._upsert_external_document(payload.document.registration(), db, actor,
        source_document_id="doc_source_" + sha256(natural.encode()).hexdigest()[:32])
    stored = api._get_external_document_ref(db, external.external_document.external_document_id)
    if SourceDocument.model_validate(stored.ref_metadata["source_intake"]) != payload.document:
        raise problem(409, "source_intake_replay_conflict", "Source registration cannot replace its original coordinates or profile")
    document = stored.document
    require_document_action(actor, Action.document_version_create, document, db)
    profile = require_current_root(document)
    attempt = api.get_document_external_references_current(document.document_id, db, actor).ingestion_attempt
    return SourcePrepared(external_document=external, document_profile=DocumentVersionProfileInput(
        expected_root_metadata_revision=profile.metadata_revision, **payload.version_profile.model_dump()),
        expected_current_ingestion_job_id=attempt.ingestion_job_id if attempt else None)


def authorize(payload, document_id, request, db, service, stage):
    external = api._get_external_document_ref(db, payload.external_document_id)
    if external.document_id != document_id or external.external_system not in SOURCE_SYSTEMS:
        raise problem(409, "source_intake_lineage_conflict", "The exact source document is required")
    try:
        source = SourceDocument.model_validate(external.ref_metadata["source_intake"])
    except (KeyError, TypeError, ValueError) as exc:
        raise problem(409, "source_intake_lineage_conflict", "An admitted source registration is required") from exc
    actor, bearer = authenticate(request, service, source.external_system, payload.actor_subject_id, payload.correlation_id)
    if service.subject_id != payload.registered_by_subject_id:
        raise problem(403, "source_intake_service_mismatch", "The source service changed after preparation")
    document = external.document
    root = require_current_root(document)
    if (document.policy_hash != payload.policy_hash or canonical_policy_hash(source.information_policy) != payload.policy_hash
        or payload.document_profile.expected_root_metadata_revision != root.metadata_revision
        or root.provenance != api.build_root_snapshot(source.document_profile, document_id=document_id,
            metadata_revision=root.metadata_revision, document_type=source.document_type.value).provenance):
        raise problem(409, "source_intake_lineage_conflict", "The policy or admitted root changed after preparation")
    require_document_action(actor, Action.document_version_create, document, db)
    require_fresh_document_profile(document, actor_id=actor.subject_id)
    require_source_authority(source, file=payload.file, source_revision=payload.source_revision,
        version_profile=payload.document_profile, actor=actor, bearer=bearer, service=service, stage=stage)
    return actor, external


@router.post("/documents/{document_id}/authorize", response_model=SourceAuthorized, responses={403: {}, 409: {}, 503: {}})
def authorize_upload(document_id: str, payload: SourceAuthorization, request: Request, db: Session = Depends(get_db), service: Principal = Depends(get_current_principal)):
    actor, external = authorize(payload, document_id, request, db, service, "upload")
    return SourceAuthorized(document_id=document_id, external_document_id=external.external_document_id,
        actor_subject_id=actor.subject_id, registered_by_subject_id=service.subject_id, policy_hash=payload.policy_hash)


@router.post("/documents/{document_id}/confirm", response_model=SourceConfirmed, responses={403: {}, 409: {}, 503: {}})
def confirm(document_id: str, payload: SourceConfirm, request: Request, response: Response, db: Session = Depends(get_db), service: Principal = Depends(get_current_principal)):
    actor, external = authorize(payload, document_id, request, db, service, "confirm")
    from app.schemas import SourceLocation
    version = api._create_document_version(document_id, DocumentVersionCreate(
        document_profile=payload.document_profile, version_label=payload.version_label,
        valid_from=payload.document_profile.lifecycle.effective_from, valid_to=payload.document_profile.lifecycle.effective_to,
        source_file_uri=payload.source_file_uri, file_hash=payload.file.sha256,
        change_summary="STRATOS source document intake",
        source_location=SourceLocation(kind="object_storage", uri=payload.source_file_uri, version=payload.source_revision,
            repository=external.external_system, path=external.external_ref, file_name=payload.file.file_name,
            content_type=payload.file.file_type, sha256=payload.file.sha256),
        file=DocumentFileCreate(filename=payload.file.file_name, mime_type=payload.file.file_type,
            size_bytes=payload.file.file_size, sha256=payload.file.sha256, uploaded_by=actor.subject_id,
            intake_receipt=payload.upload_receipt)), response, db, actor,
        source_intake_identity=sha256(f"stratos-source-revision-1:{document_id}:{payload.source_revision}".encode()).hexdigest())
    api._lock_publication_source(db, document_id=document_id)
    external = db.scalar(select(ExternalDocumentRef).where(
        ExternalDocumentRef.external_document_id == external.external_document_id).with_for_update().execution_options(populate_existing=True))
    if external.current_document_version_id != version.document_version_id:
        attempt = db.get(api.IngestionAttempt, document_id)
        if attempt is not None and attempt.ingestion_status == "INGESTING":
            raise problem(409, "source_intake_lease_active", "The previous ingestion attempt is still running")
        if external.current_document_version_id != payload.expected_current_document_version_id:
            raise problem(409, "source_intake_predecessor_conflict", "Another source version is already selected")
        external.current_document_version_id = version.document_version_id
        external.current_file_id = version.file_id
        external.akb_source_uri = version.source_file_uri
        # The ingestion service owns the attempt/job state and performs its own CAS.
        api._audit_external_document_current(db, external, actor.subject_id, source="stratos-source-intake")
        api._commit_or_conflict(db)
    return SourceConfirmed(version=version, external_document_id=external.external_document_id)


class SourceStatusRequest(Strict):
    actor_subject_id: str = Field(min_length=1, max_length=128)
    correlation_id: str = Field(min_length=1, max_length=128)


class SourceStatusResponse(Strict):
    document_id: str
    external_document_id: str
    document_version_id: str | None
    ingestion_job_id: str | None
    ingestion_status: str
    document_status: str
    document_version_status: str | None


@router.post("/documents/{document_id}/status", response_model=SourceStatusResponse, responses={403: {}, 409: {}, 503: {}})
def source_status(document_id: str, payload: SourceStatusRequest, request: Request, db: Session = Depends(get_db), service: Principal = Depends(get_current_principal)):
    if not service.service_identity or service.service_client_id not in SOURCE_CLIENTS.values():
        raise problem(403, "source_intake_service_denied", "An exact source service is required")
    external = db.scalar(select(ExternalDocumentRef).where(ExternalDocumentRef.document_id == document_id,
        ExternalDocumentRef.external_system.in_(SOURCE_SYSTEMS)))
    if external is None:
        raise problem(404, "source_intake_not_found", "The source document does not exist")
    actor, _ = authenticate(request, service, external.external_system, payload.actor_subject_id, payload.correlation_id)
    require_document_action(actor, Action.document_read, external.document, db)
    version = api._get_version(db, document_id, external.current_document_version_id) if external.current_document_version_id else None
    if version is not None:
        api.require_document_version_action(actor, Action.document_read, external.document, version, db)
    require_fresh_document_profile(external.document, version=version, actor_id=actor.subject_id)
    attempt = db.get(api.IngestionAttempt, document_id)
    selected = attempt is not None and attempt.document_version_id == external.current_document_version_id
    return SourceStatusResponse(document_id=document_id, external_document_id=external.external_document_id,
        document_version_id=external.current_document_version_id, ingestion_job_id=attempt.ingestion_job_id if selected else None,
        ingestion_status=attempt.ingestion_status if selected else "VERSION_CREATED" if version else "REGISTERED",
        document_status=external.document.status, document_version_status=version.status if version else None)
