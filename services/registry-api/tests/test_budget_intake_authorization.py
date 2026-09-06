from document_profile_fixtures import verified_profile_authority
from dataclasses import replace
import json
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from app import api, permissions
from app.access_governance import GovernanceDenied, GovernanceUnavailable, StratosGovernanceClient
from app.auth import Principal
from app.database import Base
from app.models import Document
from test_stratos_budget_upload_bridge import (
    ACTOR, CONTRACT_ID, FILE_HASH, FINANCIAL_SCOPE, PARENT_RESOURCE,
    _preflight_payload, _service_headers, _version_payload,
)


def _setup(client, *, batch=False, audience=None):
    registration = _preflight_payload()
    if audience:
        registration["information_policy"]["audience"].update(
            scopeType=audience, scopeIds=[], recipientSubjectIds=[ACTOR] if audience == "recipient_set" else [],
        )
        if audience == "recipient_set":
            registration["information_policy"]["tlp"] = "TLP:RED"
        policy = api.InformationPolicyBinding.model_validate(registration["information_policy"])
        registration["integration_envelope"]["policyHash"] = api.canonical_policy_hash(policy)
        registration["integration_envelope"]["classification"]["tlp"] = policy.tlp
    if not batch:
        for key in ("batch_manifest_id", "batch_entries_sha256", "release_revision"):
            registration["metadata"].pop(key)
    response = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=registration, headers=_service_headers(),
    )
    assert response.status_code == 201, response.text
    result = response.json()
    document = result["document"]
    context = {key: registration["metadata"][key] for key in (
        "contract_status", "contract_start_date", "contract_end_date",
    )}
    context["original_file_name"] = "smlouva.pdf"
    if batch:
        context.update({key: registration["metadata"][key] for key in (
            "batch_manifest_id", "batch_entries_sha256", "release_revision",
        )})
    payload = {
        "document_profile": _version_payload(document=document)["document_profile"],
        "upload_session_id": "upl-budget-test",
        "external_document_id": result["external_document"]["external_document_id"],
        "governed_document_resource_id": document["governed_resource_id"],
        "source_governed_resource_id": PARENT_RESOURCE,
        "source_resource_id": CONTRACT_ID,
        "source_version": FILE_HASH,
        "policy_binding_id": document["policy_binding_id"],
        "policy_version": document["policy_version"],
        "policy_hash": document["policy_hash"],
        "governance_scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
        "actor_subject_id": ACTOR,
        "registered_by_subject_id": _service_headers()["X-AKL-Subject"],
        "correlation_id": "corr-budget-intake-test",
        "idempotency_key": "idem-budget-intake-test",
        "workflow_mode": "historical_batch" if batch else "interactive",
        "workflow_context": context,
    }
    headers = _service_headers()
    if not batch:
        headers["X-STRATOS-Actor-Authorization"] = "Bearer current-person-token"
    path = f"/api/v1/integrations/stratos-budget-upload/documents/{document['document_id']}/intake-authorization"
    return path, payload, headers, document["document_id"]


def _snapshot(db):
    # Include all tables: authorization must not create a version, job, audit,
    # idempotency record, or change document metadata.
    return {table.name: repr(db.execute(select(table)).all()) for table in Base.metadata.sorted_tables}


