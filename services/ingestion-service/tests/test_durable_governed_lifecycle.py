from __future__ import annotations

import asyncio
from dataclasses import replace
import json
from pathlib import Path

from app.errors import IngestionError
from app.main import _recover_durable_jobs
from app.schemas import JobStatus
from tests.conftest import (
    actor_proof_headers,
    make_client,
    readiness_transport_headers,
    web_transport_headers,
)


def _payload(source: Path, idempotency_key: str) -> dict[str, object]:
    return {
        "idempotency_key": idempotency_key,
        "document_id": "doc_durable",
        "document_version_id": "ver_durable",
        "source_file_uri": str(source),
        "parser_profile": "controlled_document",
        "ocr_enabled": True,
        "chunking_strategy": "legal_structured",
        "embedding_profile": "default",
        "expected_current_ingestion_job_id": None,
    }


def _create_headers() -> dict[str, str]:
    return web_transport_headers(
        actor_subject_id="user-owner",
        authorization_proof=True,
    )


def test_crash_after_registry_claim_replays_from_durable_claiming_state(
    tmp_path: Path,
) -> None:
    source = tmp_path / "claim-crash.txt"
    source.write_text("A durable claim must survive a local crash boundary.", encoding="utf-8")

    with make_client(
        tmp_path,
        {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"},
    ) as client:
        store = client.app.state.store
        registry_claims = 0
        original_claim = client.app.state.registry.claim_external_document_attempt
        original_update = store.update_status
        crash_once = True

        async def track_claim(**kwargs):
            nonlocal registry_claims
            registry_claims += 1
            return await original_claim(**kwargs)

        def crash_after_claim(job_id, status, **kwargs):
            nonlocal crash_once
            if status == JobStatus.queued and crash_once:
                crash_once = False
                raise IngestionError(
                    "LOCAL_DURABILITY_FAULT",
                    "Simulated crash before the local QUEUED commit",
                    status_code=503,
                )
            return original_update(job_id, status, **kwargs)

        client.app.state.registry.claim_external_document_attempt = track_claim
        store.update_status = crash_after_claim
        first = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:claim-crash"),
        )
        after_crash = store.list()[0]
        second = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:claim-crash"),
        )
        recovered = store.list()[0]

    assert first.status_code == 503
    assert after_crash.job.status == JobStatus.claiming
    assert second.status_code == 200
    assert second.headers["Idempotency-Replayed"] == "true"
    assert recovered.job.status == JobStatus.queued
    assert registry_claims == 2


def test_registry_execution_lease_conflict_blocks_all_processing_side_effects(
    tmp_path: Path,
) -> None:
    source = tmp_path / "lease-conflict.txt"
    source.write_text("This source must never be read without a Registry lease.", encoding="utf-8")

    with make_client(tmp_path) as client:
        attempted_statuses: list[str] = []

        async def deny_execution_lease(**kwargs):
            attempted_statuses.append(kwargs["ingestion_status"])
            raise IngestionError(
                "REGISTRY_CONFLICT",
                "Another execution lease is active",
                status_code=409,
            )

        client.app.state.registry.update_external_document_current = deny_execution_lease
        response = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:lease-conflict"),
        )
        stored = client.app.state.store.list()[0]
        indexed_points = list(client.app.state.indexer.mock_points)

    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert attempted_statuses == ["INGESTING"]
    assert indexed_points == []
    assert stored.report is not None
    assert stored.report.documents_processed == 0
    assert stored.report.errors[0].code == "REGISTRY_CONFLICT"
    assert stored.pending_external_status is None


