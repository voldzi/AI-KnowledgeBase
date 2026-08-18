import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

from app.models import AuditEvent, WebSession


SECRET = "akb-development-web-session-store-secret-v1"


def _headers(method: str, path: str, body: bytes = b"") -> dict[str, str]:
    timestamp = str(int(time.time()))
    canonical = "\n".join(
        [timestamp, method, path, hashlib.sha256(body).hexdigest()]
    ).encode()
    signature = hmac.new(SECRET.encode(), canonical, hashlib.sha256).hexdigest()
    return {
        "X-AKB-Session-Timestamp": timestamp,
        "X-AKB-Session-Signature": signature,
        "Content-Type": "application/json",
    }


def test_server_session_lifecycle_stores_only_selector_hash(client, db_session):
    now = datetime.now(timezone.utc)
    selector_hash = hashlib.sha256(b"browser-only-selector").hexdigest()
    payload = {
        "session_id_hash": selector_hash,
        "subject_id": "user-jv",
        "issuer": "https://login.example/realms/stratos",
        "client_id": "akl-web",
        "keycloak_session_id": "kc-session-1",
        "encrypted_payload": "A" * 80,
        "persistent": True,
        "identity_validated_at": now.isoformat(),
        "last_seen_at": now.isoformat(),
        "idle_expires_at": (now + timedelta(days=30)).isoformat(),
        "absolute_expires_at": (now + timedelta(days=90)).isoformat(),
    }
    body = json.dumps(payload, separators=(",", ":")).encode()
    path = "/api/v1/internal/web-sessions"
    created = client.post(path, content=body, headers=_headers("POST", path, body))
    assert created.status_code == 201
    assert created.json()["session_id_hash"] == selector_hash
    assert db_session.query(WebSession).one().session_id_hash == selector_hash
    assert "browser-only-selector" not in db_session.query(WebSession).one().encrypted_payload

    read_path = f"{path}/{selector_hash}"
    loaded = client.get(read_path, headers=_headers("GET", read_path))
    assert loaded.status_code == 200

    list_path = "/api/v1/internal/web-sessions/subjects/user-jv/sessions"
    listed = client.get(list_path, headers=_headers("GET", list_path))
    assert listed.status_code == 200
    assert [item["session_id"] for item in listed.json()] == [created.json()["session_id"]]

    patch_body = json.dumps({"revoked_reason": "logout"}, separators=(",", ":")).encode()
    revoked = client.patch(
        read_path,
        content=patch_body,
        headers=_headers("PATCH", read_path, patch_body),
    )
    assert revoked.status_code == 200
    assert revoked.json()["revoked_reason"] == "logout"
    events = db_session.query(AuditEvent).filter_by(resource_type="web_session").all()
    assert {event.event_type for event in events} == {
        "auth.web_session.created",
        "auth.web_session.revoked",
    }
    assert all("encrypted_payload" not in event.event_metadata for event in events)


def test_server_session_store_rejects_invalid_signature(client):
    response = client.get(
        "/api/v1/internal/web-sessions/" + "a" * 64,
        headers={
            "X-AKB-Session-Timestamp": str(int(time.time())),
            "X-AKB-Session-Signature": "0" * 64,
        },
    )
    assert response.status_code == 401


def test_server_session_store_supports_selective_and_global_revocation(client):
    now = datetime.now(timezone.utc)
    session_ids: list[str] = []
    for index in range(2):
        payload = {
            "session_id_hash": hashlib.sha256(f"selector-{index}".encode()).hexdigest(),
            "subject_id": "user-devices",
            "issuer": "https://login.example/realms/stratos",
            "client_id": "akl-web",
            "keycloak_session_id": f"kc-{index}",
            "encrypted_payload": "A" * 80,
            "persistent": True,
            "identity_validated_at": now.isoformat(),
            "last_seen_at": now.isoformat(),
            "idle_expires_at": (now + timedelta(days=30)).isoformat(),
            "absolute_expires_at": (now + timedelta(days=90)).isoformat(),
        }
        body = json.dumps(payload, separators=(",", ":")).encode()
        path = "/api/v1/internal/web-sessions"
        response = client.post(path, content=body, headers=_headers("POST", path, body))
        assert response.status_code == 201
        session_ids.append(response.json()["session_id"])

    selective_path = (
        "/api/v1/internal/web-sessions/subjects/user-devices/sessions/"
        + session_ids[0]
    )
    selective = client.delete(
        selective_path,
        headers=_headers("DELETE", selective_path),
    )
    assert selective.status_code == 204

    list_path = "/api/v1/internal/web-sessions/subjects/user-devices/sessions"
    listed = client.get(list_path, headers=_headers("GET", list_path))
    assert [item["session_id"] for item in listed.json()] == [session_ids[1]]

    global_path = "/api/v1/internal/web-sessions/subjects/user-devices/all"
    globally_revoked = client.delete(
        global_path,
        headers=_headers("DELETE", global_path),
    )
    assert globally_revoked.status_code == 204
    listed = client.get(list_path, headers=_headers("GET", list_path))
    assert listed.json() == []
