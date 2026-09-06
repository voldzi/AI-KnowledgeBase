from pathlib import Path

import pytest
import yaml

import app.permissions as permissions
from app.access_governance import GovernanceUnavailable
from app.auth import Principal, get_current_principal
from app.models import Document, DocumentVersion
from document_policy_fixtures import admitted_policy
from document_profile_fixtures import verified_profile_authority, profiled_document_request, profiled_version_request, admit_orm_profile

pytestmark = pytest.mark.usefixtures("verified_profile_authority")


def test_exact_version_authorization_semantics_match_service_openapi(client):
    stored = yaml.safe_load((Path(__file__).parents[1] / "openapi.yaml").read_text())
    runtime = client.app.openapi()
    field = "document_version_id"
    assert stored["components"]["schemas"]["AuthzResource"]["properties"][field] == runtime["components"]["schemas"]["AuthzResource"]["properties"][field]
    path = "/api/v1/authz/check"
    assert stored["paths"][path] == runtime["paths"][path]
    assert "503" in stored["paths"][path]["post"]["responses"]


@pytest.mark.parametrize("outcome", ["allowed", "denied", "unavailable", "no_export", "missing_version", "mismatched_document"])
def test_export_requires_current_exact_version_authority(client, db_session, monkeypatch, outcome):
    created = client.post("/api/v1/documents", json=profiled_document_request({
        "title": "Source", "document_type": "manual", "owner_id": "user_dev",
        "information_policy": admitted_policy(owner="user_dev"),
    }))
    assert created.status_code == 201, created.text
    document_id = created.json()["document_id"]
    created_version = client.post(f"/api/v1/documents/{document_id}/versions", json=profiled_version_request(created.json(), {
        "version_label": "1.0", "source_file_uri": "s3://akl-documents/export/source.pdf",
        "file_hash": f"sha256:{'a' * 64}",
    }))
    assert created_version.status_code == 201, created_version.text
    version_id = created_version.json()["document_version_id"]
    document = db_session.get(Document, document_id)
    version = db_session.get(DocumentVersion, version_id)
    if outcome == "mismatched_document":
        other = client.post("/api/v1/documents", json=profiled_document_request({
            "title": "Other", "document_type": "manual", "owner_id": "user_dev",
            "information_policy": admitted_policy(owner="user_dev"),
        }))
        assert other.status_code == 201
        version.document_id = other.json()["document_id"]
    db_session.commit()
    settings = permissions.get_settings().model_copy(update={"auth_mode": "oidc"})
    monkeypatch.setattr(permissions, "get_settings", lambda: settings)
    principal = Principal(subject_id="user_dev", roles={"stratos_user"}, groups=set(),
                          capabilities={"akb:export"}, scopes={"organization"},
                          dynamic_access_loaded=True, bearer_token="test-export-person")
    client.app.dependency_overrides[get_current_principal] = lambda: principal

    class CurrentPdp:
        calls = 0

        def decide(self, **kwargs):
            self.calls += 1
            assert kwargs["credential_token"] == principal.bearer_token
            if self.calls == 2 and outcome == "unavailable":
                raise GovernanceUnavailable("Exact-version PDP unavailable")
            return {"decision": "DENY" if self.calls == 2 and outcome == "denied" else "ALLOW",
                    "reasonCodes": [], "obligations": ["NO_EXPORT"] if self.calls == 2 and outcome == "no_export" else []}

    pdp = CurrentPdp()
    monkeypatch.setattr(permissions, "governance_client", lambda _settings: pdp)
    response = client.post("/api/v1/authz/check", json={
        "subject_id": principal.subject_id, "action": "rag.export",
        "resource": {"document_id": document_id, "document_version_id": "ver_missing" if outcome == "missing_version" else version_id},
    })
    assert response.status_code == (503 if outcome == "unavailable" else 200), response.text
    if outcome == "unavailable":
        assert pdp.calls == 2
        return
    assert response.json()["allowed"] is (outcome in {"allowed", "no_export"})
    assert pdp.calls == (1 if outcome in {"missing_version", "mismatched_document"} else 2)
    if response.json()["allowed"]:
        constraints = response.json()["constraints"]
        assert constraints["document_id"] == document_id
        assert constraints["document_version_id"] == version_id
        assert constraints["policy_hash"] == version.policy_hash
        assert ("NO_EXPORT" in constraints["obligations"]) is (outcome == "no_export")