def test_unknown_execution_lease_result_retries_before_processing(
    tmp_path: Path,
) -> None:
    source = tmp_path / "lease-unknown.txt"
    source.write_text(
        "The exact same execution lease is retried before parsing or indexing.",
        encoding="utf-8",
    )

    with make_client(tmp_path) as client:
        statuses: list[str] = []
        fail_once = True

        async def unknown_then_confirmed(**kwargs):
            nonlocal fail_once
            statuses.append(kwargs["ingestion_status"])
            if kwargs["ingestion_status"] == "INGESTING" and fail_once:
                fail_once = False
                raise IngestionError(
                    "REGISTRY_UNAVAILABLE",
                    "The Registry response was not observed",
                    status_code=502,
                )

        client.app.state.registry.update_external_document_current = unknown_then_confirmed
        first = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:lease-unknown"),
        )
        after_unknown = client.app.state.store.list()[0]
        assert client.app.state.indexer.mock_points == []
        second = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:lease-unknown"),
        )
        recovered = client.app.state.store.list()[0]
        indexed_points = list(client.app.state.indexer.mock_points)

    assert first.status_code == 502
    assert after_unknown.job.status == JobStatus.starting
    assert second.status_code == 200
    assert second.headers["Idempotency-Replayed"] == "true"
    assert recovered.job.status == JobStatus.completed
    assert recovered.pending_external_status is None
    assert statuses == ["INGESTING", "INGESTING", "INDEXED"]
    assert indexed_points


def test_terminal_report_and_registry_outbox_recover_without_reindexing(
    tmp_path: Path,
) -> None:
    source = tmp_path / "terminal-outbox.txt"
    source.write_text(
        "Terminal status and report are committed with a durable Registry outbox.",
        encoding="utf-8",
    )

    with make_client(tmp_path) as client:
        statuses: list[str] = []
        fail_terminal_once = True

        async def fail_first_terminal_sync(**kwargs):
            nonlocal fail_terminal_once
            status = kwargs["ingestion_status"]
            statuses.append(status)
            if status == "INDEXED" and fail_terminal_once:
                fail_terminal_once = False
                raise IngestionError(
                    "REGISTRY_UNAVAILABLE",
                    "Terminal Registry sync was not observed",
                    status_code=502,
                )

        client.app.state.registry.update_external_document_current = fail_first_terminal_sync
        first = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:terminal-outbox"),
        )
        durable_terminal = client.app.state.store.list()[0]
        indexed_count = len(client.app.state.indexer.mock_points)
        second = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:terminal-outbox"),
        )
        reconciled = client.app.state.store.list()[0]
        reconciled_indexed_count = len(client.app.state.indexer.mock_points)

    assert first.status_code == 502
    assert durable_terminal.job.status == JobStatus.completed
    assert durable_terminal.report is not None
    assert durable_terminal.report.status == JobStatus.completed
    assert durable_terminal.pending_external_status == "INDEXED"
    assert second.status_code == 200
    assert second.headers["Idempotency-Replayed"] == "true"
    assert reconciled.pending_external_status is None
    assert indexed_count > 0
    assert reconciled_indexed_count == indexed_count
    assert statuses == ["INGESTING", "INDEXED", "INDEXED"]


