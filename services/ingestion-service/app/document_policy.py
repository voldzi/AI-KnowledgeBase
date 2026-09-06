"""Validate the authoritative document policy before reading or indexing content."""

from __future__ import annotations

import hashlib
import json

from app.errors import IngestionError
from app.schemas import DocumentChunk, DocumentMetadata

TLP_VALUES = frozenset({"TLP:RED", "TLP:AMBER+STRICT", "TLP:AMBER", "TLP:GREEN", "TLP:CLEAR"})
POLICY_VERSION = "information-policy-2.0.0"
CANONICAL_POLICY_FIELDS = (
    "policyBindingId", "policyVersion", "handlingClass", "legalClassification",
    "tlp", "pap", "obligations", "contentCategories", "audience",
)


def document_policy_hash(summary: dict) -> str:
    # This is the existing STRATOS V2 hash, not an AKB metadata/profile hash.
    canonical = {field: summary.get(field) for field in CANONICAL_POLICY_FIELDS}
    encoded = json.dumps(canonical, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return f"sha256:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()}"


def require_document_policy(metadata: DocumentMetadata | DocumentChunk) -> None:
    summary = metadata.policy_summary
    tlp = summary.get("tlp")
    if not isinstance(tlp, str) or tlp not in TLP_VALUES:
        raise IngestionError(
            "DOCUMENT_TLP_REQUIRED", "The immutable Registry version requires explicit valid TLP",
            status_code=409,
        )
    audience = summary.get("audience")
    if (
        not metadata.policy_binding_id
        or metadata.policy_version != POLICY_VERSION
        or summary.get("policyBindingId") != metadata.policy_binding_id
        or summary.get("policyVersion") != metadata.policy_version
        or summary.get("handlingClass") not in {"PUBLIC", "INTERNAL", "PROJECT_MANAGEMENT", "RESTRICTED"}
        or summary.get("legalClassification") != "NONE"
        or not isinstance(audience, dict)
        or audience.get("organizationId") != metadata.organization_id
        or not isinstance(summary.get("obligations"), list)
        or not isinstance(summary.get("contentCategories"), list)
        or metadata.policy_hash != document_policy_hash(summary)
    ):
        raise IngestionError(
            "DOCUMENT_POLICY_INVALID", "The immutable Registry version has inconsistent policy coordinates",
            status_code=409,
        )
    if tlp == "TLP:RED":
        recipients = audience.get("recipientSubjectIds")
        if (
            audience.get("scopeType") != "recipient_set"
            or not isinstance(recipients, list)
            or not recipients
            or any(not isinstance(value, str) or not value.strip() for value in recipients)
            or not isinstance(summary.get("originatorId"), str)
            or not summary["originatorId"].strip()
        ):
            raise IngestionError(
                "DOCUMENT_POLICY_INVALID", "TLP:RED requires exact recipients and an originator",
                status_code=409,
            )
