from document_profile_fixtures import verified_profile_authority, admit_orm_profile
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app import api
from app.document_temporal import effective_document_version
from app.document_workflow import review_snapshot
from app.information_policy import InformationPolicyBinding, canonical_policy_hash
from app.models import Document, DocumentVersion


TODAY = date(2026, 9, 5)
FUTURE = TODAY + timedelta(days=30)
POLICY = {
    "schemaVersion": "stratos-information-policy-2",
    "policyBindingId": "pb_temporal_test_12345678",
    "policyVersion": "information-policy-2.0.0",
    "handlingClass": "INTERNAL", "legalClassification": "NONE", "tlp": "TLP:GREEN", "pap": None,
    "contentCategories": ["CONTRACTUAL"],
    "audience": {"organizationId": "org_stratos", "scopeType": "organization", "scopeIds": [], "recipientSubjectIds": []},
    "obligations": ["AUDIT_ACCESS"], "originatorId": "user_owner",
    "issuedAt": "2026-01-01T00:00:00Z", "reviewAt": None,
}
POLICY_HASH = canonical_policy_hash(InformationPolicyBinding.model_validate(POLICY))


def timeline(db_session, authority, *, first_end=None, second_start=FUTURE, second_end=None, record_dates=None):
    binding = {"policy_binding_id": POLICY["policyBindingId"], "policy_version": POLICY["policyVersion"], "policy_hash": POLICY_HASH, "policy_summary": dict(POLICY)}
    document = Document(
        document_id="doc_temporal", title="Temporal fixture", document_type="knowledge_base_article" if record_dates else "contract",
        status="valid", owner_id="user_owner", classification="internal", tags=[], **binding,
    )
    first = DocumentVersion(
        document_version_id="ver_current", document=document, version_label="v1", status="valid",
        valid_from=None if record_dates else TODAY-timedelta(days=30), valid_to=first_end,
        source_file_uri="s3://test/current.pdf", file_hash="sha256:"+"a"*64,
        published_at=datetime(2026, 8, 1, tzinfo=timezone.utc), **binding,
    )
    second = DocumentVersion(
        document_version_id="ver_future", document=document, version_label="v2", status="approved",
        valid_from=None if record_dates else second_start, valid_to=second_end,
        source_file_uri="s3://test/future.pdf", file_hash="sha256:"+"b"*64, **binding,
    )
    db_session.add_all([document, first, second])
    db_session.flush()
    admit_orm_profile(db_session, document, [first, second], authority,
                      recorded_on=record_dates or "2020-01-01")
    db_session.commit()
    return document, first, second


def publish(db, document, version):
    api._publish_version(db, document=document, version=version, actor_id="user_publisher")
    db.commit()


def authz(client, admin_headers, effective_on, versions):
    return client.post("/api/v1/authz/filter-documents", headers=admin_headers, json={
        "subject_id": "user_admin", "roles": ["admin"], "action": "rag.query",
        "candidate_document_ids": ["doc_temporal"],
        "candidate_document_versions": {"doc_temporal": versions},
        "candidate_policy_hashes": {"doc_temporal": [POLICY_HASH]},
        "effective_on": effective_on.isoformat(),
    })


def test_publish_future_overlap_preserves_current_and_immutable_review_evidence(db_session, monkeypatch, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority)
    before = review_snapshot(document, first)
    monkeypatch.setattr(api, "document_calendar_today", lambda: TODAY)
    assert api._current_valid_document_version(db_session, document.document_id).document_version_id == first.document_version_id
    publish(db_session, document, second)
    assert first.status == second.status == "valid"
    assert first.valid_to is None
    assert review_snapshot(document, first) == before
    assert api._current_valid_document_version(db_session, document.document_id).document_version_id == first.document_version_id
    assert effective_document_version(document.versions, FUTURE-timedelta(days=1)) is first
    assert effective_document_version(document.versions, FUTURE) is second
    assert effective_document_version(document.versions, FUTURE+timedelta(days=1)) is second


def test_explicit_nonoverlap_keeps_both_historical_and_current_publications(db_session, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority, first_end=FUTURE-timedelta(days=1))
    publish(db_session, document, second)
    assert first.status == second.status == "valid"
    assert effective_document_version(document.versions, first.valid_from) is first
    assert effective_document_version(document.versions, first.valid_to) is first
    assert effective_document_version(document.versions, second.valid_from) is second
    assert effective_document_version(document.versions, first.valid_from-timedelta(days=1)) is None