def test_web_transport_can_cancel_and_read_shared_job_with_fresh_actor_proofs(
    tmp_path: Path,
) -> None:
    source = tmp_path / "web-cancel.txt"
    source.write_text("This queued attempt is cancelled before execution.", encoding="utf-8")

    with make_client(
        tmp_path,
        {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"},
    ) as client:
        created = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:web-cancel"),
        )
        job_id = created.json()["job_id"]
        proof_confirmations: list[dict[str, str]] = []

        async def confirm_manager_proof(**kwargs):
            proof_confirmations.append(kwargs)
            if kwargs["authorization_token"].startswith("wrong-"):
                raise IngestionError(
                    "AUTHZ_DENIED",
                    "Registry denied the exact document action proof",
                    status_code=403,
                )
            return kwargs["expected_subject_id"], "iauth_manager-proof"

        client.app.state.registry.confirm_ingestion_authorization = confirm_manager_proof
        manager_headers = web_transport_headers(
            actor_subject_id="user-manager",
            authorization_proof=True,
        )
        manager_read = client.get(
            f"/api/v1/ingestion/jobs/{job_id}",
            headers=manager_headers,
        )
        wrong_proof_headers = {
            **manager_headers,
            "X-AKL-Ingestion-Authorization": (
                "wrong-registry-issued-ingestion-authorization-proof"
            ),
        }
        wrong_proof = client.get(
            f"/api/v1/ingestion/jobs/{job_id}",
            headers=wrong_proof_headers,
        )
        wrong_transport = client.get(
            f"/api/v1/ingestion/jobs/{job_id}",
            headers={
                **readiness_transport_headers(),
                "X-AKL-On-Behalf-Of": "user-manager",
                "X-AKL-Ingestion-Authorization": (
                    "mock-registry-issued-ingestion-authorization-proof"
                ),
            },
        )
        cancelled = client.post(
            f"/api/v1/ingestion/jobs/{job_id}/cancel",
            headers=manager_headers,
        )
        report = client.get(
            f"/api/v1/ingestion/jobs/{job_id}/report",
            headers=manager_headers,
        )
        stored = client.app.state.store.get(job_id)

    assert created.json()["status"] == "queued"
    assert manager_read.status_code == 200
    assert wrong_proof.status_code == 403
    assert wrong_proof.json()["error"]["code"] == "AUTHZ_DENIED"
    assert wrong_transport.status_code == 403
    assert wrong_transport.json()["error"]["code"] == "WEB_INGESTION_TRANSPORT_REQUIRED"
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert report.status_code == 200
    assert report.json()["status"] == "cancelled"
    assert stored.actor_subject_id == "user-owner"
    assert [item["action"] for item in proof_confirmations] == [
        "document.read",
        "document.read",
        "document.ingest",
        "document.read",
    ]
    assert all(
        item["expected_subject_id"] == "user-manager"
        and item["document_id"] == "doc_durable"
        and item["document_version_id"] == "ver_durable"
        for item in proof_confirmations
    )


def test_oidc_job_operations_require_exact_web_transport_not_direct_user_bearer(
    tmp_path: Path,
    monkeypatch,
) -> None:
    source = tmp_path / "oidc-transport-boundary.txt"
    source.write_text("Authenticated job operations stay behind the web transport.", encoding="utf-8")

    with make_client(
        tmp_path,
        {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"},
    ) as client:
        created = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:oidc-transport-boundary"),
        )
        job_id = created.json()["job_id"]
        client.app.state.settings = replace(
            client.app.state.settings,
            env="production",
            auth_mode="oidc",
            oidc_issuer="https://login.example/realms/stratos",
            oidc_audience="akl-api",
            oidc_jwks_url="https://login.example/realms/stratos/certs",
        )

        def verified_claims(token: str, _settings) -> dict[str, object]:
            if token == "direct-user-token":
                return {"sub": "user-direct", "roles": ["admin"]}
            assert token == "web-transport-token"
            return {
                "sub": "service-account-svc-akb-web-ingestion",
                "preferred_username": "service-account-svc-akb-web-ingestion",
                "azp": "svc-akb-web-ingestion",
                "client_id": "svc-akb-web-ingestion",
                "roles": ["service_akb_web_ingestion"],
            }

        monkeypatch.setattr("app.security._verified_oidc_claims", verified_claims)
        direct_headers = {
            "Authorization": "Bearer direct-user-token",
            "X-AKL-Ingestion-Authorization": (
                "mock-registry-issued-ingestion-authorization-proof"
            ),
        }
        direct_read = client.get(
            f"/api/v1/ingestion/jobs/{job_id}",
            headers=direct_headers,
        )
        direct_unknown = client.get(
            "/api/v1/ingestion/jobs/ing_unknown",
            headers=direct_headers,
        )
        direct_report = client.get(
            f"/api/v1/ingestion/jobs/{job_id}/report",
            headers=direct_headers,
        )
        direct_cancel = client.post(
            f"/api/v1/ingestion/jobs/{job_id}/cancel",
            headers=direct_headers,
        )

        transport_headers = {
            "Authorization": "Bearer web-transport-token",
            "X-AKL-On-Behalf-Of": "user-manager",
            "X-AKL-Ingestion-Authorization": (
                "mock-registry-issued-ingestion-authorization-proof"
            ),
        }
        transported_read = client.get(
            f"/api/v1/ingestion/jobs/{job_id}",
            headers=transport_headers,
        )
        transported_cancel = client.post(
            f"/api/v1/ingestion/jobs/{job_id}/cancel",
            headers=transport_headers,
        )
        transported_report = client.get(
            f"/api/v1/ingestion/jobs/{job_id}/report",
            headers=transport_headers,
        )

    for response in (direct_read, direct_unknown, direct_report, direct_cancel):
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "WEB_INGESTION_TRANSPORT_REQUIRED"
    assert transported_read.status_code == 200
    assert transported_cancel.status_code == 200
    assert transported_cancel.json()["status"] == "cancelled"
    assert transported_report.status_code == 200
    assert transported_report.json()["status"] == "cancelled"


