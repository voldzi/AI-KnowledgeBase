"""Fresh central contract readiness for an empty environment, without creating data."""
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

from pydantic import AwareDatetime, Field

from app.document_profile import (
    ContractModel, DocumentProfileReference, Reference, Sha256, document_snapshot_hash,
)
from app.document_profile_catalog import document_profile_catalog


class AdmissionReadinessRequest(ContractModel):
    schema_version: Literal["stratos-document-admission-readiness-request-1"] = Field(alias="schemaVersion")
    application: Literal["AKB"]
    request_nonce: Reference = Field(alias="requestNonce")
    correlation_id: Reference = Field(alias="correlationId")
    catalog_revision: Reference = Field(alias="catalogRevision")
    catalog_hash: Sha256 = Field(alias="catalogHash")
    profiles: tuple[DocumentProfileReference, ...] = Field(min_length=1, max_length=100)
    required_capabilities: tuple[Literal["atomicRegister", "freshRevalidate"], ...] = Field(alias="requiredCapabilities")


class AdmissionReadinessConfirmation(ContractModel):
    schema_version: Literal["stratos-document-admission-readiness-confirmation-1"] = Field(alias="schemaVersion")
    application: Literal["AKB"]
    decision: Literal["ALLOW"]
    confirmed_by_subject_id: Literal["service:akb"] = Field(alias="confirmedBySubjectId")
    service_active: Literal[True] = Field(alias="serviceActive")
    request_nonce: Reference = Field(alias="requestNonce")
    correlation_id: Reference = Field(alias="correlationId")
    catalog_revision: Reference = Field(alias="catalogRevision")
    catalog_hash: Sha256 = Field(alias="catalogHash")
    approved_profiles: tuple[DocumentProfileReference, ...] = Field(alias="approvedProfiles", min_length=1, max_length=100)
    capabilities: tuple[Literal["atomicRegister", "freshRevalidate"], ...]
    checked_at: AwareDatetime = Field(alias="checkedAt")
    expires_at: AwareDatetime = Field(alias="expiresAt")


class DocumentIntakeReadinessResponse(ContractModel):
    status: Literal["ready"]
    service: Literal["registry-api"]
    document_profile_admission: Literal["ready"]
    catalog_revision: Reference
    catalog_hash: Sha256


def prepare_admission_readiness(correlation_id: str) -> AdmissionReadinessRequest:
    catalog = document_profile_catalog()
    return AdmissionReadinessRequest(
        schemaVersion="stratos-document-admission-readiness-request-1", application="AKB",
        requestNonce=uuid4().hex, correlationId=correlation_id,
        catalogRevision=catalog["catalogRevision"], catalogHash=document_snapshot_hash(catalog),
        profiles=[{"id": item["id"], "revision": item["revision"]} for item in catalog["profiles"]],
        requiredCapabilities=["atomicRegister", "freshRevalidate"],
    )


def verify_admission_readiness(raw: dict, request: AdmissionReadinessRequest, *, now=None) -> AdmissionReadinessConfirmation:
    # JSON booleans and timestamp strings are required on the wire, without
    # Pydantic's numeric timestamp / bool coercion. No cache grants readiness.
    if raw.get("serviceActive") is not True or any(not isinstance(raw.get(field), str) for field in ("checkedAt", "expiresAt")):
        raise ValueError("Readiness requires an active exact service and timestamp strings")
    proof = AdmissionReadinessConfirmation.model_validate(raw)
    if any(getattr(proof, key) != getattr(request, key) for key in (
        "application", "request_nonce", "correlation_id", "catalog_revision", "catalog_hash",
    )) or proof.approved_profiles != request.profiles or proof.capabilities != request.required_capabilities:
        raise ValueError("Readiness does not confirm the exact catalog, profiles and capabilities")
    now = now or datetime.now(timezone.utc)
    if (proof.checked_at < now - timedelta(seconds=30) or proof.checked_at > now + timedelta(seconds=5)
        or proof.expires_at <= now or proof.expires_at <= proof.checked_at
        or proof.expires_at > proof.checked_at + timedelta(seconds=60)):
        raise ValueError("Readiness confirmation is expired or outside its freshness window")
    return proof
