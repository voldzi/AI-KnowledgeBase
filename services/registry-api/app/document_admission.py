"""AKB document admission requirements above the shared defensive Policy V2.

This module never grants access, invents a TLP, or changes the central policy
hash. The shared binding stays able to parse legacy/incomplete data so callers
can reject and repair it explicitly.
"""

from collections.abc import Mapping
from typing import Any

from app.errors import problem
from app.information_policy import InformationPolicyBinding, TlpLabel


DocumentPolicy = InformationPolicyBinding | Mapping[str, Any] | None
EXPLICIT_DOCUMENT_TLP_VALUES = frozenset(label.value for label in TlpLabel)


def _effective_tlp(policy: DocumentPolicy) -> object:
    if isinstance(policy, InformationPolicyBinding):
        return policy.tlp
    if isinstance(policy, Mapping):
        return policy.get("tlp")
    return None


def has_explicit_document_tlp(policy: DocumentPolicy) -> bool:
    tlp = _effective_tlp(policy)
    return isinstance(tlp, str) and tlp in EXPLICIT_DOCUMENT_TLP_VALUES


def require_document_admission_policy(
    policy: DocumentPolicy, *, status_code: int = 422,
) -> None:
    """Require one effective TLP for every document channel and actor kind."""
    tlp = _effective_tlp(policy)
    if tlp is None:
        raise problem(
            status_code,
            "document_tlp_required",
            "An explicit effective TLP is required for every AKB document and version",
            {"reason_codes": ["DOCUMENT_TLP_REQUIRED"]},
        )
    if not has_explicit_document_tlp(policy):
        raise problem(
            status_code,
            "document_tlp_invalid",
            "The document policy must use one of the five supported explicit TLP values",
            {"reason_codes": ["DOCUMENT_TLP_INVALID"]},
        )


# The Registry uses its trace_id error envelope for validation and stored-policy
# conflicts. Publish the actual envelope at admission boundaries as well.
_DOCUMENT_ADMISSION_ERROR_SCHEMA = {
    "type": "object", "required": ["error"], "properties": {"error": {
        "type": "object", "required": ["code", "message", "details", "trace_id"],
        "properties": {
            "code": {"type": "string"}, "message": {"type": "string"},
            "details": {"type": "object", "additionalProperties": True},
            "trace_id": {"type": "string"},
        },
    }},
}
DOCUMENT_ADMISSION_RESPONSES = {
    503: {
        "description": "Central document admission is unavailable, denied, unsupported, stale or inconsistent (document_profile_admission_unavailable or governance_unavailable). No stored proof or mock grant substitutes for a fresh decision.",
        "content": {"application/json": {"schema": _DOCUMENT_ADMISSION_ERROR_SCHEMA}},
    },
    422: {
        "description": "Invalid or missing required policy/profile (validation_error), document_tlp_required/document_tlp_invalid, document_profile_invalid, document_profile_assignment_mismatch, document_profile_lifecycle_mismatch or document_profile_source_invalid. No document/version is admitted.",
        "content": {"application/json": {"schema": _DOCUMENT_ADMISSION_ERROR_SCHEMA}},
    },
    409: {
        "description": "Conflicting policy/profile/lineage or state: document_tlp_required/document_tlp_invalid, document_profile_required/document_profile_conflict, document_profile_independent_approval_required, or native_intake_replay_conflict. Stale root revisions, incomplete snapshots and unbound approval cannot activate or replace a version.",
        "content": {"application/json": {"schema": _DOCUMENT_ADMISSION_ERROR_SCHEMA}},
    },
}
