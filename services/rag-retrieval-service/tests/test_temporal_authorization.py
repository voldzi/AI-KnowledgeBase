from dataclasses import replace
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

import app.registry_client as registry_module
from app.config import load_settings
from app.errors import RetrievalError
from app.registry_client import HttpRegistryClient
from app.schemas import RagQueryFilters, RetrieveRequest
from app.service import RagRetrievalService
from tests.test_rag_flow import _policy_chunk


TODAY = datetime.now(ZoneInfo("Europe/Prague")).date()
FUTURE = TODAY + timedelta(days=30)


def chunk(version):
    item = _policy_chunk(
        chunk_id=f"chunk_{version}", document_id="doc_temporal", binding_id="pol_temporal_test",
        handling_class="INTERNAL", obligations=[],
    )
    return item.model_copy(update={
        "text": f"Evidence from publication {version}",
        "citation": item.citation.model_copy(update={"document_version_id": version}),
    })


@pytest.fixture
def scenario(monkeypatch):
    state = {"candidates": [chunk("v1"), chunk("v2")], "registry_calls": [], "reranked": [], "index_filters": [], "bad_echo": False}
    settings = replace(load_settings({
        "AKL_ENV": "test", "AKL_AUTH_MODE": "disabled", "AKL_RAG_DEPENDENCY_MODE": "mock",
        "AKL_RAG_ENABLE_RERANKING": "true", "AKL_RAG_PARENT_RETRIEVAL_MODE": "enforce",
    }), registry_client_mode="http", authz_mode="registry")

    class Retriever:
        async def retrieve(self, **kwargs):
            state["index_filters"].append(kwargs["filters"])
            return state["candidates"]

        async def get_context_chunks(self, _seed, **_kwargs):
            # Deliberately include both versions: temporal authorization and the
            # existing same-version expansion boundary must exclude the other.
            return state.get("context_candidates", [chunk("v1"), chunk("v2")])

    class Llm:
        async def embeddings(self, *_args, **_kwargs):
            return [[0.1, 0.2]]

    class Reranker:
        def rerank(self, *, chunks, **_kwargs):
            state["reranked"].extend(item.citation.document_version_id for item in chunks)
            return chunks, []

    async def registry_response(**kwargs):
        request = kwargs["json_body"]
        state["registry_calls"].append(request)
        requested_date = request.get("effective_on")
        candidates = request["candidate_document_versions"].get("doc_temporal", [])
        # This is the independent Registry timeline, including V2 even when the
        # search index returned only V1. Registry behavior is covered separately.
        effective = "v1" if requested_date is None or date.fromisoformat(requested_date) < FUTURE else "v2"
        allowed = candidates if requested_date is None else [effective] if effective in candidates else []
        if state.get("withdraw_after_initial_authorization") and len(state["registry_calls"]) > 1:
            allowed = []
        return {
            "effective_on": "1900-01-01" if state["bad_echo"] else requested_date,
            "allowed_document_ids": ["doc_temporal"] if allowed else [],
            "denied_document_ids": [] if allowed else ["doc_temporal"],
            "allowed_document_version_ids": {"doc_temporal": allowed} if allowed else {},
            "denied_document_version_ids": {"doc_temporal": list(set(candidates)-set(allowed))},
        }

    monkeypatch.setattr(registry_module, "request_json_with_retry", registry_response)
    service = object.__new__(RagRetrievalService)
    service._settings = settings
    service._retriever = Retriever()
    service._llm_client = Llm()
    service._reranker = Reranker()
    service._registry_client = HttpRegistryClient(settings)
    return service, state


async def retrieve(service, filters):
    return await service._retrieve_authorized(
        payload=RetrieveRequest(subject_id="user_temporal", query="Jaký postup použít?", filters=filters, max_chunks=4),
        query_id="qry_temporal",
    )


@pytest.mark.asyncio
async def test_default_current_retrieval_passes_one_prague_calendar_date_through_index_registry_and_parent(scenario):
    service, state = scenario
    result = await retrieve(service, RagQueryFilters())
    effective_on = state["index_filters"][0].valid_on
    assert [item.citation.document_version_id for item in result.response.chunks] == ["v1"]
    assert state["reranked"] == ["v1"]
    assert state["registry_calls"]
    assert effective_on is not None
    assert all(call["effective_on"] == effective_on.isoformat() for call in state["registry_calls"])
    assert result.response.retrieval_diagnostics["valid_on"] == effective_on.isoformat()