def test_cancel_fails_closed_while_execution_run_lock_is_held(tmp_path: Path) -> None:
    source = tmp_path / "cancel-lock.txt"
    source.write_text("A held execution lock prevents cancellation races.", encoding="utf-8")

    with make_client(
        tmp_path,
        {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"},
    ) as client:
        created = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:cancel-lock"),
        )
        job_id = created.json()["job_id"]
        assert client.app.state.store.acquire_run(job_id) is True
        try:
            cancelled = client.post(
                f"/api/v1/ingestion/jobs/{job_id}/cancel",
                headers=actor_proof_headers("user-owner"),
            )
        finally:
            client.app.state.store.release_run(job_id)
        stored = client.app.state.store.get(job_id)

    assert cancelled.status_code == 409
    assert cancelled.json()["error"]["code"] == "JOB_EXECUTION_LEASE_ACTIVE"
    assert stored.job.status == JobStatus.queued
    assert stored.report is None


def test_cancel_intent_survives_unknown_claim_and_replay_never_executes(
    tmp_path: Path,
) -> None:
    source = tmp_path / "cancel-unknown.txt"
    source.write_text(
        "A durable cancel intent must win over a transport-unknown claim.",
        encoding="utf-8",
    )
    payload = _payload(source, "durable:cancel-unknown")
    payload.pop("expected_current_ingestion_job_id")

    with make_client(tmp_path) as client:
        registry = client.app.state.registry
        original_claim = registry.claim_external_document_attempt
        claim_count = 0
        external_statuses: list[str] = []

        async def selected(**kwargs):
            return True

        async def unknown_then_confirmed(**kwargs):
            nonlocal claim_count
            claim_count += 1
            if claim_count == 1:
                raise IngestionError(
                    "REGISTRY_UNAVAILABLE",
                    "The Registry claim response was not observed",
                    status_code=502,
                )
            return await original_claim(**kwargs)

        async def track_external_status(**kwargs):
            external_statuses.append(kwargs["ingestion_status"])

        registry.is_authoritative_attempt_selected = selected
        registry.claim_external_document_attempt = unknown_then_confirmed
        registry.update_external_document_current = track_external_status

        created = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=payload,
        )
        job_id = created.json()["job_id"]
        first_cancel = client.post(
            f"/api/v1/ingestion/jobs/{job_id}/cancel",
            headers=_create_headers(),
        )
        after_unknown = client.app.state.store.get(job_id)
        replay = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=payload,
        )
        recovered = client.app.state.store.get(job_id)

    assert created.status_code == 202
    assert created.json()["status"] == "pending_authorization"
    assert first_cancel.status_code == 502
    assert after_unknown.job.status == JobStatus.claiming
    assert after_unknown.cancel_requested is True
    assert replay.status_code == 200
    assert replay.json()["status"] == "cancelled"
    assert recovered.job.status == JobStatus.cancelled
    assert recovered.report is not None
    assert recovered.pending_external_status is None
    assert external_statuses == ["FAILED"]
    assert client.app.state.indexer.mock_points == []


