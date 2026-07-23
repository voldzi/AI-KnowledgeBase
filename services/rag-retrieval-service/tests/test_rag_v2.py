from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.config import ConfigError, load_settings
from app.main import _log_runtime_profile
from app.registry_client import AuthzFilterResult, MockRegistryClient
from app.schemas import (
    ChunkCitation,
    RagAnswer,
    RagQueryFilters,
    RetrieveRequest,
    RetrievedChunk,
)
from app.service import (
    RagRetrievalService,
    _apply_exact_identifier_scope,
    _candidate_budget,
    _detect_conflicts,
    _exact_resolver_limit,
    _reranker_budget,
    _reranker_diagnostics,
)
from policies.evidence import EvidenceGate, _model_assessment
import rerankers.cross_encoder as cross_encoder_module
from rerankers.cross_encoder import (
    CrossEncoderReranker,
    _bounded_reranker_text,
    _first_multivector,
    _ordered_scores,
)
from retrievers.query_analysis import analyze_query, extract_identifiers
from tests.conftest import make_client


def _chunk(chunk_id: str, document_id: str, text: str, *, version: str = "ver_1") -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=chunk_id,
        score=0.8,
        retrieval_method="hybrid",
        text=text,
        citation=ChunkCitation(
            document_id=document_id,
            document_version_id=version,
            document_title=document_id,
            version_label="1.0",
        ),
        metadata={"chunk_index": 1, "text_hash": f"sha256:{chunk_id}"},
    )


def test_query_analyzer_routes_exact_temporal_comparison_and_live_data() -> None:
    filters = RagQueryFilters()
    defaults = {"default_candidate_limit": 64, "default_dense_weight": 0.35}

    assert analyze_query("Najdi ORBDIG-IT-2026-072", filters, **defaults).profile == "exact"
    assert analyze_query("Jak znělo pravidlo v roce 2024?", filters, **defaults).profile == "temporal"
    comparison = analyze_query("Porovnej obě smlouvy", filters, **defaults)
    assert comparison.profile == "cross_document"
    assert comparison.require_multiple_documents is True
    assert analyze_query("Jaké je aktuální čerpání?", filters, **defaults).profile == "copilot_live_data"
    assert analyze_query("Smlouva 120-2022-S", filters, **defaults).profile == "exact"
    assert extract_identifiers("Smlouva 120-2022-S") == ("120-2022-S",)
    assert analyze_query("365/2000 Sb.", filters, **defaults).profile == "exact"
    assert extract_identifiers("zákon č. 365/2000 Sb.") == ("365/2000 Sb.",)


def test_reranker_diagnostics_contains_only_operational_metadata() -> None:
    chunk = _chunk("a", "doc_a", "citlivý obsah")
    chunk = chunk.model_copy(
        update={
            "metadata": {
                **chunk.metadata,
                "cross_encoder_device": "mps",
                "cross_encoder_endpoint_slot": 1,
                "cross_encoder_batch_count": 1,
                "cross_encoder_queue_ms": 2.5,
                "cross_encoder_inference_ms": 20.0,
                "cross_encoder_server_total_ms": 22.5,
                "cross_encoder_transport_ms": 3.0,
                "unrelated_content": "must-not-escape",
            }
        }
    )

    assert _reranker_diagnostics([chunk]) == {
        "device": "mps",
        "endpoint_slot": 1,
        "batch_count": 1,
        "queue_ms": 2.5,
        "inference_ms": 20.0,
        "server_total_ms": 22.5,
        "transport_ms": 3.0,
    }


def test_rag_v2_modes_require_explicit_internal_endpoints() -> None:
    with pytest.raises(ConfigError, match="AKL_RAG_RERANKER_BASE_URL"):
        load_settings({"AKL_RAG_RERANKER_MODE": "shadow"})
    with pytest.raises(ConfigError, match="AKL_RAG_COLBERT_BASE_URL"):
        load_settings({"AKL_RAG_COLBERT_MODE": "shadow"})
    with pytest.raises(ConfigError, match="AKL_RAG_PARENT_RETRIEVAL_MODE"):
        load_settings({"AKL_RAG_PARENT_RETRIEVAL_MODE": "invalid"})
    with pytest.raises(ConfigError, match="internal endpoint"):
        load_settings(
            {
                "AKL_RAG_RERANKER_MODE": "shadow",
                "AKL_RAG_RERANKER_BASE_URL": "https://api.example.com",
            }
        )
    with pytest.raises(ConfigError, match="RERANKER_STRATEGY"):
        load_settings(
            {
                "AKL_RAG_COLBERT_MODE": "shadow",
                "AKL_RAG_COLBERT_BASE_URL": "http://colbert:8080",
            }
        )