@pytest.mark.asyncio
@pytest.mark.parametrize("on,expected", [(TODAY-timedelta(days=1), "v1"), (FUTURE, "v2"), (FUTURE+timedelta(days=1), "v2")])
async def test_historical_and_future_dates_gate_versions_before_reranking_and_parent_expansion(scenario, on, expected):
    service, state = scenario
    result = await retrieve(service, RagQueryFilters(valid_on=on))
    assert [item.citation.document_version_id for item in result.response.chunks] == [expected]
    assert state["reranked"] == [expected]
    assert all(call["effective_on"] == on.isoformat() for call in state["registry_calls"])
    assert all(item not in result.response.chunks[0].text for item in (["v2"] if expected == "v1" else ["v1"]))


@pytest.mark.asyncio
async def test_missing_effective_successor_in_index_cannot_fall_back_to_old_publication(scenario):
    service, state = scenario
    state["candidates"] = [chunk("v1")]
    result = await retrieve(service, RagQueryFilters(valid_on=FUTURE))
    assert result.response.chunks == []
    assert state["reranked"] == []
    assert "doc_temporal" in result.denied_document_ids
    assert "AUTHZ_FILTERED_SOURCES" in result.response.warnings


@pytest.mark.asyncio
async def test_explicit_historical_version_open_has_no_implicit_current_date(scenario):
    service, state = scenario
    state["candidates"] = [chunk("v1")]
    result = await retrieve(service, RagQueryFilters(only_valid=False, document_version_ids=["v1"]))
    assert [item.citation.document_version_id for item in result.response.chunks] == ["v1"]
    assert all("effective_on" not in call for call in state["registry_calls"])


@pytest.mark.asyncio
async def test_explicit_date_is_authoritative_even_when_index_validity_filter_is_disabled(scenario):
    service, state = scenario
    result = await retrieve(service, RagQueryFilters(only_valid=False, valid_on=FUTURE))
    assert [item.citation.document_version_id for item in result.response.chunks] == ["v2"]
    assert state["reranked"] == ["v2"]


@pytest.mark.asyncio
async def test_temporal_contract_mismatch_fails_before_context_reaches_reranker(scenario):
    service, state = scenario
    state["bad_echo"] = True
    with pytest.raises(RetrievalError) as error:
        await retrieve(service, RagQueryFilters())
    assert error.value.code == "REGISTRY_TEMPORAL_AUTHORIZATION_INVALID"
    assert state["reranked"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["enforce", "shadow"])
async def test_withdrawal_during_parent_expansion_removes_original_seed_text(scenario, mode):
    service, state = scenario
    service._settings = replace(service._settings, parent_retrieval_mode=mode)
    state["withdraw_after_initial_authorization"] = True
    result = await retrieve(service, RagQueryFilters())
    assert len(state["registry_calls"]) == 2
    assert result.response.chunks == []


@pytest.mark.asyncio
@pytest.mark.parametrize("page", [1, None])
async def test_parent_context_keeps_the_seed_page_citation_and_same_page_paragraphs(scenario, page):
    service, state = scenario
    seed = chunk("v1")
    seed = seed.model_copy(update={"citation": seed.citation.model_copy(update={"page_number": page})})
    same_page = seed.model_copy(update={"chunk_id": "same_page", "text": "Additional paragraph from the same original page."})
    another_page = seed.model_copy(update={
        "chunk_id": "another_page", "text": "Unrelated second page must have its own citation.",
        "citation": seed.citation.model_copy(update={"page_number": 2}),
    })
    state["candidates"] = [seed]
    state["context_candidates"] = [seed, same_page, another_page]
    result = await retrieve(service, RagQueryFilters())
    assert len(result.response.chunks) == 1
    expanded = result.response.chunks[0]
    assert expanded.citation.page_number == page
    assert same_page.text in expanded.text
    assert another_page.text not in expanded.text
    assert "another_page" not in expanded.metadata["expanded_chunk_ids"]
