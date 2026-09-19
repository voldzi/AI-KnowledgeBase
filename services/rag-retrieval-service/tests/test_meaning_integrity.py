from datetime import date

import pytest

from app.config import load_settings
from app.registry_client import MockRegistryClient
from app.schemas import RagQueryFilters, RetrieveRequest
from app.service import RagRetrievalService, _deduplicate_chunks, _employee_answer, _fallback_follow_up_questions
from retrievers.query_analysis import analyze_query
from retrievers.scoring import query_without_document_identifiers
from tests.test_rag_v2 import _chunk


def test_parent_answer_requires_fresh_authorization_and_exact_message():
    from app.service import _available_document_parent_answer, _available_citation_scope
    source = {"document_id": "document", "document_version_id": "version"}
    messages = [{"role": "assistant", "message_id": "first", "availability": "available",
                 "content": "1. První bod. 2. Druhý bod.", "citations": [source]}]
    assert _available_document_parent_answer(messages, parent_message_id="first") == messages[0]["content"]
    assert _available_document_parent_answer(messages, parent_message_id="missing") is None
    messages.append({"role": "assistant", "message_id": "second", "availability": "available",
                     "content": "Nové téma", "citations": []})
    assert _available_document_parent_answer(messages, parent_message_id=None) is None
    assert _available_citation_scope(messages, parent_message_id=None)[-1] is False
    messages[0]["availability"] = "source_access_changed"
    assert _available_document_parent_answer(messages, parent_message_id="first") is None
    assert _available_citation_scope(messages, parent_message_id="first")[-1] is False


@pytest.mark.parametrize("left,right", [
    ("Žadatel musí dodat podklady do 30 dnů.", "Žadatel musí dodat podklady do 60 dnů."),
    ("Uživatel smí data zveřejnit.", "Uživatel nesmí data zveřejnit."),
    ("Cena služby je 5 EUR měsíčně.", "Cena služby je 5 CZK měsíčně."),
    ("§ 1", "§ 2"),
])
def test_distinct_provisions_are_never_removed_as_near_duplicates(left, right):
    chunks, removed = _deduplicate_chunks([_chunk("a", "doc", left), _chunk("b", "doc", right)])
    assert [chunk.text for chunk in chunks] == [left, right]
    assert removed == 0


def test_exact_duplicate_dedup_keeps_other_sections_and_versions():
    first = _chunk("a", "doc", "Přístup je povolen.")
    duplicate = _chunk("b", "doc", "Přístup je povolen.")
    other_section = _chunk("c", "doc", first.text)
    other_section.citation.section_path = ["Příloha 2"]
    other_version = _chunk("d", "doc", first.text, version="ver_2")
    chunks, removed = _deduplicate_chunks([first, duplicate, other_section, other_version])
    assert [chunk.chunk_id for chunk in chunks] == ["a", "c", "d"]
    assert removed == 1


def test_identical_text_keeps_distinct_documents_pages_and_table_locators():
    first = _chunk("first", "one", "Cena 30 Kč.")
    other_document = _chunk("second", "two", first.text)
    other_page = _chunk("third", "one", first.text)
    other_page.citation.page_number = 2
    other_table = _chunk("fourth", "one", first.text)
    other_table.metadata["source_locator"] = {"table": "annual-prices"}
    chunks, removed = _deduplicate_chunks([first, other_document, other_page, other_table])
    assert len(chunks) == 4
    assert removed == 0


@pytest.mark.parametrize("question", [
    "Co upravuje zákon 134/2016?",
    "Jaké povinnosti podle 134/2016 Sb. platí dnes?",
])
def test_exact_source_survives_natural_wording_and_current_date(question):
    plan = analyze_query(question, RagQueryFilters(), default_candidate_limit=64, default_dense_weight=0.35)
    assert plan.profile == "exact"


def test_ranking_query_preserves_comparison_and_original_czech():
    comparison = "Porovnej 134/2016 Sb. a 89/2012 Sb."
    assert query_without_document_identifiers(comparison) == comparison
    question = "Jaké jsou podmínky podle 134/2016 Sb. v § 6?"
    result = query_without_document_identifiers(question)
    assert "Jaké jsou podmínky podle" in result
    assert "§ 6" in result
    assert "134/2016" not in result


