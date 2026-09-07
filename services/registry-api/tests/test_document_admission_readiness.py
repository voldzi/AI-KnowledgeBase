from datetime import datetime, timedelta, timezone
import json

import httpx
import pytest

from app import api
from app.access_governance import StratosGovernanceClient
from app.document_admission_readiness import prepare_admission_readiness, verify_admission_readiness
from app.models import Document, DocumentVersion
from test_ingestion_authorization import _ingestion_service_headers


def test_shipped_readiness_contract_matches_runtime_models():
    from pathlib import Path
    from pydantic import TypeAdapter
    from app.document_admission_readiness import AdmissionReadinessRequest, AdmissionReadinessConfirmation
    path = Path(__file__).resolve().parents[3] / "contracts/stratos/document-admission/v1/readiness.schema.json"
    shipped = json.loads(path.read_text())
    shipped.pop("$schema")
    shipped.pop("$id")
    assert shipped == TypeAdapter(AdmissionReadinessRequest | AdmissionReadinessConfirmation).json_schema(by_alias=True)


def confirmation(request, *, now=None):
    now = now or datetime.now(timezone.utc)
    return {
        "schemaVersion": "stratos-document-admission-readiness-confirmation-1",
        "application": "AKB", "decision": "ALLOW", "confirmedBySubjectId": "service:akb", "serviceActive": True,
        "requestNonce": request["requestNonce"], "correlationId": request["correlationId"],
        "catalogRevision": request["catalogRevision"], "catalogHash": request["catalogHash"],
        "approvedProfiles": request["profiles"], "capabilities": request["requiredCapabilities"],
        "checkedAt": now.isoformat(), "expiresAt": (now + timedelta(seconds=30)).isoformat(),
    }


@pytest.mark.parametrize("mutation", [
    lambda value: value.update(decision="DENY"),
    lambda value: value.update(confirmedBySubjectId="service:other"),
    lambda value: value.update(serviceActive=False),
    lambda value: value.update(serviceActive=1),
    lambda value: value.update(requestNonce="old-request"),
    lambda value: value.update(correlationId="other-request"),
    lambda value: value.update(catalogHash="sha256:" + "0" * 64),
    lambda value: value.update(catalogRevision="old"),
    lambda value: value["approvedProfiles"].pop(),
    lambda value: value["approvedProfiles"].append(value["approvedProfiles"][0]),
    lambda value: value.update(capabilities=["atomicRegister"]),
    lambda value: value.update(checkedAt=(datetime.now(timezone.utc) - timedelta(seconds=31)).isoformat()),
    lambda value: value.update(checkedAt=(datetime.now(timezone.utc) + timedelta(seconds=6)).isoformat()),
    lambda value: value.update(expiresAt=(datetime.now(timezone.utc) + timedelta(seconds=70)).isoformat()),
    lambda value: value.update(expiresAt=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()),
    lambda value: value.update(checkedAt="2026-09-05T12:00:00"),
    lambda value: value.update(checkedAt=1788609600),
    lambda value: value.update(unreviewedOverride=True),
])
def test_readiness_rejects_incomplete_stale_or_conflicting_proof(mutation):
    request = prepare_admission_readiness("test-readiness")
    raw = confirmation(request.model_dump(mode="json", by_alias=True))
    mutation(raw)
    with pytest.raises(ValueError):
        verify_admission_readiness(raw, request)


def test_readiness_success_is_fresh_and_does_not_create_documents(client, db_session, monkeypatch):
    settings = api.get_settings().model_copy(update={
        "stratos_information_resources_url": "https://authority.invalid/api/v1/information/resources",
        "stratos_policy_service_token": "explicit-readiness-test-credential",
    })
    requests = []

    def transport(request):
        assert request.method == "POST"
        assert str(request.url) == "https://authority.invalid/api/v1/information/resources/akb/document-admission/readiness"
        assert request.headers["authorization"] == "Bearer explicit-readiness-test-credential"
        body = json.loads(request.content)
        assert request.headers["x-correlation-id"] == body["correlationId"]
        requests.append(body)
        return httpx.Response(200, json=confirmation(body))

    authority = StratosGovernanceClient(settings)
    authority._http_client.close()
    authority._http_client = httpx.Client(transport=httpx.MockTransport(transport))
    monkeypatch.setattr(api, "governance_client", lambda _settings: authority)
    try:
        for _ in range(2):
            response = client.get("/api/v1/integrations/ingestion/readiness", headers=_ingestion_service_headers("test-readiness"))
            assert response.status_code == 200, response.text
            assert response.json()["document_profile_admission"] == "ready"
            assert response.json()["catalog_hash"] == requests[-1]["catalogHash"]
        assert requests[0]["requestNonce"] != requests[1]["requestNonce"]
        assert db_session.query(Document).count() == db_session.query(DocumentVersion).count() == 0
    finally:
        authority.close()


@pytest.mark.parametrize("upstream_status", [401, 403, 404, 503])
def test_readiness_upstream_failure_remains_unavailable_without_fallback(client, monkeypatch, upstream_status):
    settings = api.get_settings().model_copy(update={
        "stratos_information_resources_url": "https://authority.invalid/resources",
        "stratos_policy_service_token": "explicit-readiness-test-credential",
    })
    requests = []
    def transport(request):
        requests.append(request)
        return httpx.Response(upstream_status, json={"error": "unavailable"})
    authority = StratosGovernanceClient(settings)
    authority._http_client.close()
    authority._http_client = httpx.Client(transport=httpx.MockTransport(transport))
    monkeypatch.setattr(api, "governance_client", lambda _settings: authority)
    try:
        response = client.get("/api/v1/integrations/ingestion/readiness", headers=_ingestion_service_headers("test-readiness"))
        assert response.status_code == 503, response.text
        assert response.json()["error"]["code"] == "document_profile_admission_unavailable"
        assert len(requests) == 1 and requests[0].method == "POST"
        assert client.get("/ready").status_code == 200
    finally:
        authority.close()
