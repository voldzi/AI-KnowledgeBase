"""Bounded, service-only authoritative cleanup decisions; never deletes storage."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import Principal, get_current_principal
from app.config import Settings, get_settings
from app.database import get_db
from app.errors import problem
from app.intake_cleanup_storage import lock_uris, reference_counts_for_uris, verify_fence_installation
from app.intake_manifest import manifest_digest, signing_keys, verify_manifest

router = APIRouter(prefix="/api/v1/admin/intake-cleanup", tags=["Intake cleanup"])
CLEANUP_ERRORS = {
    400: {"description": "Invalid signed manifest or conflicting exact candidate identity"},
    401: {"description": "Missing or invalid verified service identity"},
    403: {"description": "Caller is not the configured cleanup service with its explicit route grant"},
    409: {"description": "A different immutable manifest has already claimed the object"},
    503: {"description": "Configuration, signature verifier, transaction fence or complete reference query unavailable; retain objects"},
}


class CleanupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    manifests: list[Annotated[str, StringConstraints(strict=True, max_length=16384)]] = Field(min_length=1, max_length=100)


class CleanupReferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_versions: int = Field(ge=0)
    document_files: int = Field(ge=0)
    document_publications: int = Field(ge=0)
    external_document_refs: int = Field(ge=0)
    document_profile_version_snapshots: int = Field(ge=0)


class CleanupDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    manifest_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_file_uri: str
    references: CleanupReferences
    claim_id: str | None
    status: Literal["referenced", "not_expired", "eligible", "claimed"]


class CleanupResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    complete: Literal[True]
    reference_scope: Literal["all_registry_content_references"]
    results: list[CleanupDecision]


def require_cleanup_service(principal: Principal = Depends(get_current_principal), settings: Settings = Depends(get_settings)):
    if not settings.intake_cleanup_service_client_id:
        raise problem(503, "intake_cleanup_unavailable", "The dedicated intake cleanup service is not configured")
    if (not principal.service_identity
        or principal.service_client_id != settings.intake_cleanup_service_client_id
        or principal.service_client_id not in settings.trusted_service_clients
        or settings.service_route_grants.get(principal.service_client_id, frozenset()) != frozenset({"intake-cleanup"})):
        raise problem(403, "intake_cleanup_forbidden", "A verified, explicitly granted cleanup service identity is required")
    return principal


def cleanup_decisions(db, tokens, *, settings, subject_id, claim=False, now=None):
    now = now or datetime.now(timezone.utc)
    try:
        keys = signing_keys(settings.content_security_attestation_secret, settings.intake_manifest_verify_keys)
    except ValueError as exc:
        raise problem(503, "intake_manifest_verifier_unavailable", "Intake manifest verification keys are unavailable") from exc
    try:
        manifests = {manifest_digest(token): verify_manifest(token, keys) for token in tokens}
        uris = [item.source_file_uri for item in manifests.values()]
        if len(set(uris)) != len(uris):
            raise ValueError("Conflicting manifests for the same object")
    except (ValueError, TypeError) as exc:
        raise problem(400, "intake_manifest_invalid", "An intake manifest is invalid or conflicts with another candidate") from exc
    aliases = {item.strip() for item in settings.intake_cleanup_legacy_buckets.split(",") if item.strip()}
    if aliases.difference({settings.intake_cleanup_bucket}):
        raise problem(503, "intake_cleanup_bucket_aliases_unavailable", "Cleanup requires a single canonical physical bucket without legacy aliases")
    if any(item.bucket != settings.intake_cleanup_bucket for item in manifests.values()):
        raise problem(400, "intake_cleanup_bucket_mismatch", "The signed manifest is outside the configured canonical bucket")
    verify_fence_installation(db)
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SET LOCAL statement_timeout = '5s'"))
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
    fences = lock_uris(db, uris) if claim else {}
    all_counts = reference_counts_for_uris(db, uris)
    results = []
    for digest, manifest in sorted(manifests.items(), key=lambda item: item[1].source_file_uri):
        counts = all_counts[manifest.source_file_uri]
        result = {"manifest_digest": digest, "source_file_uri": manifest.source_file_uri,
                  "references": counts, "claim_id": None}
        fence = fences.get(manifest.source_file_uri)
        if any(counts.values()):
            if fence is not None and fence.claim_id:
                raise RuntimeError("A cleanup tombstone conflicts with a current Registry reference")
            result["status"] = "referenced"
        elif manifest.expiry + timedelta(seconds=settings.intake_cleanup_grace_seconds) > now:
            result["status"] = "not_expired"
        elif claim:
            if fence.claim_id is not None and fence.manifest_digest != digest:
                raise problem(409, "intake_cleanup_manifest_conflict", "A different immutable manifest already claimed this object")
            if fence.claim_id is None:
                fence.claim_id = "cleanup_" + uuid4().hex
                fence.manifest_digest = digest
                fence.expires_at = manifest.expiry
                fence.claimed_at = now
                fence.claimed_by = subject_id
            result.update(status="claimed", claim_id=fence.claim_id)
        else:
            result["status"] = "eligible"
        results.append(result)
    if claim:
        db.commit()  # The permanent fence is durable before any client may unlink.
    return {"complete": True, "reference_scope": "all_registry_content_references", "results": results}


def _run(payload, response, db, settings, principal, claim):
    response.headers["Cache-Control"] = "no-store"
    try:
        return cleanup_decisions(db, payload.manifests, settings=settings, subject_id=principal.subject_id, claim=claim)
    except (SQLAlchemyError, RuntimeError) as exc:
        db.rollback()
        raise problem(503, "intake_cleanup_reference_check_unavailable", "The complete authoritative reference check is unavailable; retain every object") from exc
    except HTTPException:
        db.rollback()
        raise


@router.post("/dry-run", response_model=CleanupResponse, responses=CLEANUP_ERRORS,
             description="Read-only exact manifest batch check against every Registry content reference, including historical and user-invisible rows. No deletion authority is returned.")
def dry_run(payload: CleanupRequest, response: Response, db: Session = Depends(get_db),
            settings: Settings = Depends(get_settings), principal: Principal = Depends(require_cleanup_service)):
    return _run(payload, response, db, settings, principal, False)


@router.post("/claim", response_model=CleanupResponse, responses=CLEANUP_ERRORS,
             description="Commit a permanent reference fence only for valid signed expiry plus grace and a complete empty reference set. Idempotent exact-manifest replay returns the original claim. Storage removal is a separate conditional operator action.")
def claim(payload: CleanupRequest, response: Response, db: Session = Depends(get_db),
          settings: Settings = Depends(get_settings), principal: Principal = Depends(require_cleanup_service)):
    return _run(payload, response, db, settings, principal, True)
