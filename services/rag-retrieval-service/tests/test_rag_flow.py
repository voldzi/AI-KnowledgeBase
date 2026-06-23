from __future__ import annotations

from app.service import (
    _assistant_answer_query,
    _assistant_filters,
    _assistant_query,
    _employee_answer,
    _fallback_follow_up_questions,
    _parse_follow_up_questions,
)
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
    assert body["report_artifacts"] == []


def test_assistant_chat_returns_report_artifact_for_table_request() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/assistant/chat",
            json={
                "user_id": "employee_1",
                "message": "Vytvoř tabulkovou sestavu do Excelu: kdo schvaluje výjimku ze směrnice?",
                "context": {"approval_subject": "výjimka ze směrnice"},
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["response_type"] == "answer"
    assert body["report_artifacts"][0]["artifact_id"].startswith("rpt_")
    assert body["report_artifacts"][0]["columns"][0]["key"] == "topic"
    assert body["report_artifacts"][0]["export_formats"] == ["xlsx", "pdf"]
    assert body["report_artifacts"][0]["rows"][0]["citations"][0]["chunk_id"] == "chunk_789"
    assert body["suggested_actions"][0]["action_type"] == "export_report"


def test_assistant_chat_returns_actionable_follow_up_questions() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/assistant/chat",
            json={
                "user_id": "employee_1",
                "message": "Kdo schvaluje vyjimku ze smernice?",
                "context": {"approval_subject": "výjimka ze směrnice"},
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["response_type"] == "answer"
    assert body["follow_up_questions"]
    assert all(item.endswith("?") for item in body["follow_up_questions"])
    assert not any("otevřít" in item.lower() for item in body["follow_up_questions"])


def test_follow_up_parser_accepts_llm_json_only_questions() -> None:
    raw = '["Jaké povinnosti z toho vyplývají pro vlastníka systému?", "Můžeš připravit kontrolní seznam?"]'

    assert _parse_follow_up_questions(raw) == [
        "Jaké povinnosti z toho vyplývají pro vlastníka systému?",
        "Můžeš připravit kontrolní seznam?",
    ]


def test_follow_up_parser_rejects_generic_open_source_actions() -> None:
    raw = '["Chcete otevřít zdrojový dokument?", "Jaký postup má následovat?"]'

    assert _parse_follow_up_questions(raw) == ["Jaký postup má následovat?"]


def test_fallback_followups_are_questions_not_actions() -> None:
    questions = _fallback_follow_up_questions("Jaké jsou základní informace k architektuře?", "cs")

    assert len(questions) == 3
    assert all(item.endswith("?") for item in questions)
    assert not any("otevřít" in item.lower() for item in questions)


def test_assistant_query_omits_internal_report_context_from_retrieval() -> None:
    context = {
        "approval_subject": "výjimka ze směrnice",
        "answer_format_instruction": "Vrať tabulku se sloupci povinnost, zdroj a poznámka.",
        "assistant_query_plan": {"intent": "obligation_table", "noise": "xyzzy plugh"},
        "assistant_report_request": {"template": "obligation_table"},
    }

    retrieval_query = _assistant_query("Kdo schvaluje výjimku ze směrnice?", context)
    answer_query = _assistant_answer_query("Kdo schvaluje výjimku ze směrnice?", context)

    assert "approval_subject" in retrieval_query
    assert "answer_format_instruction" not in retrieval_query
    assert "assistant_query_plan" not in retrieval_query
    assert "assistant_report_request" not in retrieval_query
    assert "xyzzy" not in retrieval_query
    assert "Požadavek na formát odpovědi" in answer_query
    assert "Vrať tabulku" in answer_query
    assert "assistant_query_plan" not in answer_query


def test_assistant_chat_report_context_does_not_degrade_retrieval() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/assistant/chat",
            json={
                "user_id": "employee_1",
                "message": "Vytvoř tabulku: kdo schvaluje výjimku ze směrnice?",
                "context": {
                    "approval_subject": "výjimka ze směrnice",
                    "answer_format_instruction": (
                        "Požadavek na strukturovaný výstup: vrať markdown tabulku se sloupci "
                        "povinnost, citovaný zdroj a praktická poznámka."
                    ),
                    "assistant_query_plan": {
                        "intent": "obligation_table",
                        "output": {"required_columns": ["povinnost", "zdroj", "poznámka"]},
                    },
                    "assistant_report_request": {"template": "obligation_table"},
                },
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["response_type"] == "answer"
    assert body["citations"][0]["chunk_id"] == "chunk_789"
    assert body["confidence"] != "insufficient_source"


def test_assistant_filters_include_pdf_corpus_document_types() -> None:
    filters = _assistant_filters({})

    assert "regulation" in filters.document_types
    assert "other" in filters.document_types


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


def test_query_stream_returns_sse_with_meta_and_done_events() -> None:
    with make_client() as client:
        response = client.post("/api/v1/rag/query-stream", json=_query_payload("Kdo schvaluje vyjimku?"))

    assert response.status_code == 200
    assert "text/event-stream" in response.headers.get("content-type", "")
    events = _parse_sse_events(response.text)
    kinds = [evt.get("kind") for evt in events]
    assert "meta" in kinds
    assert "done" in kinds
    done = next(evt for evt in events if evt.get("kind") == "done")
    assert done["answer"]["query_id"].startswith("query_")
    assert done["answer"]["confidence"] in {"high", "medium", "low", "insufficient_source"}


def test_query_stream_no_answer_yields_single_done_event() -> None:
    with make_client() as client:
        response = client.post("/api/v1/rag/query-stream", json=_query_payload("xyzzy plugh abrakadabra"))

    assert response.status_code == 200
    events = _parse_sse_events(response.text)
    kinds = [evt.get("kind") for evt in events]
    assert kinds == ["done"]
    assert events[0]["answer"]["confidence"] == "insufficient_source"
    assert events[0]["answer"]["answer"] == "K dotazu nebyl nalezen dostatečně důvěryhodný zdroj v povolených dokumentech."


def _parse_sse_events(body: str) -> list[dict[str, object]]:
    import json

    events: list[dict[str, object]] = []
    for line in body.splitlines():
        if line.startswith("data: "):
            raw = line[6:].strip()
            if raw:
                events.append(json.loads(raw))
    return events


def test_assistant_conversation_round_trip_is_persisted() -> None:
    with make_client() as client:
        chat = client.post(
            "/api/v1/assistant/chat",
            json={
                "user_id": "employee_1",
                "message": "Kdo schvaluje výjimku ze směrnice?",
                "context": {"approval_subject": "výjimka ze směrnice"},
            },
        )
        assert chat.status_code == 200
        conversation_id = chat.json()["conversation_id"]

        fetched = client.get(f"/api/v1/assistant/conversations/{conversation_id}")

    assert fetched.status_code == 200
    body = fetched.json()
    assert body["status"] == "persisted"
    roles = [message["role"] for message in body["messages"]]
    assert roles == ["user", "assistant"]
    assert body["warnings"] == []


def test_unknown_assistant_conversation_reports_ephemeral() -> None:
    with make_client() as client:
        response = client.get("/api/v1/assistant/conversations/conv_unknown")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ephemeral"
    assert "CONVERSATION_HISTORY_NOT_PERSISTED" in body["warnings"]


def test_oidc_auth_mode_requires_bearer_token() -> None:
    with make_client({"AKL_AUTH_MODE": "oidc"}) as client:
        response = client.post("/api/v1/rag/query", json=_query_payload("Kdo schvaluje vyjimku?"))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