def test_reranker_base_urls_are_normalized_and_deduplicated() -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_MODE": "shadow",
            "AKL_RAG_RERANKER_BASE_URL": "http://reranker-a:3000",
            "AKL_RAG_RERANKER_BASE_URLS": (
                "http://reranker-a:3000/,http://192.168.200.3:11435,"
                "http://reranker-a:3000"
            ),
        }
    )

    assert settings.reranker_base_urls == (
        "http://reranker-a:3000",
        "http://192.168.200.3:11435",
    )


def test_runtime_profile_logs_modes_without_endpoint_values_or_credentials(caplog) -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_MODE": "shadow",
            "AKL_RAG_RERANKER_PROVIDER": "llama",
            "AKL_RAG_RERANKER_BASE_URLS": "http://reranker-a:3000,http://reranker-b:3000",
            "AKL_RAG_RERANKER_API_KEY": "must-not-be-logged",
            "AKL_RAG_V2_RETRIEVAL_MODE": "shadow",
            "AKL_RAG_ADAPTIVE_RETRIEVAL_MODE": "shadow",
            "AKL_RAG_PARENT_RETRIEVAL_MODE": "shadow",
            "AKL_RAG_EVIDENCE_GATE_MODE": "shadow",
        }
    )

    _log_runtime_profile(settings)

    message = caplog.records[-1].getMessage()
    assert "reranker_mode=shadow" in message
    assert "reranker_endpoint_count=2" in message
    assert "v2_retrieval_mode=shadow" in message
    assert "http://reranker-a:3000" not in message
    assert "must-not-be-logged" not in message


def test_reranker_response_and_colbert_multivector_validation() -> None:
    assert _ordered_scores(
        {"results": [{"index": 1, "relevance_score": 0.9}, {"index": 0, "relevance_score": 0.2}]},
        2,
    ) == [0.2, 0.9]
    assert _first_multivector({"vectors": [[[0.1, 0.2], [0.3, 0.4]]]}) == [
        [0.1, 0.2],
        [0.3, 0.4],
    ]


def test_reranker_document_input_is_bounded_without_logging_or_mutating_source() -> None:
    original = "A" * 700

    assert _bounded_reranker_text(original, max_chars=512) == "A" * 512
    assert original == "A" * 700


def test_exact_identifier_scope_keeps_only_the_single_matching_document() -> None:
    chunks = [
        _chunk("target-a", "doc_target", "Povinnost."),
        _chunk("target-b", "doc_target", "Sankce."),
        _chunk("other", "doc_other", "Nesouvisející text."),
    ]
    chunks[0].citation.document_title = "Smlouva 120-2022-S"
    chunks[1].citation.document_title = "Smlouva 120-2022-S"
    chunks[2].citation.document_title = "Smlouva 071-2025-X"

    scoped, document_id = _apply_exact_identifier_scope(
        "Jaké jsou povinnosti ve smlouvě 120-2022-S?",
        chunks,
    )

    assert document_id == "doc_target"
    assert {chunk.citation.document_id for chunk in scoped} == {"doc_target"}


def test_exact_czech_law_scope_keeps_only_matching_document() -> None:
    chunks = [
        _chunk("law-a", "doc_law", "Působnost zákona."),
        _chunk("law-b", "doc_law", "Správa informačních systémů."),
        _chunk("noise", "doc_noise", "Historické údaje."),
    ]
    chunks[0].citation.document_title = "365/2000 Sb. - Zákon o informačních systémech"
    chunks[1].citation.document_title = "365/2000 Sb. - Zákon o informačních systémech"
    chunks[2].citation.document_title = "Výroční zpráva 2000"

    scoped, document_id = _apply_exact_identifier_scope("365/2000 Sb.", chunks)

    assert document_id == "doc_law"
    assert {chunk.citation.document_id for chunk in scoped} == {"doc_law"}


def test_profile_budgets_bound_expensive_retrieval_stages() -> None:
    assert _exact_resolver_limit(50) == 32
    assert _candidate_budget("exact", requested_chunks=50, planned_limit=50) == 50
    assert _candidate_budget("semantic", requested_chunks=50, planned_limit=100) == 64
    assert _candidate_budget("cross_document", requested_chunks=50, planned_limit=100) == 96
    assert _reranker_budget("exact", available=50) == 24
    assert _reranker_budget("semantic", available=80) == 64