def test_omitted_claim_cas_remains_pending_until_registry_selection(
    tmp_path: Path,
) -> None:
    source = tmp_path / "pending-selection.txt"
    source.write_text(
        "The local job cannot run before the Registry selects the exact attempt.",
        encoding="utf-8",
    )
    payload = _payload(source, "durable:pending-selection")
    payload.pop("expected_current_ingestion_job_id")

    with make_client(
        tmp_path,
        {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"},
    ) as client:
        selected = False
        selection_checks = 0
        claims = 0
        registry = client.app.state.registry
        original_claim = registry.claim_external_document_attempt

        async def selection(**_kwargs):
            nonlocal selection_checks
            selection_checks += 1
            return selected

        async def track_claim(**kwargs):
            nonlocal claims
            claims += 1
            return await original_claim(**kwargs)

        registry.is_authoritative_attempt_selected = selection
        registry.claim_external_document_attempt = track_claim
        created = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=payload,
        )
        job_id = created.json()["job_id"]
        persisted = client.app.state.store.get(job_id)

        asyncio.run(_recover_durable_jobs(client.app))
        still_pending = client.app.state.store.get(job_id)
        selected = True
        asyncio.run(_recover_durable_jobs(client.app))
        activated = client.app.state.store.get(job_id)

    assert created.status_code == 202
    assert persisted.authoritative_claim_requested is False
    assert still_pending.job.status == JobStatus.pending_authorization
    assert activated.job.status == JobStatus.queued
    assert selection_checks == 2
    assert claims == 1


def test_omitted_and_explicit_null_claim_cas_are_distinct_idempotent_requests(
    tmp_path: Path,
) -> None:
    source = tmp_path / "claim-shape.txt"
    source.write_text(
        "Omitting the CAS field is semantically different from an explicit null CAS.",
        encoding="utf-8",
    )
    omitted = _payload(source, "durable:claim-shape")
    omitted.pop("expected_current_ingestion_job_id")
    explicit = {**omitted, "expected_current_ingestion_job_id": None}

    with make_client(
        tmp_path,
        {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"},
    ) as client:
        async def not_selected(**_kwargs):
            return False

        client.app.state.registry.is_authoritative_attempt_selected = not_selected
        first = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=omitted,
        )
        second = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=explicit,
        )
        stored = client.app.state.store.get(first.json()["job_id"])

    assert first.status_code == 202
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert stored.authoritative_claim_requested is False
    assert stored.job.status == JobStatus.pending_authorization


def test_recovery_quarantines_tampered_durable_request_hash(tmp_path: Path) -> None:
    source = tmp_path / "authorized-source.txt"
    source.write_text("The authorized immutable source.", encoding="utf-8")
    tampered_source = tmp_path / "tampered-source.txt"
    tampered_source.write_text("This source was never authorized.", encoding="utf-8")

    with make_client(
        tmp_path,
        {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"},
    ) as client:
        created = client.post(
            "/api/v1/ingestion/jobs",
            headers=_create_headers(),
            json=_payload(source, "durable:tampered-lineage"),
        )
        job_id = created.json()["job_id"]
        job_path = tmp_path / "jobs" / f"{job_id}.json"
        persisted = json.loads(job_path.read_text(encoding="utf-8"))
        persisted["request"]["source_file_uri"] = str(tampered_source)
        job_path.write_text(json.dumps(persisted), encoding="utf-8")

        asyncio.run(_recover_durable_jobs(client.app))
        quarantined = client.app.state.store.get(job_id)

    assert quarantined.job.status == JobStatus.failed
    assert quarantined.report is not None
    assert quarantined.report.errors[0].code == "DURABLE_AUTHORIZATION_LINEAGE_MISSING"
    assert client.app.state.indexer.mock_points == []
