import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.config import get_settings
from app.models import AuditEvent, WebSession
from test_managed_identity import ISSUER, SUBJECT, settings
from test_web_sessions import _headers

PATH = "/api/v1/internal/web-sessions"


def session_payload(persistent=False):
    now = datetime.now(timezone.utc)
    return {
        "session_id_hash": hashlib.sha256(b"synthetic-selector").hexdigest(),
        "subject_id": SUBJECT, "issuer": ISSUER, "client_id": "akl-web",
        "encrypted_payload": "encrypted-test-value-" * 5, "persistent": persistent,
        "identity_validated_at": now.isoformat(), "last_seen_at": now.isoformat(),
        "idle_expires_at": (now + (timedelta(days=30) if persistent else timedelta(hours=8))).isoformat(),
        "absolute_expires_at": (now + (timedelta(days=90) if persistent else timedelta(hours=24))).isoformat(),
    }


def signed_request(client, method, path, payload):
    body = json.dumps(payload, separators=(",", ":")).encode()
    return client.request(method, path, content=body, headers=_headers(method, path, body))


@pytest.mark.parametrize("persistent", [False, True])
def test_managed_session_bounds_and_rotation_cannot_revive_revoked_session(client, db_session, persistent):
    client.app.dependency_overrides[get_settings] = lambda: settings()
    payload = session_payload(persistent)
    created = signed_request(client, "POST", PATH, payload)
    assert created.status_code == 201
    path = PATH + "/" + payload["session_id_hash"]
    patch = {"encrypted_payload": "rotated-encrypted-value-" * 5}
    assert signed_request(client, "PATCH", path, patch).status_code == 409
    patch["expected_updated_at"] = created.json()["updated_at"]
    assert signed_request(client, "PATCH", path, patch).status_code == 200
    assert signed_request(client, "PATCH", path, patch).status_code == 409
    assert client.delete(path, headers=_headers("DELETE", path)).status_code == 204
    current = db_session.query(WebSession).one()
    patch["expected_updated_at"] = current.updated_at.replace(tzinfo=timezone.utc).isoformat()
    assert signed_request(client, "PATCH", path, patch).status_code == 409
    assert db_session.query(WebSession).one().revoked_at is not None


@pytest.mark.parametrize("field", ["idle_expires_at", "absolute_expires_at", "identity_validated_at", "last_seen_at", "issuer"])
def test_managed_session_rejects_oversized_lifetime_or_foreign_issuer(client, field):
    client.app.dependency_overrides[get_settings] = lambda: settings()
    payload = session_payload()
    payload[field] = "https://other.example/identity" if field == "issuer" else (datetime.now(timezone.utc) + timedelta(days=91)).isoformat()
    assert signed_request(client, "POST", PATH, payload).status_code == 422


def test_session_errors_and_audit_never_echo_payload(client, db_session):
    client.app.dependency_overrides[get_settings] = lambda: settings()
    payload = session_payload()
    payload["encrypted_payload"] = "sensitive-invalid-input"
    response = signed_request(client, "POST", PATH, payload)
    assert response.status_code == 422
    assert payload["encrypted_payload"] not in response.text
    payload = session_payload()
    assert signed_request(client, "POST", PATH, payload).status_code == 201
    event = db_session.query(AuditEvent).one()
    serialized = json.dumps(event.event_metadata)
    assert payload["encrypted_payload"] not in serialized
    assert payload["session_id_hash"] not in serialized


@pytest.mark.parametrize("managed", [False, True])
def test_session_policy_downgrade_is_atomic_and_never_extends_deadline(client, managed):
    if managed:
        client.app.dependency_overrides[get_settings] = lambda: settings()
    payload = session_payload(True)
    created = signed_request(client, "POST", PATH, payload)
    assert created.status_code == 201
    path = PATH + "/" + payload["session_id_hash"]
    now = datetime.now(timezone.utc)
    shorter = {
        "persistent": False, "absolute_expires_at": (now + timedelta(hours=23)).isoformat(),
        "idle_expires_at": (now + timedelta(hours=7)).isoformat(),
        "expected_updated_at": created.json()["updated_at"],
    }
    downgraded = signed_request(client, "PATCH", path, shorter)
    assert downgraded.status_code == 200
    assert downgraded.json()["persistent"] is False
    for patch in ({"persistent": True}, {"absolute_expires_at": payload["absolute_expires_at"]}):
        assert signed_request(client, "PATCH", path, patch | {"expected_updated_at": downgraded.json()["updated_at"]}).status_code == 422
    assert signed_request(client, "PATCH", path, shorter).status_code == 409


def test_external_session_without_remember_is_also_bounded(client):
    payload = session_payload(False)
    payload["absolute_expires_at"] = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    assert signed_request(client, "POST", PATH, payload).status_code == 422


def audit_payload():
    return {
        "actor_id": SUBJECT, "event_type": "assistant.director_copilot_v2_returned",
        "resource_type": "assistant_conversation", "resource_id": "conv_test",
        "severity": "info", "correlation_id": "test-managed-audit",
        "metadata": {"contract_version": "director-copilot-2", "evidence_status": "passed",
                     "source_statuses_json": json.dumps([{"application": "budget", "status": "complete", "reason_codes": [], "returned_item_count": 2, "latency_ms": 20}])},
    }


def test_managed_audit_uses_only_signed_bff_channel(client, db_session):
    client.app.dependency_overrides[get_settings] = lambda: settings()
    path, payload = "/api/v1/internal/director-copilot/audit", audit_payload()
    assert client.post(path, json=payload, headers={"Authorization": "Bearer synthetic-token"}).status_code == 422
    response = signed_request(client, "POST", path, payload)
    assert response.status_code == 201
    event = db_session.query(AuditEvent).one()
    assert event.actor_id == "akb-browser-bff"
    assert event.correlation_id == "test-managed-audit"
    assert event.event_metadata["reported_actor_id"] == SUBJECT
    assert "synthetic-token" not in json.dumps(event.event_metadata)


@pytest.mark.parametrize("metadata", [
    {"access_token": "sensitive-value"}, {"answer": "private answer"},
    {"source_statuses_json": '[{"content":"private document"}]'},
    {"failure_reason_code": "Bearer sensitive-value"},
])
def test_managed_audit_rejects_content_and_secret_fields_without_echo(client, db_session, metadata):
    client.app.dependency_overrides[get_settings] = lambda: settings()
    payload = audit_payload() | {"metadata": metadata}
    response = signed_request(client, "POST", "/api/v1/internal/director-copilot/audit", payload)
    assert response.status_code == 422
    assert "sensitive-value" not in response.text and "private" not in response.text
    assert not db_session.query(AuditEvent).all()


def test_managed_audit_disabled_in_external_mode(client):
    assert signed_request(client, "POST", "/api/v1/internal/director-copilot/audit", audit_payload()).status_code == 404
