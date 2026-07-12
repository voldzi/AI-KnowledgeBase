from __future__ import annotations

from tests.conftest import make_client


def _payload(**overrides):
    payload = {
        "tenant_id": "tenant-a",
        "external_system": "STRATOS_BUDGET",
        "external_ref": "contract:256-2022-S:main",
        "entity_type": "Contract",
        "entity_id": "contract-uuid",
        "document_id": "doc_contract",
        "document_version_id": "ver_contract_1",
        "subject_id": "budget-user",
        "profile": "contract_financial_v1",
        "profile_version": "1",
        "classification_max": "internal",
        "context_tags": ["budget-contract:contract-uuid"],
        "max_chunks": 12,
    }
    payload.update(overrides)
    return payload


def test_contract_extraction_profiles_are_available() -> None:
    with make_client() as client:
        response = client.get("/api/v1/stratos/extractions/profiles")

    assert response.status_code == 200
    body = response.json()
    assert body["profiles"][0]["profile"] == "contract_financial_v1"
    assert "payment_schedule" in body["profiles"][0]["fields"]


def test_contract_extraction_proposes_cited_financial_fields() -> None:
    with make_client() as client:
        response = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] in {"PROPOSED", "PARTIAL"}
    fields = {proposal["field"]: proposal for proposal in body["proposals"]}
    assert fields["contract_number"]["proposed_value"] == "256-2022-S"
    assert fields["supplier_name"]["proposed_value"] == "AUTOCONT a.s"
    assert fields["customer_name"]["proposed_value"] == "Město Železná Lhota"
    assert fields["total_amount_without_vat"]["normalized_value"] == 1200000
    assert fields["payment_due_days"]["normalized_value"] == 30
    assert fields["currency"]["normalized_value"] == "CZK"
    assert fields["contract_number"]["citation"]["chunk_id"] == "chunk_contract_1"
    assert fields["contract_number"]["citation"]["viewer_url"].startswith("/akb/documents/doc_contract")
    assert "chunk_contract_1" in body["source_chunk_ids"]


def test_contract_extraction_targets_the_requested_document_and_allows_draft_versions(monkeypatch) -> None:
    from app.service import RagRetrievalService

    captured = {}
    original = RagRetrievalService._retrieve_authorized

    async def capture_retrieval(self, *, payload, query_id, auth_context=None):
        captured["filters"] = payload.filters
        return await original(self, payload=payload, query_id=query_id, auth_context=auth_context)

    monkeypatch.setattr(RagRetrievalService, "_retrieve_authorized", capture_retrieval)
    with make_client() as client:
        response = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())

    assert response.status_code == 200, response.text
    assert captured["filters"].document_ids == ["doc_contract"]
    assert captured["filters"].only_valid is False


def test_contract_extraction_is_idempotent_for_same_document_version() -> None:
    with make_client() as client:
        first = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())
        second = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["extraction_id"] == first.json()["extraction_id"]


def test_contract_extraction_get_returns_stored_result() -> None:
    with make_client() as client:
        created = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())
        extraction_id = created.json()["extraction_id"]
        fetched = client.get(f"/api/v1/stratos/extractions/{extraction_id}")

    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["extraction_id"] == extraction_id
    assert fetched.json()["proposals"]


def test_contract_extraction_feedback_marks_source_app_status() -> None:
    with make_client() as client:
        created = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())
        extraction_id = created.json()["extraction_id"]
        feedback = client.post(
            f"/api/v1/stratos/extractions/{extraction_id}/feedback",
            json={
                "field": "contract_number",
                "ai_value": "256-2022-S",
                "final_value": "256-2022-S",
                "decision": "edited",
                "reason": "Budget normalized formatting",
                "actor": "budget-approver",
                "source_app": "STRATOS_BUDGET",
                "source_entity_id": "contract-uuid",
            },
        )

    assert feedback.status_code == 200, feedback.text
    assert feedback.json()["feedback_id"].startswith("extfb_")
    assert feedback.json()["extraction"]["status"] == "ACCEPTED_IN_SOURCE_APP"


def test_contract_extraction_returns_partial_when_target_document_has_no_citable_fields() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=_payload(
                external_ref="contract:unknown:main",
                document_id="doc_missing",
                document_version_id="ver_missing",
                context_tags=[],
            ),
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "PARTIAL"
    assert body["proposals"] == []
    assert "TARGET_DOCUMENT_NOT_RETRIEVED" in body["warnings"]


def test_contract_extraction_permission_denied_when_target_document_is_denied() -> None:
    with make_client(
        {
            "AKL_RAG_AUTHZ_MODE": "registry",
            "AKL_RAG_REGISTRY_CLIENT_MODE": "mock",
            "AKL_RAG_MOCK_DENIED_DOCUMENT_IDS": "doc_contract",
        }
    ) as client:
        response = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=_payload(
                external_ref="contract:denied:main",
            ),
        )

    assert response.status_code == 403


def test_contract_extraction_supersedes_previous_version_in_registry_client() -> None:
    with make_client() as client:
        first = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())
        second = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=_payload(
                document_version_id="ver_contract_2",
                metadata={"test": "new version without indexed chunks"},
            ),
        )
        fetched_first = client.get(f"/api/v1/stratos/extractions/{first.json()['extraction_id']}")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert fetched_first.status_code == 200, fetched_first.text
    assert fetched_first.json()["status"] == "SUPERSEDED"


def test_contract_extraction_tenant_identity_is_isolated() -> None:
    with make_client() as client:
        first = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload(tenant_id="tenant-a"))
        second = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload(tenant_id="tenant-b"))

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["extraction_id"] != second.json()["extraction_id"]
