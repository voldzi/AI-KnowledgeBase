from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from app.ids import utcnow
from app.main import _can_list_all_jobs
from app.schemas import EntityFacetReport
from app.security import AuthContext
from tests.conftest import make_client


def _actor_headers(*, proof: bool) -> dict[str, str]:
    headers = {
        "X-AKL-Subject": "user-reader",
        "X-AKL-Roles": "reader",
        "X-Correlation-ID": "corr-intelligence-exact",
    }
    if proof:
        headers.update(
            {
                "X-AKL-Intelligence-Authorization": "registry-intelligence-proof-token-0001",
                "X-AKL-Intelligence-Idempotency-Key": "intelligence:query:exact",
            }
        )
    return headers


def test_intelligence_search_requires_and_confirms_exact_registry_scope(
    tmp_path: Path,
) -> None:
    with make_client(tmp_path) as client:
        confirmations: list[dict[str, object]] = []

        async def confirm(**kwargs):
            confirmations.append(kwargs)
            return kwargs["expected_subject_id"], "iscope_confirmed"

        client.app.state.registry.confirm_intelligence_scope_authorization = confirm
        payload = {
            "query": "contract",
            "allowed_document_ids": ["doc_b", "doc_a"],
            "authorized_documents": [
                {
                    "document_id": "doc_b",
                    "document_version_id": "ver_b",
                    "policy_hash": "sha256:" + "b" * 64,
                },
                {
                    "document_id": "doc_a",
                    "document_version_id": "ver_a",
                    "policy_hash": "sha256:" + "a" * 64,
                },
            ],
        }
        missing = client.post(
            "/api/v1/intelligence/entities/search",
            headers=_actor_headers(proof=False),
            json=payload,
        )
        allowed = client.post(
            "/api/v1/intelligence/entities/search",
            headers=_actor_headers(proof=True),
            json=payload,
        )

    assert missing.status_code == 403
    assert missing.json()["error"]["code"] == "DOCUMENT_SCOPE_AUTHORIZATION_PROOF_REQUIRED"
    assert allowed.status_code == 200
    assert confirmations == [
        {
            "authorization_token": "registry-intelligence-proof-token-0001",
            "expected_subject_id": "user-reader",
            "documents": [
                {
                    "document_id": "doc_a",
                    "document_version_id": "ver_a",
                    "policy_hash": "sha256:" + "a" * 64,
                },
                {
                    "document_id": "doc_b",
                    "document_version_id": "ver_b",
                    "policy_hash": "sha256:" + "b" * 64,
                },
            ],
            "correlation_id": "corr-intelligence-exact",
            "idempotency_key": "intelligence:query:exact",
        }
    ]


def test_entity_facets_are_filtered_to_the_confirmed_document_scope(
    tmp_path: Path,
) -> None:
    with make_client(tmp_path) as client:
        captured_document_ids: list[str] = []

        async def confirm(**kwargs):
            return kwargs["expected_subject_id"], "iscope_confirmed"

        class ScopedIndexer:
            async def entity_facets(self, **kwargs):
                captured_document_ids.extend(
                    item["document_id"] for item in kwargs["authorized_documents"]
                )
                return EntityFacetReport(
                    status="ready",
                    index_name="test-index",
                    total_chunks=0,
                    chunks_with_entities=0,
                    generated_at=utcnow(),
                )

        client.app.state.registry.confirm_intelligence_scope_authorization = confirm
        client.app.state.indexer = ScopedIndexer()
        response = client.post(
            "/api/v1/intelligence/entities/facets/query",
            headers=_actor_headers(proof=True),
            json={
                "authorized_documents": [
                    {
                        "document_id": "doc_b",
                        "document_version_id": "ver_b",
                        "policy_hash": "sha256:" + "b" * 64,
                    },
                    {
                        "document_id": "doc_a",
                        "document_version_id": "ver_a",
                        "policy_hash": "sha256:" + "a" * 64,
                    },
                ],
                "limit": 8,
                "value_limit": 8,
            },
        )

    assert response.status_code == 200
    assert captured_document_ids == ["doc_a", "doc_b"]


def test_static_admin_role_is_not_production_global_intelligence_authority(
    tmp_path: Path,
) -> None:
    with make_client(tmp_path) as client:
        settings = replace(client.app.state.settings, auth_mode="oidc")
    admin = AuthContext(
        subject_id="user-admin",
        roles=("admin", "document_manager"),
        groups=(),
    )

    assert _can_list_all_jobs(admin, settings) is False