@pytest.mark.asyncio
async def test_exact_resolver_scopes_before_retrieval_and_skips_embedding() -> None:
    target = _chunk("law", "doc_law", "Působnost zákona.")
    target.citation.document_title = "365/2000 Sb. - Zákon o informačních systémech"
    noise = _chunk("noise", "doc_noise", "Výroční zpráva.")
    resolver_filters: list[RagQueryFilters] = []

    class Retriever:
        async def resolve_exact_candidates(self, *, query, filters, limit):
            resolver_filters.append(filters)
            if filters.document_ids:
                return [target]
            return [target, noise]

        async def retrieve(self, **kwargs):
            raise AssertionError("exact retrieval must stay on the lexical resolver")

    class LlmClient:
        async def embeddings(self, *args, **kwargs):
            raise AssertionError("exact resolved retrieval must not request an embedding")

    class Reranker:
        async def rerank(self, *, query, chunks, limit):
            return chunks[:limit], []

    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_RAG_DEPENDENCY_MODE": "mock",
            "AKL_RAG_AUTHZ_MODE": "dev",
            "AKL_RAG_RERANKER_MODE": "off",
            "AKL_RAG_PARENT_RETRIEVAL_MODE": "shadow",
        }
    )
    service = object.__new__(RagRetrievalService)
    service._settings = settings
    service._registry_client = MockRegistryClient(settings)
    service._retriever = Retriever()
    service._reranker = Reranker()
    service._llm_client = LlmClient()

    run = await service._retrieve_authorized(
        payload=RetrieveRequest(
            subject_id="user_123",
            query="365/2000 Sb.",
            filters=RagQueryFilters(classification_max="public"),
            max_chunks=50,
        ),
        query_id="query_exact",
        expand_parent=False,
    )

    assert [chunk.citation.document_id for chunk in run.response.chunks] == ["doc_law"]
    assert resolver_filters[0].document_ids == []
    assert resolver_filters[1].document_ids == ["doc_law"]
    assert run.response.retrieval_diagnostics["exact_document_scope_applied"] is True
    assert run.response.retrieval_diagnostics["stage_timings_ms"]["embedding"] == 0.0
    assert run.response.retrieval_diagnostics["stage_timings_ms"]["parent_expansion"] == 0.0


def test_deterministic_evidence_accepts_claim_supported_by_document_title() -> None:
    settings = load_settings(
        {
            "AKL_RAG_EVIDENCE_GATE_MODE": "enforce",
            "AKL_RAG_EVIDENCE_MIN_OVERLAP": "0.18",
        }
    )
    chunk = _chunk(
        "law",
        "doc_law",
        "Tento zákon stanoví další práva a povinnosti.",
    )
    chunk.citation.document_title = (
        "365/2000 Sb. - Zákon o informačních systémech veřejné správy"
    )
    answer = RagAnswer(
        query_id="query_law",
        answer="Zákon č. 365/2000 Sb. upravuje informační systémy veřejné správy.",
        confidence="high",
        citations=[],
    )

    verified = EvidenceGate(settings).verify(answer, [chunk])

    assert verified.evidence_status == "supported"
    assert verified.confidence == "high"
    assert verified.claims[0]["supported"] is True


@pytest.mark.asyncio
async def test_cross_encoder_enforce_orders_candidates_and_records_provenance(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_MODE": "enforce",
            "AKL_RAG_RERANKER_PROVIDER": "tei",
            "AKL_RAG_RERANKER_BASE_URL": "http://reranker:3000",
            "AKL_RAG_RERANKER_MODEL": "bge-reranker-v2-m3",
            "AKL_RAG_RERANKER_MODEL_REVISION": "revision-1",
        }
    )
    reranker = CrossEncoderReranker(settings)

    async def score(*, query, chunks):
        assert query == "schválení"
        return [0.2, 0.95]

    monkeypatch.setattr(reranker, "_score", score)
    result, warnings = await reranker.rerank(
        query="schválení",
        chunks=[_chunk("a", "doc_a", "první"), _chunk("b", "doc_b", "druhý")],
        limit=2,
    )

    assert [item.chunk_id for item in result] == ["b", "a"]
    assert result[0].metadata["cross_encoder_model"] == "bge-reranker-v2-m3"
    assert result[0].metadata["cross_encoder_revision"] == "revision-1"
    assert warnings == []