def _production(monkeypatch, db, document_id, authority):
    document = db.get(Document, document_id)
    document.governance_registration_status = "REGISTERED"
    db.commit()
    settings = api.get_settings().model_copy(update={"auth_mode": "oidc"})
    monkeypatch.setattr(api, "get_settings", lambda: settings)
    monkeypatch.setattr(permissions, "get_settings", lambda: settings)
    actor = Principal(
        ACTOR, {"stratos_user"}, set(), capabilities={"akb:upload", "akb:manage_document"},
        scopes={f"budget_scope:{FINANCIAL_SCOPE}"}, dynamic_access_loaded=True,
        bearer_token="current-person-token",
    )
    state = SimpleNamespace(actor=actor, actor_headers=None, registration_error=None,
                            registration_id=document.governed_resource_id,
                            pdp_error=None, pdp_decision="ALLOW", registrations=[], decisions=[])

    def authenticate(request, _settings):
        state.actor_headers = dict(request.headers)
        return state.actor

    class Governance:
        def register_budget_akb_resource(self, **kwargs):
            state.registrations.append(kwargs)
            if state.registration_error:
                raise state.registration_error
            result = authority.register_budget_akb_resource(**kwargs)
            return replace(result, governed_resource_id=state.registration_id) if result.governed_resource_id != state.registration_id else result

        def decide(self, **kwargs):
            state.decisions.append(kwargs)
            if state.pdp_error:
                raise state.pdp_error
            return {"decision": state.pdp_decision, "reasonCodes": ["POLICY_RESULT"], "obligations": []}

    monkeypatch.setattr(api, "get_authenticated_principal", authenticate)
    monkeypatch.setattr(api, "governance_client", lambda _settings: Governance())
    monkeypatch.setattr(permissions, "governance_client", lambda _settings: Governance())
    return state


@pytest.mark.parametrize("audience", ["organization", "recipient_set"])
def test_broad_audience_preserves_fresh_actor_source_and_pdp(client, db_session, monkeypatch, verified_profile_authority, audience):
    path, payload, headers, document_id = _setup(client, audience=audience)
    state = _production(monkeypatch, db_session, document_id, verified_profile_authority)
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code == 200, response.text
    assert state.registrations[0]["scope"] == {"type": "budget_scope", "id": FINANCIAL_SCOPE}
    assert state.registrations[0]["binding"].audience.scope_type == audience
    assert state.decisions[0]["credential_token"] == "current-person-token"
    assert _snapshot(db_session) == before
    state.pdp_decision = "DENY"
    denied = client.post(path, json=payload, headers=headers)
    assert denied.status_code == 403, denied.text
    assert _snapshot(db_session) == before


@pytest.mark.parametrize("batch", [False, True])
def test_accepts_exact_intake_with_verified_profile_without_local_writes(client, db_session, batch, verified_profile_authority):
    path, payload, headers, _ = _setup(client, batch=batch)
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["confirmed_subject_id"] == ACTOR
    assert response.json()["source_version"] == FILE_HASH
    assert response.json()["registered_by_subject_id"] == payload["registered_by_subject_id"]
    assert _snapshot(db_session) == before


@pytest.mark.parametrize(("field", "value", "expected"), [
    ("registered_by_subject_id", "different-service", 403),
    ("external_document_id", "extdoc-other", 409),
    ("governed_document_resource_id", "gres-other", 409),
    ("source_governed_resource_id", "gres-parent-other", 409),
    ("source_resource_id", "contract-other", 409),
    ("policy_binding_id", "pb_other_binding", 409),
    ("policy_hash", "sha256:" + "f" * 64, 409),
    ("governance_scope", {"type": "budget_scope", "id": "budget:other"}, 409),
    ("source_version", "not-a-sha256", 422),
])
def test_rejects_tampered_references_without_writes(client, db_session, field, value, expected, verified_profile_authority):
    path, payload, headers, _ = _setup(client)
    payload[field] = value
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code == expected, response.text
    assert _snapshot(db_session) == before


def test_rejects_non_budget_service_and_missing_actor(client, verified_profile_authority):
    path, payload, headers, _ = _setup(client)
    assert client.post(path, json=payload, headers=_service_headers(roles="admin")).status_code == 403
    assert client.post(path, json=payload, headers=_service_headers()).status_code == 403


@pytest.mark.parametrize("change", ["owner", "batch", "actor_header", "unknown", "missing"])
def test_rejects_invalid_historical_batch_authority(client, db_session, change, verified_profile_authority):
    path, payload, headers, _ = _setup(client, batch=True)
    if change == "owner":
        payload["actor_subject_id"] = "other-owner"
    elif change == "batch":
        payload["workflow_context"]["batch_manifest_id"] = "other-batch"
    elif change == "actor_header":
        headers["X-STRATOS-Actor-Authorization"] = "Bearer person-token"
    elif change == "unknown":
        payload["workflow_context"]["override"] = "true"
    else:
        payload["workflow_context"].pop("release_revision")
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code in {403, 409, 422}, response.text
    assert _snapshot(db_session) == before


