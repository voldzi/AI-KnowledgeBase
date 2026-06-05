from __future__ import annotations

from tests.conftest import make_client


def _query_payload(query: str, *, classification_max: str = "internal") -> dict[str, object]:
    return {
        "subject_id": "user_123",
        "query": query,
        "filters": {
            "document_types": ["directive", "methodology", "knowledge_base_article", "policy"],
            "only_valid": True,
            "classification_max": classification_max,
            "tags": [],
        },
        "answer_mode": "normative_with_citations",
        "max_chunks": 4,
    }


def test_query_returns_answer_with_citation_from_authorized_chunk() -> None:
    with make_client() as client:
        response = client.post("/api/v1/rag/query", json=_query_payload("Kdo schvaluje vyjimku?"))

    assert response.status_code == 200
    body = response.json()
    assert body["confidence"] in {"medium", "high"}
    assert body["citations"] == [
        {
            "document_id": "doc_123",
            "document_version_id": "ver_456",
            "document_title": "Smernice pro spravu dokumentu",
            "version_label": "1.0",
            "document_version": "1.0",
            "section_path": ["Cl. 4", "Odst. 2"],
            "page_number": 7,
            "chunk_id": "chunk_789",
        }
    ]
    assert body["used_chunks"] == ["chunk_789"]
    assert "Vyjimku ze smernice schvaluje gestor dokumentu" in body["answer"]


def test_query_accepts_phase_02_user_id_alias() -> None:
    payload = _query_payload("Kdo schvaluje vyjimku?")
    payload["user_id"] = payload.pop("subject_id")
    with make_client() as client:
        response = client.post("/api/v1/rag/query", json=payload)

    assert response.status_code == 200
    assert response.json()["citations"][0]["chunk_id"] == "chunk_789"


def test_query_applies_no_answer_policy_for_low_relevance() -> None:
    with make_client() as client:
        response = client.post("/api/v1/rag/query", json=_query_payload("xyzzy plugh abrakadabra"))

    assert response.status_code == 200
    body = response.json()
    assert body["confidence"] == "insufficient_source"
    assert body["citations"] == []
    assert body["used_chunks"] == []
    assert "LOW_RELEVANCE" in body["warnings"]


def test_query_filters_denied_documents_before_answer_composition_in_registry_authz_mode() -> None:
    with make_client({"RAG_AUTHZ_MODE": "registry", "AKL_RAG_REGISTRY_CLIENT_MODE": "mock"}) as client:
        response = client.post(
            "/api/v1/rag/query",
            json=_query_payload("tajne pravidlo pro krizove vyjimky", classification_max="confidential"),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["confidence"] == "insufficient_source"
    assert body["citations"] == []
    assert "AUTHZ_FILTERED_SOURCES" in body["warnings"]


def test_retrieve_returns_authorized_reranked_chunks() -> None:
    payload = _query_payload("Kdo schvaluje vyjimku?")
    payload.pop("answer_mode")
    with make_client() as client:
        response = client.post("/api/v1/rag/retrieve", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["query_id"].startswith("query_")
    assert body["chunks"][0]["chunk_id"] == "chunk_789"
    assert body["chunks"][0]["retrieval_method"] == "hybrid"


def test_compare_documents_is_explicitly_out_of_scope() -> None:
    with make_client() as client:
        response = client.post("/api/v1/rag/compare-documents", json={})

    assert response.status_code == 501
    assert response.json()["error"]["code"] == "NOT_IMPLEMENTED"


def test_oidc_auth_mode_requires_bearer_token() -> None:
    with make_client({"AKL_AUTH_MODE": "oidc"}) as client:
        response = client.post("/api/v1/rag/query", json=_query_payload("Kdo schvaluje vyjimku?"))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
