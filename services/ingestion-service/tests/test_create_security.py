from __future__ import annotations

from pathlib import Path

from app.errors import IngestionError
from app.schemas import JobStatus
from tests.conftest import make_client, readiness_transport_headers, web_transport_headers


def _payload(source: Path, **overrides):
    return {
        "idempotency_key": "security:create-proof",
        "document_id": "doc_security",
        "document_version_id": "ver_security",
        "source_file_uri": str(source),
        **overrides,
    }


def test_generic_user_cannot_create_ingestion_job(tmp_path: Path) -> None:
    source = tmp_path / "source.txt"
    source.write_text("not processed", encoding="utf-8")

    with make_client(tmp_path, {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"}) as client:
        response = client.post(
            "/api/v1/ingestion/jobs",
            headers={"X-AKL-Subject": "user-attacker"},
            json=_payload(source),
        )
        stored_jobs = client.app.state.store.list()

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "WEB_INGESTION_TRANSPORT_REQUIRED"
    assert stored_jobs == []


def test_exact_transport_without_registry_proof_is_denied(tmp_path: Path) -> None:
    source = tmp_path / "source.txt"
    source.write_text("not processed", encoding="utf-8")

    with make_client(tmp_path, {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"}) as client:
        response = client.post(
            "/api/v1/ingestion/jobs",
            headers=web_transport_headers(actor_subject_id="user-owner"),
            json=_payload(source),
        )
        stored_jobs = client.app.state.store.list()

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INGESTION_AUTHORIZATION_REQUIRED"
    assert stored_jobs == []


def test_spoofed_delegated_actor_is_denied_before_persistence(tmp_path: Path) -> None:
    source = tmp_path / "source.txt"
    source.write_text("not processed", encoding="utf-8")

    with make_client(tmp_path, {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"}) as client:
        async def deny_spoof(**kwargs):
            assert kwargs["expected_subject_id"] == "user-spoofed"
            raise IngestionError(
                "AUTHZ_DENIED",
                "Registry did not confirm the delegated actor",
                status_code=403,
            )

        client.app.state.registry.confirm_ingestion_authorization = deny_spoof
        response = client.post(
            "/api/v1/ingestion/jobs",
            headers=web_transport_headers(
                actor_subject_id="user-spoofed",
                authorization_proof=True,
            ),
            json=_payload(source),
        )
        stored_jobs = client.app.state.store.list()

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTHZ_DENIED"
    assert stored_jobs == []


def test_registry_cas_conflict_leaves_no_runnable_orphan(tmp_path: Path) -> None:
    source = tmp_path / "source.txt"
    source.write_text("not processed", encoding="utf-8")

    with make_client(tmp_path, {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"}) as client:
        async def conflict(**_kwargs):
            raise IngestionError(
                "REGISTRY_CONFLICT",
                "Another ingestion attempt is current",
                status_code=409,
            )

        client.app.state.registry.claim_external_document_attempt = conflict
        response = client.post(
            "/api/v1/ingestion/jobs",
            headers=web_transport_headers(
                actor_subject_id="user-owner",
                authorization_proof=True,
            ),
            json=_payload(
                source,
                expected_current_ingestion_job_id="ing_previous",
            ),
        )
        stored_jobs = client.app.state.store.list()

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REGISTRY_CONFLICT"
    assert len(stored_jobs) == 1
    assert stored_jobs[0].job.status == JobStatus.failed
    assert stored_jobs[0].job.finished_at is not None


def test_ready_rejects_public_and_delegated_requests(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        public = client.get("/ready")
        delegated = client.get(
            "/ready",
            headers={
                **readiness_transport_headers(),
                "X-AKL-On-Behalf-Of": "user-owner",
            },
        )

    assert public.status_code == 403
    assert public.json()["error"]["code"] == "READINESS_TRANSPORT_REQUIRED"
    assert delegated.status_code == 403
    assert delegated.json()["error"]["code"] == "DELEGATED_ACTOR_FORBIDDEN"


def test_web_transport_preflight_verifies_exact_identity_without_delegation(
    tmp_path: Path,
) -> None:
    with make_client(tmp_path) as client:
        exact = client.get(
            "/api/v1/integrations/web-ingestion/readiness",
            headers=web_transport_headers(),
        )
        wrong_client = client.get(
            "/api/v1/integrations/web-ingestion/readiness",
            headers=readiness_transport_headers(),
        )
        delegated = client.get(
            "/api/v1/integrations/web-ingestion/readiness",
            headers=web_transport_headers(actor_subject_id="user-owner"),
        )

    assert exact.status_code == 200
    assert exact.json() == {
        "status": "ready",
        "service": "ingestion-service",
        "client_id": "svc-akb-web-ingestion",
        "role": "service_akb_web_ingestion",
    }
    assert wrong_client.status_code == 403
    assert wrong_client.json()["error"]["code"] == "WEB_INGESTION_TRANSPORT_REQUIRED"
    assert delegated.status_code == 403
    assert (
        delegated.json()["error"]["code"]
        == "WEB_INGESTION_PREFLIGHT_DELEGATION_FORBIDDEN"
    )
