def _headers(
    role: str = "service_aiip",
    *,
    client_id: str | None = None,
) -> dict[str, str]:
    resolved_client_id = client_id or {
        "service_aiip": "aiip-service",
        "service_rag": "akb-rag-service",
        "service_evaluation": "svc-evaluation",
    }.get(role)
    headers = {
        "X-AKL-Subject": (
            f"service-account-{resolved_client_id}" if resolved_client_id else "svc-aiip"
        ),
        "X-AKL-Roles": role,
        "X-Request-ID": "req-aiip",
        "X-Correlation-ID": "corr-aiip",
    }
    if resolved_client_id:
        headers["X-AKL-Service-Client-ID"] = resolved_client_id
    return headers


def _reserve(client, *, key: str = "idem-aiip-0001", input_hash: str = "a" * 64):
    return client.post(
        "/api/v1/integrations/idempotency/reserve",
        headers=_headers("service_rag"),
        json={
            "client_id": "aiip-service",
            "operation": "harmonize",
            "idempotency_key": key,
            "input_hash": input_hash,
            "retention_seconds": 86400,
        },
    )


def test_idempotency_reserve_complete_and_replay(client):
    reserved = _reserve(client)
    assert reserved.status_code == 200, reserved.text
    assert reserved.json()["state"] == "reserved"

    completed = client.post(
        f"/api/v1/integrations/idempotency/{reserved.json()['record_id']}/complete",
        headers=_headers("service_rag"),
        json={
            "response_status": 200,
            "response_body": {"schema_version": "1.0", "result": {"suggestions": []}},
            "audit_event_id": "audit_aiip_1",
        },
    )
    assert completed.status_code == 200, completed.text

    replay = _reserve(client)
    assert replay.status_code == 200, replay.text
    assert replay.json()["state"] == "replay"
    assert replay.json()["response_body"]["schema_version"] == "1.0"
    assert replay.json()["audit_event_id"] == "audit_aiip_1"


def test_aiip_assistance_service_is_not_a_registry_trusted_client(client):
    response = client.post(
        "/api/v1/integrations/idempotency/reserve",
        headers=_headers("service_aiip"),
        json={
            "client_id": "aiip-service",
            "operation": "harmonize",
            "idempotency_key": "idem-aiip-direct-denied",
            "input_hash": "a" * 64,
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "untrusted_service_identity"


def test_idempotency_key_reuse_with_another_hash_is_conflict(client):
    assert _reserve(client).json()["state"] == "reserved"
    conflict = _reserve(client, input_hash="b" * 64)
    assert conflict.status_code == 200
    assert conflict.json()["state"] == "conflict"


def test_idempotency_access_rejects_unrelated_role(client):
    response = client.post(
        "/api/v1/integrations/idempotency/reserve",
        headers=_headers("reader"),
        json={
            "client_id": "aiip-service",
            "operation": "harmonize",
            "idempotency_key": "idem-aiip-0002",
            "input_hash": "a" * 64,
        },
    )
    assert response.status_code == 403


def test_idempotency_reserve_rejects_cross_client_namespace(client):
    response = client.post(
        "/api/v1/integrations/idempotency/reserve",
        headers=_headers("service_evaluation"),
        json={
            "client_id": "aiip-service",
            "operation": "harmonize",
            "idempotency_key": "idem-cross-client-1",
            "input_hash": "a" * 64,
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "idempotency_namespace_forbidden"


def test_idempotency_completion_rejects_foreign_caller(client):
    reserved = _reserve(client, key="idem-cross-complete")
    response = client.post(
        f"/api/v1/integrations/idempotency/{reserved.json()['record_id']}/complete",
        headers=_headers("service_evaluation"),
        json={
            "response_status": 200,
            "response_body": {"result": "forged"},
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "idempotency_namespace_forbidden"


def test_stale_processing_reservation_can_be_reclaimed(client, db_session):
    reserved = _reserve(client, key="idem-aiip-stale")
    record = db_session.get(IntegrationIdempotencyRecord, reserved.json()["record_id"])
    assert record is not None
    record.updated_at = utcnow() - timedelta(minutes=6)
    db_session.commit()

    reclaimed = _reserve(client, key="idem-aiip-stale")

    assert reclaimed.status_code == 200
    assert reclaimed.json()["state"] == "reserved"
from datetime import timedelta

from app.models import IntegrationIdempotencyRecord, utcnow