@pytest.mark.asyncio
async def test_cross_encoder_fails_over_to_next_internal_endpoint(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_MODE": "shadow",
            "AKL_RAG_RERANKER_PROVIDER": "llama",
            "AKL_RAG_RERANKER_BASE_URL": "http://192.168.200.2:11435",
            "AKL_RAG_RERANKER_BASE_URLS": (
                "http://192.168.200.2:11435,http://192.168.200.3:11435"
            ),
        }
    )
    requested_urls: list[str] = []
    health_urls: list[str] = []

    class FakeResponse:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

        def json(self):
            return {"results": [{"index": 0, "relevance_score": 0.9}]}

    class FakeClient:
        def __init__(self, *, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def post(self, url, *, headers, json):
            requested_urls.append(url)
            return FakeResponse()

        async def get(self, url, *, headers, timeout):
            assert timeout == settings.reranker_health_timeout_seconds
            health_urls.append(url)
            if "192.168.200.2" in url:
                raise httpx.ConnectError("unavailable", request=httpx.Request("GET", url))
            return FakeResponse()

    monkeypatch.setattr(cross_encoder_module.httpx, "AsyncClient", FakeClient)
    reranker = CrossEncoderReranker(settings)

    scores = await reranker._score(
        query="schválení", chunks=[_chunk("a", "doc_a", "první")]
    )

    assert scores == [0.9]
    assert set(health_urls) == {
        "http://192.168.200.2:11435/health",
        "http://192.168.200.3:11435/health",
    }
    assert requested_urls == [
        "http://192.168.200.3:11435/v1/rerank",
    ]


@pytest.mark.asyncio
async def test_cross_encoder_records_server_and_transport_timings(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_MODE": "enforce",
            "AKL_RAG_RERANKER_PROVIDER": "tei",
            "AKL_RAG_RERANKER_BASE_URL": "http://reranker:3000",
        }
    )
    reranker = CrossEncoderReranker(settings)

    async def post_with_endpoint_fallback(*, endpoint, payload):
        request = httpx.Request("POST", f"http://reranker:3000{endpoint}")
        return httpx.Response(
            200,
            request=request,
            headers={
                "X-AKB-Reranker-Device": "mps",
                "X-AKB-Reranker-Queue-Ms": "2.5",
                "X-AKB-Reranker-Inference-Ms": "20",
                "X-AKB-Reranker-Total-Ms": "22.5",
            },
            json=[{"index": 0, "score": 0.9}],
        )

    monkeypatch.setattr(
        reranker,
        "_post_with_endpoint_fallback",
        post_with_endpoint_fallback,
    )

    result, warnings = await reranker.rerank(
        query="schválení",
        chunks=[_chunk("a", "doc_a", "první")],
        limit=1,
    )

    assert warnings == []
    assert result[0].metadata["cross_encoder_device"] == "mps"
    assert result[0].metadata["cross_encoder_endpoint_slot"] == 1
    assert result[0].metadata["cross_encoder_queue_ms"] == 2.5
    assert result[0].metadata["cross_encoder_inference_ms"] == 20.0
    assert result[0].metadata["cross_encoder_server_total_ms"] == 22.5
    assert result[0].metadata["cross_encoder_transport_ms"] is not None


@pytest.mark.asyncio
async def test_cross_encoder_cools_down_failed_active_address(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_MODE": "shadow",
            "AKL_RAG_RERANKER_PROVIDER": "llama",
            "AKL_RAG_RERANKER_BASE_URLS": (
                "http://192.168.200.2:11435,http://192.168.200.3:11435"
            ),
            "AKL_RAG_RERANKER_FAILURE_COOLDOWN_SECONDS": "30",
        }
    )
    reranker = CrossEncoderReranker(settings)
    reranker._active_base_url = "http://192.168.200.2:11435"

    reranker._mark_endpoint_failed("http://192.168.200.2:11435")

    assert reranker._active_base_url is None
    assert reranker._endpoint_is_cooling_down("http://192.168.200.2:11435")
    assert not reranker._endpoint_is_cooling_down("http://192.168.200.3:11435")