def test_fresh_actor_and_source_parent_revalidation_use_only_trusted_data(client, db_session, monkeypatch, verified_profile_authority):
    path, payload, headers, document_id = _setup(client)
    state = _production(monkeypatch, db_session, document_id, verified_profile_authority)
    headers.update({"X-STRATOS-Capabilities": "admin", "X-STRATOS-Scopes": "*"})
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code == 200, response.text
    assert state.actor_headers == {"authorization": "Bearer current-person-token"}
    assert len(state.decisions) == 1
    assert state.decisions[0]["credential_token"] == "current-person-token"
    registration = state.registrations[0]
    assert registration["source_version"] == payload["document_profile"]["expected_root_metadata_revision"]
    assert registration["parent_id"] == PARENT_RESOURCE
    assert registration["binding"].policy_binding_id == payload["policy_binding_id"]
    assert registration["envelope"].payload["fileHash"] == FILE_HASH
    assert _snapshot(db_session) == before


@pytest.mark.parametrize("failure", ["subject", "service_actor", "revoked", "pdp_denied", "pdp_unavailable", "parent_denied", "parent_unavailable"])
def test_production_authority_failures_prevent_intake_without_writes(client, db_session, monkeypatch, failure, verified_profile_authority):
    path, payload, headers, document_id = _setup(client)
    state = _production(monkeypatch, db_session, document_id, verified_profile_authority)
    expected = 403
    if failure == "subject":
        state.actor = replace(state.actor, subject_id="another-actor")
    elif failure == "service_actor":
        state.actor = replace(state.actor, service_identity=True)
    elif failure == "revoked":
        state.actor = replace(state.actor, membership_active=False)
    elif failure == "pdp_denied":
        state.pdp_decision = "DENY"
    elif failure == "pdp_unavailable":
        state.pdp_error = GovernanceUnavailable("unavailable")
        expected = 503
    elif failure == "parent_denied":
        state.registration_error = GovernanceDenied("inactive parent")
    else:
        state.registration_error = GovernanceUnavailable("unavailable")
        expected = 503
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code == expected, response.text
    assert _snapshot(db_session) == before


def test_production_batch_revalidates_parent_without_person_headers(client, db_session, monkeypatch, verified_profile_authority):
    path, payload, headers, document_id = _setup(client, batch=True)
    state = _production(monkeypatch, db_session, document_id, verified_profile_authority)
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code == 200, response.text
    assert state.actor_headers is None
    assert len(state.registrations) == 1
    assert _snapshot(db_session) == before


@pytest.mark.parametrize("change", ["mock_registration", "invalid_policy", "changed_policy", "changed_resource"])
def test_production_rejects_stale_registration_or_policy_without_writes(client, db_session, monkeypatch, change, verified_profile_authority):
    path, payload, headers, document_id = _setup(client)
    state = _production(monkeypatch, db_session, document_id, verified_profile_authority)
    document = db_session.get(Document, document_id)
    expected = 409
    if change == "mock_registration":
        document.governance_registration_status = "MOCK_BYPASSED"
    elif change == "invalid_policy":
        document.policy_summary = {"policy_binding_id": "incomplete", "tlp": "TLP:CLEAR"}
        expected = 503
    elif change == "changed_policy":
        document.policy_hash = "sha256:" + "f" * 64
    else:
        state.registration_id = "gres-another-root"
    db_session.commit()
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code == expected, response.text
    assert _snapshot(db_session) == before
    if change != "changed_resource":
        assert state.registrations == []