def test_publication_same_effective_start_is_a_correction_and_replay_is_idempotent(db_session, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority, second_start=TODAY-timedelta(days=30))
    publish(db_session, document, second)
    assert first.status == "superseded"
    assert effective_document_version(document.versions, TODAY) is second
    published_at = second.published_at
    publish(db_session, document, second)
    assert second.published_at == published_at
    assert effective_document_version(document.versions, TODAY) is second


@pytest.mark.parametrize("withdrawn", ["superseded", "cancelled", "archived", "expired"])
def test_withdrawn_or_expired_successor_does_not_revive_open_ended_old_rules(db_session, withdrawn, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority, second_end=FUTURE+timedelta(days=5))
    publish(db_session, document, second)
    if withdrawn != "expired":
        second.status = withdrawn
        db_session.commit()
    applicable_on = FUTURE+timedelta(days=6) if withdrawn == "expired" else FUTURE
    assert effective_document_version(document.versions, applicable_on) is None
    assert effective_document_version(document.versions, TODAY) is first


def test_unpublished_draft_or_cancelled_version_is_not_a_timeline_boundary(db_session, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority, second_start=TODAY)
    for state in ["draft", "review", "approved", "cancelled"]:
        second.status = state
        assert second.published_at is None
        assert effective_document_version(document.versions, FUTURE) is first


def test_gap_and_inclusive_expiry_have_no_implicit_fallback(db_session, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority, first_end=TODAY, second_end=FUTURE+timedelta(days=2))
    publish(db_session, document, second)
    assert effective_document_version(document.versions, TODAY) is first
    assert effective_document_version(document.versions, TODAY+timedelta(days=1)) is None
    assert effective_document_version(document.versions, second.valid_to) is second
    assert effective_document_version(document.versions, second.valid_to+timedelta(days=1)) is None


def test_record_versions_become_visible_from_their_explicit_record_date(db_session, verified_profile_authority):
    first_recorded = TODAY-timedelta(days=30)
    document, first, second = timeline(db_session, verified_profile_authority,
        record_dates={"ver_current": first_recorded.isoformat(), "ver_future": FUTURE.isoformat()})
    publish(db_session, document, second)
    assert first.valid_from is second.valid_from is None
    assert effective_document_version(document.versions, first_recorded-timedelta(days=1)) is None
    assert effective_document_version(document.versions, first_recorded) is first
    assert effective_document_version(document.versions, TODAY) is first
    assert effective_document_version(document.versions, FUTURE) is second


def test_future_only_and_cancelled_document_have_no_current_source(db_session, monkeypatch, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority)
    first.status = "draft"
    first.published_at = None
    publish(db_session, document, second)
    monkeypatch.setattr(api, "document_calendar_today", lambda: TODAY)
    assert api._current_valid_document_version(db_session, document.document_id) is None
    monkeypatch.setattr(api, "document_calendar_today", lambda: FUTURE)
    assert api._current_valid_document_version(db_session, document.document_id) is second
    document.status = "cancelled"
    db_session.commit()
    assert api._current_valid_document_version(db_session, document.document_id) is None


def test_publish_rejects_withdrawn_version(db_session, verified_profile_authority):
    document, _, second = timeline(db_session, verified_profile_authority)
    second.status = "cancelled"
    with pytest.raises(HTTPException) as error:
        publish(db_session, document, second)
    assert error.value.status_code == 409


def test_registry_temporal_gate_resolves_full_timeline_before_candidate_intersection(client, admin_headers, db_session, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority)
    publish(db_session, document, second)
    all_ids = [first.document_version_id, second.document_version_id]
    historical = authz(client, admin_headers, TODAY, all_ids)
    assert historical.status_code == 200, historical.text
    assert historical.json()["effective_on"] == TODAY.isoformat()
    assert historical.json()["allowed_document_version_ids"] == {document.document_id: [first.document_version_id]}
    current = authz(client, admin_headers, FUTURE, all_ids)
    assert current.status_code == 200, current.text
    assert current.json()["allowed_document_version_ids"] == {document.document_id: [second.document_version_id]}
    # An index containing only old V1 must not make V1 current after V2 starts.
    stale_index = authz(client, admin_headers, FUTURE, [first.document_version_id])
    assert stale_index.status_code == 200, stale_index.text
    assert stale_index.json()["allowed_document_ids"] == []
    assert stale_index.json()["denied_document_version_ids"] == {document.document_id: [first.document_version_id]}