@pytest.mark.asyncio
async def test_cross_encoder_serializes_single_runtime_inference(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_MODE": "shadow",
            "AKL_RAG_RERANKER_PROVIDER": "llama",
            "AKL_RAG_RERANKER_BASE_URL": "http://reranker:11435",
            "AKL_RAG_RERANKER_MAX_CONCURRENCY": "1",
        }
    )
    reranker = CrossEncoderReranker(settings)
    active = 0
    peak = 0

    async def post_to_selected_endpoint(*, endpoint, payload):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        return SimpleNamespace()

    monkeypatch.setattr(reranker, "_post_to_selected_endpoint", post_to_selected_endpoint)

    await asyncio.gather(
        *(
            reranker._post_with_endpoint_fallback(endpoint="/v1/rerank", payload={})
            for _ in range(4)
        )
    )

    assert peak == 1


@pytest.mark.asyncio
async def test_cross_encoder_enforce_fails_closed_when_model_is_unavailable(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_MODE": "enforce",
            "AKL_RAG_RERANKER_PROVIDER": "tei",
            "AKL_RAG_RERANKER_BASE_URL": "http://reranker:3000",
        }
    )
    reranker = CrossEncoderReranker(settings)

    async def unavailable(*, query, chunks):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(reranker, "_score", unavailable)
    result, warnings = await reranker.rerank(
        query="schválení",
        chunks=[_chunk("a", "doc_a", "první")],
        limit=1,
    )

    assert result == []
    assert warnings == ["RERANKER_UNAVAILABLE"]


@pytest.mark.asyncio
async def test_colbert_enforce_fails_closed_when_model_is_unavailable(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_STRATEGY": "colbert",
            "AKL_RAG_COLBERT_MODE": "enforce",
            "AKL_RAG_COLBERT_BASE_URL": "http://colbert:8080",
        }
    )
    reranker = CrossEncoderReranker(settings)

    async def unavailable(*, query, chunks):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(reranker, "_colbert_score", unavailable)
    result, warnings = await reranker.rerank(
        query="schválení",
        chunks=[_chunk("a", "doc_a", "první")],
        limit=1,
    )

    assert result == []
    assert warnings == ["COLBERT_UNAVAILABLE"]


def test_evidence_gate_enforce_rejects_unsupported_main_claim() -> None:
    settings = load_settings(
        {"AKL_RAG_EVIDENCE_GATE_MODE": "enforce", "AKL_RAG_EVIDENCE_MIN_OVERLAP": "0.3"}
    )
    chunk = _chunk("chunk_a", "doc_a", "Gestor dokumentu schvaluje výjimku ze směrnice.")
    answer = RagAnswer(
        query_id="query_1",
        answer="Ředitel automaticky schvaluje všechny nákupy.",
        confidence="high",
        citations=[],
        used_chunks=[chunk.chunk_id],
    )

    verified = EvidenceGate(settings).verify(answer, [chunk])

    assert verified.confidence == "insufficient_source"
    assert verified.evidence_status == "unsupported"
    assert verified.citations == []
    assert "EVIDENCE_GATE_UNSUPPORTED_CLAIMS" in verified.warnings


def test_evidence_gate_removes_unsupported_secondary_claim() -> None:
    settings = load_settings(
        {"AKL_RAG_EVIDENCE_GATE_MODE": "enforce", "AKL_RAG_EVIDENCE_MIN_OVERLAP": "0.3"}
    )
    chunk = _chunk("chunk_a", "doc_a", "Gestor dokumentu schvaluje výjimku ze směrnice.")
    answer = RagAnswer(
        query_id="query_1",
        answer=(
            "Gestor dokumentu schvaluje výjimku ze směrnice. "
            "Ředitel automaticky schvaluje všechny nákupy."
        ),
        confidence="high",
        citations=[],
        used_chunks=[chunk.chunk_id],
    )

    verified = EvidenceGate(settings).verify(answer, [chunk])

    assert verified.evidence_status == "partial"
    assert "nákupy" not in verified.answer
    assert "UNSUPPORTED_SECONDARY_CLAIMS_REMOVED" in verified.warnings


def test_model_evidence_contract_rejects_unknown_chunk_and_omitted_claim() -> None:
    chunk = _chunk("chunk_a", "doc_a", "Gestor dokumentu schvaluje výjimku ze směrnice.")
    assessment = _model_assessment(
        '{"claims":[{"claim":"Gestor schvaluje výjimku.","claim_type":"main",'
        '"chunk_ids":["unknown"],"quoted_support":"Gestor dokumentu"}]}',
        [chunk],
        answer="Gestor schvaluje výjimku. Ředitel schvaluje všechny nákupy.",
    )

    assert assessment.status == "unsupported"
    assert assessment.unsupported_main_claim is True
    assert all(not bool(item["supported"]) for item in assessment.claims)