def test_explicit_topic_change_does_not_import_previous_document_identifiers():
    from app.service import _assistant_query
    question = "Nyní jiné téma: jaké zdroje máš k zákonu č. 89/1995 Sb.?"
    result = _assistant_query(question, {"earlier_user_questions": [
        "Jaké jsou hlavní zásady podle zákona č. 134/2016 Sb.?",
        "Vysvětli tuto odpověď.",
    ]})
    assert result == question
    assert "134/2016" not in result


def test_explicit_comparison_with_previous_source_retains_reference_context():
    from app.service import _assistant_query
    result = _assistant_query(
        "Porovnej tento zákon se zákonem 89/2012 Sb.",
        {"earlier_user_questions": ["Co upravuje zákon 134/2016 Sb.?"]},
        include_retrieval_hint=False,
    )
    assert "134/2016" in result and "89/2012" in result


def test_today_is_an_explicit_date_not_permission_for_historical_fallback():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.service import _assistant_valid_on
    assert _assistant_valid_on({}, "Co dnes ukládá zákon 134/2016?") == datetime.now(ZoneInfo("Europe/Prague")).date()


def test_bare_statute_identifier_does_not_select_an_amendment_mention():
    from app.service import _apply_exact_identifier_scope
    source = _chunk("source", "law", "Znění")
    source.citation.document_title = "134/2016 Sb. Zákon"
    amendment = _chunk("amendment", "other", "Novela")
    amendment.citation.document_title = "100/2020 Sb. změna zákona 134/2016"
    chunks, document_id = _apply_exact_identifier_scope("Co upravuje 134/2016?", [source, amendment])
    assert document_id == "law"
    assert chunks == [source]


def test_rendering_preserves_technology_and_parenthetical_conditions():
    answer = "**Podpora:** PostgreSQL (pro Docker jen do 30. 9.) a Qdrant nejsou zaměnitelné."
    assert _employee_answer(answer) == answer


def test_fallback_suggestions_cannot_recursively_embed_the_previous_question():
    first = _fallback_follow_up_questions("Jaké povinnosti má dodavatel?")
    for question in first:
        assert _fallback_follow_up_questions(question) == first
        assert len(question) < 100


@pytest.mark.asyncio
@pytest.mark.parametrize("explicit_date", [date(2020, 1, 1), date(2030, 1, 1)])
async def test_exact_lookup_never_discards_requested_date(explicit_date):
    filters_seen = []

    class Retriever:
        async def resolve_exact_candidates(self, *, query, filters, limit):
            filters_seen.append(filters)
            return []

        async def retrieve(self, **kwargs):
            filters_seen.append(kwargs["filters"])
            return []

    class Llm:
        async def embeddings(self, queries, **kwargs):
            return [[0.1, 0.2]]

    class Reranker:
        async def rerank(self, *, query, chunks, limit):
            return chunks[:limit], []

    settings = load_settings({"AKL_ENV": "test", "AKL_AUTH_MODE": "disabled", "AKL_RAG_DEPENDENCY_MODE": "mock", "AKL_RAG_AUTHZ_MODE": "dev"})
    service = object.__new__(RagRetrievalService)
    service._settings = settings
    service._registry_client = MockRegistryClient(settings)
    service._retriever = Retriever()
    service._llm_client = Llm()
    service._reranker = Reranker()
    result = await service._retrieve_authorized(
        payload=RetrieveRequest(subject_id="test", query="134/2016 Sb.", filters=RagQueryFilters(valid_on=explicit_date), max_chunks=8),
        query_id="explicit-date", expand_parent=False,
    )
    assert result.response.chunks == []
    assert filters_seen and all(item.valid_on == explicit_date for item in filters_seen)
    assert "HISTORICAL_EXACT_SOURCE_APPLIED" not in result.response.warnings


