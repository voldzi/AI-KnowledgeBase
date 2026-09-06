"""Explicit admitted document policies for tests; never injected into requests."""


def admitted_policy(*, handling_class="INTERNAL", tlp="TLP:CLEAR", owner="user_owner"):
    return {
        "schemaVersion": "stratos-information-policy-2",
        "policyBindingId": "pol_test_admission01",
        "policyVersion": "information-policy-2.0.0",
        "handlingClass": handling_class,
        "legalClassification": "NONE",
        "tlp": tlp,
        "pap": None,
        "contentCategories": [],
        "audience": {
            "organizationId": "org_stratos",
            "scopeType": "recipient_set" if tlp == "TLP:RED" else "organization",
            "scopeIds": [],
            "recipientSubjectIds": [owner] if tlp == "TLP:RED" else [],
        },
        "obligations": ["AUDIT_ACCESS"],
        "originatorId": owner,
        "issuedAt": "2026-01-01T00:00:00Z",
        "reviewAt": None,
    }
