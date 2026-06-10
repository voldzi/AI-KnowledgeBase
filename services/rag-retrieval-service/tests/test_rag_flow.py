from __future__ import annotations

from app.service import _employee_answer
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


def test_query_rejects_removed_user_id_alias() -> None:
    payload = _query_payload("Kdo schvaluje vyjimku?")
    payload["user_id"] = payload.pop("subject_id")
    with make_client() as client:
        response = client.post("/api/v1/rag/query", json=payload)

    assert response.status_code == 422


def test_query_applies_no_answer_policy_for_low_relevance() -> None:
    with make_client() as client:
        response = client.post("/api/v1/rag/query", json=_query_payload("xyzzy plugh abrakadabra"))

    assert response.status_code == 200
    body = response.json()
    assert body["confidence"] == "insufficient_source"
    assert body["citations"] == []
    assert body["used_chunks"] == []
    assert "LOW_RELEVANCE" in body["warnings"]


def test_query_respects_english_response_language() -> None:
    payload = _query_payload("Kdo schvaluje vyjimku?")
    payload["response_language"] = "en"
    with make_client() as client:
        response = client.post("/api/v1/rag/query", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["citations"][0]["chunk_id"] == "chunk_789"
    assert body["answer"].startswith("According to the cited sources:")


def test_no_answer_respects_english_response_language() -> None:
    payload = _query_payload("xyzzy plugh abrakadabra")
    payload["response_language"] = "en"
    with make_client() as client:
        response = client.post("/api/v1/rag/query", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["confidence"] == "insufficient_source"
    assert body["answer"] == "No sufficiently reliable source was found in the allowed documents for this question."
    assert body["missing_information"] == "The best retrieved source is not relevant enough."


def test_query_filters_denied_documents_before_answer_composition_in_registry_authz_mode() -> None:
    with make_client({"AKL_RAG_AUTHZ_MODE": "registry", "AKL_RAG_REGISTRY_CLIENT_MODE": "mock"}) as client:
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


def test_open_citation_returns_source_context_for_chunk() -> None:
    with make_client() as client:
        response = client.get("/api/v1/citations/chunk_789/open?subject_id=user_123")

    assert response.status_code == 200
    body = response.json()
    assert body["chunk_id"] == "chunk_789"
    assert body["document_id"] == "doc_123"
    assert body["source_file_uri"] == "s3://akl-documents/doc_123/ver_456/source.md"
    assert body["source_mime_type"] == "text/markdown"
    assert body["viewer_mode"] == "markdown"
    assert "Vyjimku ze smernice schvaluje gestor" in body["chunk_text"]
    assert body["location"]["page_number"] == 7


def test_assistant_chat_requests_clarification_for_vague_access_query() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/assistant/chat",
            json={
                "user_id": "employee_1",
                "message": "Potřebuji přístup.",
                "context": {"domain": "IT", "user_role": "employee"},
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["response_type"] == "clarification_needed"
    assert body["conversation_id"].startswith("conv_")
    assert {question["id"] for question in body["questions"]} >= {"system", "request_type"}


def test_assistant_chat_rejects_removed_subject_id_alias() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/assistant/chat",
            json={
                "subject_id": "employee_1",
                "message": "Potřebuji přístup.",
                "context": {"domain": "IT", "user_role": "employee"},
            },
        )

    assert response.status_code == 422


def test_assistant_chat_requests_clarification_in_english() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/assistant/chat",
            json={
                "user_id": "employee_1",
                "message": "I need access.",
                "context": {"domain": "IT", "user_role": "employee"},
                "response_language": "en",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["response_type"] == "clarification_needed"
    assert body["message"] == "I need to clarify the question."
    assert any(question["question"] == "Which system is this about?" for question in body["questions"])


def test_assistant_chat_returns_cited_answer_when_context_is_specific() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/assistant/chat",
            json={
                "user_id": "employee_1",
                "message": "Kdo schvaluje výjimku ze směrnice?",
                "context": {"approval_subject": "výjimka ze směrnice"},
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["response_type"] == "answer"
    assert body["citations"][0]["chunk_id"] == "chunk_789"


def test_employee_answer_hides_internal_citation_markers_and_markdown() -> None:
    raw = (
        "Architektura je **distribuovaná sada služeb** [chunk_abc123, chunk_def456].\n\n"
        "* **Infrastruktura:** Obsahuje registry-api, rag-retrieval-service, Qdrant a MinIO [chunk_ghi789]."
    )

    cleaned = _employee_answer(raw)

    assert "chunk_" not in cleaned
    assert "**" not in cleaned
    assert "registry-api" not in cleaned
    assert "rag-retrieval-service" not in cleaned
    assert "Qdrant" not in cleaned
    assert "MinIO" not in cleaned
    assert cleaned == (
        "Architektura je distribuovaná sada služeb.\n"
        "- Infrastruktura: Obsahuje registr dokumentů, vyhledávání ve znalostech, vyhledávací index a úložiště dokumentů."
    )


def test_compare_documents_forwards_to_governance(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_forward(*, dependency, settings, method, url, json_body=None, auth_context=None, prefer_upstream_token=False):
        captured["dependency"] = dependency
        captured["method"] = method
        captured["url"] = url
        captured["json_body"] = json_body
        return {"result_id": "cmp_test", "summary": "ok"}

    import app.main as main_module

    monkeypatch.setattr(main_module, "request_json_with_retry", fake_forward)
    with make_client() as client:
        response = client.post(
            "/api/v1/rag/compare-documents",
            json={"subject_id": "user_123", "left_version": {}, "right_version": {}},
        )

    assert response.status_code == 200
    assert response.json()["result_id"] == "cmp_test"
    assert captured["dependency"] == "governance"
    assert captured["method"] == "POST"
    assert str(captured["url"]).endswith("/governance/compare-versions")


def test_check_compliance_forwards_to_governance(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_forward(*, dependency, settings, method, url, json_body=None, auth_context=None, prefer_upstream_token=False):
        captured["url"] = url
        return {"result_id": "cc_test", "status": "compliant"}

    import app.main as main_module

    monkeypatch.setattr(main_module, "request_json_with_retry", fake_forward)
    with make_client() as client:
        response = client.post(
            "/api/v1/rag/check-compliance",
            json={"subject_id": "user_123", "draft": {}},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "compliant"
    assert str(captured["url"]).endswith("/governance/check-compliance")


def test_oidc_auth_mode_requires_bearer_token() -> None:
    with make_client({"AKL_AUTH_MODE": "oidc"}) as client:
        response = client.post("/api/v1/rag/query", json=_query_payload("Kdo schvaluje vyjimku?"))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