def test_temporal_gate_requires_exact_version_coordinates(client, admin_headers):
    response = client.post("/api/v1/authz/filter-documents", headers=admin_headers, json={
        "subject_id": "user_admin", "action": "rag.query", "candidate_document_ids": ["doc_temporal"],
        "effective_on": TODAY.isoformat(),
    })
    assert response.status_code == 422


def test_effective_version_without_explicit_tlp_cannot_expose_itself_or_older_source(client, admin_headers, db_session, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority)
    publish(db_session, document, second)
    second.policy_summary = {**second.policy_summary, "tlp": None}
    db_session.commit()
    result = authz(client, admin_headers, FUTURE, [first.document_version_id, second.document_version_id])
    assert result.status_code == 200, result.text
    assert result.json()["allowed_document_ids"] == []
    assert result.json()["allowed_document_version_ids"] == {}


def test_late_publication_of_historical_version_does_not_override_later_effective_start(db_session, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority, second_start=TODAY-timedelta(days=60))
    publish(db_session, document, second)
    assert effective_document_version(document.versions, TODAY-timedelta(days=45)) is second
    assert effective_document_version(document.versions, TODAY) is first


def test_versions_endpoint_selects_one_effective_version_and_preserves_full_audit_list(client, admin_headers, db_session, verified_profile_authority):
    document, first, second = timeline(db_session, verified_profile_authority)
    publish(db_session, document, second)
    endpoint = f"/api/v1/documents/{document.document_id}/versions"
    for day, expected in [(TODAY, first), (FUTURE, second)]:
        response = client.get(endpoint, params={"valid_on": day.isoformat()}, headers=admin_headers)
        assert response.status_code == 200, response.text
        assert [item["document_version_id"] for item in response.json()["items"]] == [expected.document_version_id]
    audit = client.get(endpoint, headers=admin_headers)
    assert len(audit.json()["items"]) == 2
    unavailable = client.get(endpoint, params={"valid_on": TODAY.isoformat(), "status": "cancelled"}, headers=admin_headers)
    assert unavailable.json()["items"] == []


def test_budget_future_activation_preserves_current_version_and_replay_does_not_reactivate_history(client, db_session, monkeypatch, verified_profile_authority):
    from tests.test_stratos_budget_upload_bridge import (
        FILE_HASH_2, _preflight_payload, _service_headers, _version_payload,
    )

    created = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        headers=_service_headers(), json=_preflight_payload(),
    )
    assert created.status_code == 201, created.text
    document_id = created.json()["document"]["document_id"]
    endpoint = f"/api/v1/integrations/stratos-budget-upload/documents/{document_id}/versions"
    first_payload = {**_version_payload(document=created.json()["document"]), "valid_from": (TODAY-timedelta(days=30)).isoformat(), "valid_to": None}
    first_payload["document_profile"]["lifecycle"].update(mode="until_superseded", effectiveFrom=first_payload["valid_from"], effectiveTo=None)
    first_response = client.put(endpoint, headers=_service_headers(), json=first_payload)
    assert first_response.status_code == 201, first_response.text
    second_payload = {**_version_payload(FILE_HASH_2, document=created.json()["document"]), "version_label": "contract-file-v2", "valid_from": FUTURE.isoformat(), "valid_to": None}
    second_payload["document_profile"]["lifecycle"].update(mode="until_superseded", effectiveFrom=second_payload["valid_from"], effectiveTo=None)
    second_response = client.put(endpoint, headers=_service_headers(), json=second_payload)
    assert second_response.status_code == 201, second_response.text
    first = db_session.get(DocumentVersion, first_response.json()["version"]["document_version_id"])
    second = db_session.get(DocumentVersion, second_response.json()["version"]["document_version_id"])
    assert first.status == second.status == "valid"
    assert first.valid_to is None
    monkeypatch.setattr(api, "document_calendar_today", lambda: TODAY)
    assert api._current_valid_document_version(db_session, document_id) is first
    monkeypatch.setattr(api, "document_calendar_today", lambda: FUTURE)
    assert api._current_valid_document_version(db_session, document_id) is second
    replay = client.put(endpoint, headers=_service_headers(), json=first_payload)
    assert replay.status_code == 200, replay.text
    assert api._current_valid_document_version(db_session, document_id) is second