@pytest.mark.asyncio
async def test_followup_keeps_full_evidence_budget_for_one_source():
    evidence = [_chunk(f"c{i}", "doc", f"Ustanovení {i}: povinnost číslo {i}.") for i in range(8)]

    class Retriever:
        async def retrieve(self, **kwargs):
            return evidence

    class Llm:
        async def embeddings(self, queries, **kwargs):
            return [[0.1, 0.2]]

    class Reranker:
        async def rerank(self, *, query, chunks, limit):
            return chunks[:limit], []

    settings = load_settings({"AKL_ENV": "test", "AKL_AUTH_MODE": "disabled", "AKL_RAG_DEPENDENCY_MODE": "mock", "AKL_RAG_AUTHZ_MODE": "dev", "AKL_RAG_MAX_CHUNKS_PER_DOCUMENT": "3"})
    service = object.__new__(RagRetrievalService)
    service._settings = settings
    service._registry_client = MockRegistryClient(settings)
    service._retriever = Retriever()
    service._llm_client = Llm()
    service._reranker = Reranker()
    result = await service._retrieve_authorized(
        payload=RetrieveRequest(subject_id="test", query="Jaké jsou povinnosti?", filters=RagQueryFilters(document_ids=["doc"], document_version_ids=["ver_1"]), max_chunks=8),
        query_id="followup-budget", expand_parent=False,
    )
    assert len(result.response.chunks) == 8


@pytest.mark.asyncio
@pytest.mark.parametrize("scope", ["unbound", "bound", "resolved"])
async def test_source_resolution_hints_do_not_replace_question_inside_selected_document(scope):
    from app.service import _assistant_query
    seen = {}
    evidence = _chunk("clause", "doc", "Podmínky vrácení jsou uvedeny v této části.")
    question = "Jaké jsou podmínky vrácení zařízení?"
    if scope == "resolved":
        question = "Jaké jsou podmínky vrácení podle 1/2025 Sb.?"
        evidence.citation.document_title = "1/2025 Sb. Testovací pravidla"
    expanded = _assistant_query(question, {"document_retrieval_hints": ["správce", "historie nákupů"]})

    class Retriever:
        async def resolve_exact_candidates(self, *, query, **kwargs):
            seen["resolver"] = query
            return [evidence]

        async def retrieve(self, **kwargs):
            seen["retrieval"] = kwargs["query"]
            return [evidence]

    class Llm:
        async def embeddings(self, queries, **kwargs):
            seen["embedding"] = queries[0]
            return [[0.1, 0.2]]

    class Reranker:
        async def rerank(self, *, query, chunks, limit):
            seen["rerank"] = query
            return chunks[:limit], []

    settings = load_settings({"AKL_ENV": "test", "AKL_AUTH_MODE": "disabled", "AKL_RAG_DEPENDENCY_MODE": "mock", "AKL_RAG_AUTHZ_MODE": "dev", "AKL_RAG_ENABLE_RERANKING": "true"})
    service = object.__new__(RagRetrievalService)
    service._settings = settings
    service._registry_client = MockRegistryClient(settings)
    service._retriever, service._llm_client, service._reranker = Retriever(), Llm(), Reranker()
    filters = RagQueryFilters(document_ids=["doc"]) if scope == "bound" else RagQueryFilters()
    result = await service._retrieve_authorized(
        payload=RetrieveRequest(subject_id="test", query=expanded, filters=filters, max_chunks=4),
        semantic_query=question, query_id="semantic-priority", expand_parent=False,
    )
    assert result.response.chunks
    expected = query_without_document_identifiers(question) if scope != "unbound" else expanded
    assert seen["embedding"] == expected
    assert seen["retrieval"] == expected
    assert seen["rerank"] == expected
    if scope == "resolved":
        assert seen["resolver"] == expanded


@pytest.mark.asyncio
@pytest.mark.parametrize("missing_source", [False, True])
async def test_previous_answer_only_reaches_model_when_all_its_sources_are_selected(missing_source):
    from answer_composer.composer import AnswerComposer
    from app.llm_client import ChatCompletionResult
    captured = []

    class Model:
        async def chat_completion_result(self, **kwargs):
            captured.append(kwargs["messages"])
            return ChatCompletionResult(content="Podklady se odevzdávají do 30 dnů.", model="test")

    settings = load_settings({"AKL_ENV": "test", "AKL_AUTH_MODE": "disabled", "AKL_RAG_DEPENDENCY_MODE": "mock", "AKL_RAG_AUTHZ_MODE": "dev"})
    composer = AnswerComposer(settings, Model())
    pairs = {("doc", "ver_1")}
    if missing_source:
        pairs.add(("revoked", "restricted_version"))
    await composer.compose(query_id="reference-test", query="Rozveď druhý bod.",
                           chunks=[_chunk("a", "doc", "Podklady se odevzdávají do 30 dnů.")],
                           confidence="high", warnings=[], max_chunks=1,
                           conversation_reference=("UNIQUE_PREVIOUS_ANSWER", pairs))
    assert captured
    assert ("UNIQUE_PREVIOUS_ANSWER" in captured[0][1]["content"]) is not missing_source
    assert "UNIQUE_PREVIOUS_ANSWER" not in captured[0][0]["content"]


