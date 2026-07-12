from __future__ import annotations

from typing import Any

from app.errors import GatewayError


KNOWN_OBLIGATIONS = {
    "AUDIT_ACCESS",
    "NO_EXTERNAL_AI",
    "LOCAL_PROCESSING_ONLY",
    "NO_PUBLIC_EXPORT",
    "NO_EXPORT",
    "WATERMARK",
    "ENCRYPT_AT_REST",
    "RECIPIENT_CONFIRMATION",
    "ORIGINATOR_APPROVAL",
    "PAP_ENFORCEMENT",
}


def enforce_provider_policy(*, provider: str, metadata: dict[str, Any]) -> None:
    policy_version = metadata.get("policy_version")
    if policy_version is None:
        if provider == "openai":
            _deny("POLICY_BINDING_REQUIRED", "External AI processing requires an Information Policy V2 binding.")
        return
    if policy_version != "information-policy-2.0.0":
        _deny("POLICY_VERSION_UNKNOWN", "The information policy version is not supported.")
    if metadata.get("legal_classification") != "NONE":
        _deny("LEGAL_CLASSIFICATION_UNSUPPORTED", "Classified content cannot be processed.")
    obligations = metadata.get("obligations")
    if not isinstance(obligations, list) or any(not isinstance(item, str) for item in obligations):
        _deny("POLICY_BINDING_INVALID", "Policy obligations are invalid.")
    unknown = sorted(set(obligations) - KNOWN_OBLIGATIONS)
    if unknown:
        _deny("POLICY_OBLIGATION_UNKNOWN", "The policy contains an unsupported obligation.")
    handling_class = metadata.get("handling_class")
    if handling_class not in {"PUBLIC", "INTERNAL", "RESTRICTED"}:
        _deny("POLICY_BINDING_INVALID", "The handling class is invalid.")
    if provider == "openai":
        if handling_class == "RESTRICTED":
            _deny("EXTERNAL_AI_DENIED", "Restricted content cannot be sent to an external AI provider.")
        if {"NO_EXTERNAL_AI", "LOCAL_PROCESSING_ONLY"}.intersection(obligations):
            _deny("EXTERNAL_AI_DENIED", "Policy obligations prohibit external AI processing.")


def _deny(code: str, message: str) -> None:
    raise GatewayError(code, message, status_code=403)