def test_registry_authorization_precedes_cross_encoder(monkeypatch) -> None:
    seen_documents: list[str] = []

    async def score(self, *, query, chunks):
        seen_documents.extend(item.citation.document_id for item in chunks)
        return [0.9 for _ in chunks]

    monkeypatch.setattr(CrossEncoderReranker, "_score", score)
    with make_client(
        {
            "AKL_RAG_AUTHZ_MODE": "registry",
            "AKL_RAG_REGISTRY_CLIENT_MODE": "mock",
            "AKL_RAG_RERANKER_MODE": "enforce",
            "AKL_RAG_RERANKER_PROVIDER": "tei",
            "AKL_RAG_RERANKER_BASE_URL": "http://reranker:3000",
        }
    ) as client:
        response = client.post(
            "/api/v1/rag/query",
            json={
                "subject_id": "user_123",
                "query": "Kdo schvaluje výjimky a jaké je tajné pravidlo?",
                "filters": {"classification_max": "confidential"},
                "max_chunks": 8,
            },
        )

    assert response.status_code == 200
    assert "doc_denied" not in seen_documents
    assert seen_documents


@pytest.mark.asyncio
async def test_parent_expansion_reauthorizes_related_chunks() -> None:
    seed = _chunk("seed", "doc_allowed", "Povolený odstavec.")
    second_seed = _chunk("second", "doc_allowed", "Druhý povolený odstavec.")
    denied = _chunk("secret", "doc_denied", "Zakázaný tajný odstavec.")
    registry_calls = 0

    class Retriever:
        async def get_context_chunks(self, chunk, *, window):
            return [chunk, denied]

    class Registry:
        async def filter_allowed_documents(self, **kwargs):
            nonlocal registry_calls
            registry_calls += 1
            return AuthzFilterResult(
                allowed_document_ids={"doc_allowed"},
                denied_document_ids={"doc_denied"},
            )

    service = object.__new__(RagRetrievalService)
    service._settings = SimpleNamespace(
        parent_window=1,
        max_context_chars=1000,
        parent_retrieval_mode="enforce",
        authz_mode="registry",
        registry_client_mode="mock",
    )
    service._retriever = Retriever()
    service._registry_client = Registry()

    expanded, _ = await service._expand_authorized_context(
        subject_id="user_123",
        chunks=[seed, second_seed],
        auth_context=None,
    )

    assert expanded[0].text == "Povolený odstavec."
    assert "secret" not in expanded[0].metadata["expanded_chunk_ids"]
    assert expanded[1].text == "Druhý povolený odstavec."
    assert registry_calls == 1


@pytest.mark.asyncio
async def test_parent_expansion_bounds_context_fetch_concurrency() -> None:
    seeds = [
        _chunk(f"seed-{index}", "doc_allowed", f"Povolený odstavec {index}.")
        for index in range(50)
    ]
    active = 0
    peak = 0

    class Retriever:
        async def get_context_chunks(self, chunk, *, window):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0)
            active -= 1
            return [chunk]

    class Registry:
        async def filter_allowed_documents(self, **kwargs):
            return AuthzFilterResult(
                allowed_document_ids={"doc_allowed"},
                denied_document_ids=set(),
            )

    service = object.__new__(RagRetrievalService)
    service._settings = SimpleNamespace(
        parent_window=1,
        max_context_chars=1000,
        parent_retrieval_mode="shadow",
        authz_mode="registry",
        registry_client_mode="mock",
    )
    service._retriever = Retriever()
    service._registry_client = Registry()

    expanded, warnings = await service._expand_authorized_context(
        subject_id="user_123",
        chunks=seeds,
        auth_context=None,
    )

    assert len(expanded) == 50
    assert peak == 8
    assert warnings == ["PARENT_RETRIEVAL_SHADOW"]


def test_conflict_detector_returns_both_sources_without_selecting_winner() -> None:
    findings = _detect_conflicts(
        [
            _chunk("left", "doc_left", "Dodavatel musí předat bezpečnostní protokol před nasazením."),
            _chunk("right", "doc_right", "Dodavatel nesmí předat bezpečnostní protokol před nasazením."),
        ]
    )

    assert len(findings) == 1
    assert findings[0]["left_document_id"] == "doc_left"
    assert findings[0]["right_document_id"] == "doc_right"
    assert "winner" not in findings[0]