@pytest.mark.asyncio
async def test_persistence_receipt_identifies_own_turn_not_concurrent_last_message():
    from app.schemas import AssistantChatResponse

    class Registry:
        async def append_conversation_messages(self, **kwargs):
            own = dict(kwargs["messages"][-1], message_id="own-answer")
            other = dict(own, message_id="another-answer", metadata={"turn_id": "another-turn"})
            return {"messages": [own, other]}

    service = object.__new__(RagRetrievalService)
    service._registry_client = Registry()
    response = AssistantChatResponse(response_type="answer", conversation_id="conversation", answer="Odpověď")
    persisted = await service._persist_conversation_turn(
        conversation_id="conversation", user_id="employee", user_message="Dotaz", response=response,
        parent_message_id=None, turn_origin="typed", source_bound=False, source_scope_hash=None,
    )
    assert persisted
    assert response.message_id == "own-answer"


@pytest.mark.asyncio
@pytest.mark.parametrize("revoke_neighbor", [False, True])
async def test_adjacent_page_keeps_own_citation_and_requires_fresh_authorization(revoke_neighbor):
    from types import SimpleNamespace
    from app.registry_client import AuthzFilterResult
    first = _chunk("seed", "contract", "Podpora je poskytována každý den.")
    first.citation.page_number = 1
    first.citation.section_path = ["Čl. 2", "Odst. 1"]
    first.metadata["source_mime_type"] = "application/pdf"
    second = _chunk("exception", "contract", "Výjimkou jsou svátky.")
    second.citation.page_number = 2
    second.citation.section_path = ["Čl. 2", "Odst. 2"]
    unrelated = _chunk("other-section", "contract", "Sankce je 30 Kč.")
    unrelated.citation.page_number = 2
    unrelated.citation.section_path = ["Čl. 3"]

    class Retriever:
        async def get_context_chunks(self, *args, **kwargs):
            return [first, second, unrelated]

    class Registry:
        async def filter_allowed_documents(self, **kwargs):
            return AuthzFilterResult(allowed_document_ids=set() if revoke_neighbor else {"contract"}, denied_document_ids={"contract"} if revoke_neighbor else set())

    service = object.__new__(RagRetrievalService)
    service._settings = SimpleNamespace(parent_window=2, max_context_chars=5000, parent_retrieval_mode="enforce", authz_mode="registry", registry_client_mode="mock")
    service._retriever, service._registry_client = Retriever(), Registry()
    result, _ = await service._expand_authorized_context(subject_id="employee", chunks=[first], auth_context=None)
    if revoke_neighbor:
        assert result == []
    else:
        assert [item.chunk_id for item in result] == ["seed", "exception"]
        assert [item.citation.page_number for item in result] == [1, 2]
        assert result[0].text == first.text
        assert result[1].text == second.text


@pytest.mark.asyncio
@pytest.mark.parametrize('read_denied', [False, True])
async def test_redacted_write_receipt_is_resolved_only_through_fresh_user_authorization(read_denied):
    from app.schemas import AssistantChatResponse
    from app.errors import RetrievalError
    caller = object()

    class Registry:
        async def append_conversation_messages(self, **kwargs):
            self.own = dict(kwargs['messages'][-1], message_id='own-answer')
            return {'messages': [dict(self.own, metadata={'history_access_changed': True})]}

        async def fetch_conversation(self, **kwargs):
            assert kwargs['auth_context'] is caller
            if read_denied:
                raise RetrievalError('AUTH_DENIED', 'revoked', status_code=403)
            other = dict(self.own, message_id='concurrent-answer', metadata={'turn_id': 'other'})
            return {'messages': [self.own, other]}

    service = object.__new__(RagRetrievalService)
    service._registry_client = Registry()
    response = AssistantChatResponse(response_type='answer', conversation_id='conversation', answer='Odpověď')
    persisted = await service._persist_conversation_turn(
        conversation_id='conversation', user_id='employee', user_message='Dotaz', response=response,
        parent_message_id=None, turn_origin='typed', source_bound=False, source_scope_hash=None,
        auth_context=caller,
    )
    assert persisted
    assert response.message_id == (None if read_denied else 'own-answer')