@pytest.mark.parametrize("batch", [False, True])
def test_central_completed_version_replay_conflict_blocks_intake_without_writes(
    client, db_session, monkeypatch, batch, verified_profile_authority
):
    """Record the current cross-service blocker, never bypass the central veto.

    STRATOS registerBudgetAkbGovernedResource rejects a document root replay
    when its idempotency key already belongs to a document-version. Exercise
    the real HTTP adapter here: its existing 409 -> unavailable mapping yields
    503 at Registry, and the authority failure must leave every table intact.
    """
    path, payload, headers, document_id = _setup(client, batch=batch)
    version_request = _version_payload(document={"document_id": document_id, "current_root_metadata_revision": payload["document_profile"]["expected_root_metadata_revision"]})
    if not batch:
        version_request["upload_mode"] = "interactive"
        version_request.pop("batch_lineage")
    version_response = client.put(
        f"/api/v1/integrations/stratos-budget-upload/documents/{document_id}/versions",
        json=version_request, headers=_service_headers(),
    )
    assert version_response.status_code == 201, version_response.text
    completed_envelope = version_request["integration_envelope"]
    payload["idempotency_key"] = completed_envelope["idempotencyKey"]
    payload["correlation_id"] = completed_envelope["correlationId"]
    _production(monkeypatch, db_session, document_id, verified_profile_authority)
    settings = api.get_settings().model_copy(update={
        "stratos_budget_akb_resources_url": "https://stratos.test/integrations/budget/akb/resources",
        "stratos_policy_service_token": "test-policy-service-credential",
    })
    requests = []

    def upstream(request):
        body = json.loads(request.content)
        requests.append(body)
        assert request.method == "PUT"
        assert request.url.path.endswith(f"/document/{document_id}")
        assert body["sourceVersion"] == payload["document_profile"]["expected_root_metadata_revision"]
        assert body["parentId"] == PARENT_RESOURCE
        assert body["integrationEnvelope"] == completed_envelope
        assert request.headers["Idempotency-Key"] == completed_envelope["idempotencyKey"]
        assert request.headers["X-Correlation-ID"] == completed_envelope["correlationId"]
        return httpx.Response(409, json={
            "message": "Budget to AKB idempotency key belongs to a different immutable target lineage",
        })

    governance = StratosGovernanceClient(settings)
    governance.close()
    with httpx.Client(transport=httpx.MockTransport(upstream)) as transport:
        governance._http_client = transport
        monkeypatch.setattr(api, "governance_client", lambda _settings: governance)
        before = _snapshot(db_session)
        response = client.post(path, json=payload, headers=headers)
    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "stratos_budget_intake_governance_unavailable"
    assert len(requests) == 1
    assert _snapshot(db_session) == before


@pytest.mark.parametrize("change,expected", [("missing",422), ("revision",409), ("owner-projection",409), ("governed-revision",409)])
def test_current_document_profile_is_required_before_intake_without_writes(client, db_session, verified_profile_authority, change, expected):
    path, payload, headers, document_id = _setup(client, batch=True)
    document = db_session.get(Document, document_id)
    if change == "missing":
        payload.pop("document_profile")
    elif change == "revision":
        payload["document_profile"]["expected_root_metadata_revision"] = "unconfirmed-root-revision"
    elif change == "owner-projection":
        document.owner_id = "other-owner-without-confirmation"
    else:
        document.governed_source_version = "unconfirmed-root-revision"
    db_session.commit()
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code == expected, response.text
    assert _snapshot(db_session) == before


@pytest.mark.parametrize("mode", ["deny", "stale", "wrong-owner", "missing", "unsupported"])
def test_current_central_profile_proof_is_verified_before_intake_without_writes(client, db_session, verified_profile_authority, mode):
    path, payload, headers, _ = _setup(client, batch=True)
    verified_profile_authority.mode = mode
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code in {403,503}, response.text
    assert _snapshot(db_session) == before


def test_budget_intake_rejects_other_contract_evidence_without_writes(client, db_session, verified_profile_authority):
    path, payload, headers, _ = _setup(client, batch=True)
    payload["document_profile"]["domain_evidence"]["contractReference"] = "different-contract"
    before = _snapshot(db_session)
    response = client.post(path, json=payload, headers=headers)
    assert response.status_code == 422, response.text
    assert _snapshot(db_session) == before
