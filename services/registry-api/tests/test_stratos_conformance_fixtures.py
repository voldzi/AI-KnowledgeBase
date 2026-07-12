from __future__ import annotations

import json
from pathlib import Path

from app.information_policy import InformationPolicyBinding, canonical_policy_hash
from app.models import Document
from app.permissions import SubjectContext, evaluate_document_access
from app.schemas import Action


FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "contracts/stratos/conformance/v1/decision-fixtures.json"
)


def test_central_decision_fixtures_match_registry_enforcement() -> None:
    fixture = json.loads(FIXTURES.read_text(encoding="utf-8"))
    assert fixture["fixtureVersion"] == "conformance-1.0.0"

    for case in fixture["cases"]:
        actual = evaluate_fixture(case["request"])
        expected = case["expected"]
        assert actual["decision"] == expected["decision"], case["id"]
        assert actual["reasonCodes"] == expected["reasonCodes"], case["id"]
        if "obligations" in expected:
            assert actual["obligations"] == expected["obligations"], case["id"]


def evaluate_fixture(request: dict) -> dict:
    raw_policy = request.get("policyBinding")
    if raw_policy and raw_policy.get("legalClassification") != "NONE":
        return {
            "decision": "DENY",
            "reasonCodes": ["LEGAL_CLASSIFICATION_UNSUPPORTED"],
            "obligations": [],
        }

    binding = complete_binding(raw_policy) if raw_policy else None
    document = Document(
        document_id="doc_conformance",
        title="Conformance fixture",
        document_type="other",
        status="valid",
        classification="internal",
        organization_id="org_stratos",
        policy_binding_id=binding.policy_binding_id if binding else None,
        policy_version=binding.policy_version if binding else None,
        policy_hash=canonical_policy_hash(binding) if binding else None,
        policy_summary=binding.model_dump(mode="json", by_alias=True) if binding else {},
        owner_id="user_owner",
        gestor_unit=None,
        tags=[],
        document_metadata={},
    )
    context = SubjectContext(
        subject_id="user_reader",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:read_document"} if request.get("capability") else set(),
        scopes={"organization"} if request.get("scopeMatches") else {"project:other"},
        organization_id="org_stratos",
        identity_active=bool(request.get("identityActive")),
        membership_active=bool(request.get("membershipActive")),
        application_access_active=bool(request.get("applicationAccess")),
        access_v2=True,
    )
    decision = evaluate_document_access(context, Action.document_read.value, document)
    return {
        "decision": "ALLOW" if decision.allowed else "DENY",
        "reasonCodes": list(decision.reason_codes),
        "obligations": list(decision.constraints.get("obligations", [])),
    }


def complete_binding(value: dict) -> InformationPolicyBinding:
    return InformationPolicyBinding.model_validate(
        {
            "schemaVersion": "stratos-information-policy-2",
            "policyBindingId": "pol_conformance01",
            "policyVersion": value["policyVersion"],
            "handlingClass": value["handlingClass"],
            "legalClassification": value["legalClassification"],
            "tlp": None,
            "pap": None,
            "contentCategories": ["CONTRACTUAL"],
            "audience": {
                "organizationId": "org_stratos",
                "scopeType": "organization",
                "scopeIds": [],
                "recipientSubjectIds": [],
            },
            "obligations": value["obligations"],
            "originatorId": "user_owner",
            "issuedAt": "2026-07-12T10:00:00Z",
            "reviewAt": None,
        }
    )
