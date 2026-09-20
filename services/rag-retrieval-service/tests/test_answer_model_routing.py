from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import Any

from answer_composer.composer import AnswerComposer
from app.config import load_settings
from app.schemas import ChunkCitation, RetrievedChunk
from app.security import AuthContext


class CaptureLLMClient:
    def __init__(self, answer: str = "Citovana odpoved.") -> None:
        self.models: list[str | None] = []
        self.metadata: list[dict[str, Any]] = []
        self.messages: list[list[dict[str, str]]] = []
        self.answer = answer

    async def embeddings(
        self,
        texts: list[str],
        *,
        auth_context: AuthContext | None = None,
    ) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in texts]

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        model: str | None = None,
        auth_context: AuthContext | None = None,
    ) -> str:
        self.models.append(model)
        self.metadata.append(metadata)
        self.messages.append(messages)
        return self.answer

    async def readiness(self) -> str:
        return "ready"


def test_standard_employee_answer_uses_default_chat_model() -> None:
    llm = CaptureLLMClient()
    settings = _settings()
    composer = AnswerComposer(settings, llm)

    asyncio.run(
        composer.compose(
            query_id="query-standard",
            query="Co je architektura?",
            chunks=[_chunk("chunk_1")],
            confidence="high",
            warnings=[],
            max_chunks=4,
            answer_mode="it_support_answer",
        )
    )

    assert llm.models == ["gemma4:12b-mlx"]
    assert llm.metadata[0]["chat_model"] == "gemma4:12b-mlx"
    assert llm.metadata[0]["chat_model_tier"] == "local_standard"


def test_complex_answer_mode_uses_high_quality_chat_model() -> None:
    llm = CaptureLLMClient()
    settings = _settings()
    composer = AnswerComposer(settings, llm)

    asyncio.run(
        composer.compose(
            query_id="query-obligations",
            query="Vytvor tabulku povinnosti.",
            chunks=[_chunk("chunk_1")],
            confidence="high",
            warnings=[],
            max_chunks=4,
            answer_mode="extract_obligations",
        )
    )

    assert llm.models == ["gemma4:31b-mlx"]
    assert llm.metadata[0]["chat_model"] == "gemma4:31b-mlx"
    assert llm.metadata[0]["chat_model_tier"] == "local_high_quality"


def test_simple_governed_public_context_stays_on_cost_optimized_local_model() -> None:
    llm = CaptureLLMClient()
    settings = replace(_settings(), external_chat_model="gpt-5.6-luna")
    composer = AnswerComposer(settings, llm)
    chunk = _chunk("public").model_copy(update={"metadata": {
        "policy_binding_id": "pb_public",
        "policy_hash": "sha256:public",
        "policy_summary": {"handlingClass": "PUBLIC", "obligations": []},
    }})

    asyncio.run(composer.compose(
        query_id="query-public", query="Kdo je gestorem dokumentu?", chunks=[chunk],
        confidence="high", warnings=[], max_chunks=4,
    ))

    assert llm.models == ["gemma4:12b-mlx"]
    assert llm.metadata[0]["chat_model_tier"] == "local_standard"
    assert llm.metadata[0]["model_route"]["reason_codes"] == [
        "SIMPLE_BOUNDED_QUERY",
        "LOCAL_COST_OPTIMIZED",
    ]


def test_simple_legal_or_contract_lookup_does_not_trigger_external_cost() -> None:
    for query in (
        "Kdo je dodavatelem této smlouvy?",
        "Jakou povinnost má zaměstnanec podle tohoto zákona?",
        "Kdy je dokument účinný?",
    ):
        llm = CaptureLLMClient()
        settings = replace(_settings(), external_chat_model="gpt-5.6-luna")
        composer = AnswerComposer(settings, llm)
        chunk = _chunk("public").model_copy(update={"metadata": {
            "policy_binding_id": "pb_public",
            "policy_hash": "sha256:public",
            "policy_summary": {"handlingClass": "PUBLIC", "obligations": []},
        }})

        asyncio.run(composer.compose(
            query_id="query-simple-domain", query=query, chunks=[chunk],
            confidence="high", warnings=[], max_chunks=4,
        ))

        assert llm.models == ["gemma4:12b-mlx"]
        assert llm.metadata[0]["chat_model_tier"] == "local_standard"


def test_complex_governed_public_context_uses_configured_external_model() -> None:
    llm = CaptureLLMClient()
    settings = replace(_settings(), external_chat_model="gpt-5.6-luna")
    composer = AnswerComposer(settings, llm)
    chunk = _chunk("public").model_copy(update={"metadata": {
        "policy_binding_id": "pb_public",
        "policy_hash": "sha256:public",
        "policy_summary": {"handlingClass": "PUBLIC", "obligations": []},
    }})

    answer = asyncio.run(composer.compose(
        query_id="query-public-complex",
        query="Jaké povinnosti a výjimky vyplývají z tohoto zákona?",
        chunks=[chunk], confidence="high", warnings=[], max_chunks=4,
    ))

    assert llm.models == ["gpt-5.6-luna"]
    assert llm.metadata[0]["chat_model_tier"] == "external_standard"
    assert llm.metadata[0]["model_route"]["external_processing"] is True
    assert answer.llm_usage["routing"]["tier"] == "external_standard"


def test_restricted_context_stays_on_local_model() -> None:
    llm = CaptureLLMClient()
    settings = replace(
        _settings(),
        external_chat_model="gpt-5.6-luna",
        high_quality_chat_model=None,
    )
    composer = AnswerComposer(settings, llm)
    chunk = _chunk("restricted").model_copy(update={"metadata": {
        "policy_binding_id": "pb_restricted",
        "policy_hash": "sha256:restricted",
        "policy_summary": {
            "handlingClass": "RESTRICTED",
            "obligations": ["NO_EXTERNAL_AI"],
        },
    }})

    asyncio.run(composer.compose(
        query_id="query-restricted", query="Shrň omezený dokument.", chunks=[chunk],
        confidence="high", warnings=[], max_chunks=4,
    ))

    assert llm.models == ["gemma4:12b-mlx"]


def test_manager_brief_uses_high_quality_chat_model() -> None:
    llm = CaptureLLMClient()
    settings = _settings()
    composer = AnswerComposer(settings, llm)

    asyncio.run(
        composer.compose(
            query_id="query-manager-brief",
            query="Shrn smluvni riziko.",
            chunks=[_chunk("chunk_1"), _chunk("chunk_2"), _chunk("chunk_3")],
            confidence="high",
            warnings=[],
            max_chunks=3,
            answer_mode="manager_brief",
        )
    )

    assert llm.models == ["gemma4:31b-mlx"]
    assert llm.metadata[0]["chat_model"] == "gemma4:31b-mlx"
    assert llm.metadata[0]["chat_model_tier"] == "local_high_quality"


def test_director_findings_are_bounded_cited_and_do_not_call_llm() -> None:
    llm = CaptureLLMClient()
    composer = AnswerComposer(_settings(), llm)
    source = "Smluvni ustanoveni s overenym terminem. " * 30

    answer = composer.compose_director_findings(
        query_id="query-director-extractive",
        chunks=[_chunk("chunk_director").model_copy(update={"text": source})],
        confidence="high",
        warnings=[],
        max_chunks=3,
        response_language="cs",
    )

    assert llm.models == []
    assert answer.answer.startswith("Citované výňatky z dokumentových podkladů:")
    assert "[chunk_director]" in answer.answer
    assert len(answer.answer) < 600
    assert [citation.chunk_id for citation in answer.citations] == ["chunk_director"]


def test_large_context_uses_high_quality_chat_model() -> None:
    llm = CaptureLLMClient()
    settings = _settings()
    composer = AnswerComposer(settings, llm)

    asyncio.run(
        composer.compose(
            query_id="query-large-context",
            query="Shrn dostupne dokumenty.",
            chunks=[_chunk("chunk_1"), _chunk("chunk_2"), _chunk("chunk_3")],
            confidence="high",
            warnings=[],
            max_chunks=4,
            answer_mode="it_support_answer",
        )
    )

    assert llm.models == ["gemma4:31b-mlx"]
    assert llm.metadata[0]["chat_model_tier"] == "local_high_quality"


def test_very_complex_query_uses_external_premium_tier() -> None:
    llm = CaptureLLMClient()
    settings = replace(
        _settings(),
        external_chat_model="dia-balanced",
        external_premium_chat_model="dia-premium",
        external_premium_complexity_threshold=6,
    )
    composer = AnswerComposer(settings, llm)
    chunks = [
        _chunk("contract").model_copy(update={"metadata": {
            "policy_binding_id": "pb_internal",
            "policy_hash": "sha256:internal",
            "policy_summary": {"handlingClass": "INTERNAL", "obligations": []},
        }}),
        _chunk("law").model_copy(update={
            "citation": _chunk("law").citation.model_copy(update={
                "document_id": "doc_2", "document_version_id": "ver_2"
            }),
            "metadata": {
                "policy_binding_id": "pb_public",
                "policy_hash": "sha256:public",
                "policy_summary": {"handlingClass": "PUBLIC", "obligations": []},
            },
        }),
    ]

    asyncio.run(composer.compose(
        query_id="query-premium",
        query="Porovnej smluvní povinnosti, výjimky a rizika s požadavky zákona.",
        chunks=chunks, confidence="high", warnings=[], max_chunks=4,
        answer_mode="compare_documents",
    ))

    assert llm.models == ["dia-premium"]
    assert llm.metadata[0]["chat_model_tier"] == "external_premium"


def test_local_only_mode_never_uses_external_model() -> None:
    llm = CaptureLLMClient()
    settings = replace(
        _settings(),
        model_routing_mode="local_only",
        external_chat_model="gpt-5.6-luna",
    )
    composer = AnswerComposer(settings, llm)
    chunk = _chunk("public").model_copy(update={"metadata": {
        "policy_binding_id": "pb_public",
        "policy_hash": "sha256:public",
        "policy_summary": {"handlingClass": "PUBLIC", "obligations": []},
    }})

    asyncio.run(composer.compose(
        query_id="query-local-only",
        query="Analyzuj povinnosti, výjimky a rizika tohoto zákona.",
        chunks=[chunk], confidence="high", warnings=[], max_chunks=4,
    ))

    assert llm.models == ["gemma4:31b-mlx"]
    assert llm.metadata[0]["chat_model_tier"] == "local_high_quality"


def test_source_quality_metadata_is_promoted_to_answer_warnings() -> None:
    llm = CaptureLLMClient()
    settings = _settings()
    composer = AnswerComposer(settings, llm)

    answer = asyncio.run(
        composer.compose(
            query_id="query-ocr-quality",
            query="Co rika sken?",
            chunks=[
                _chunk("chunk_ocr").model_copy(
                    update={
                        "metadata": {
                            "ocr_used": True,
                            "parser_engine": "ocrmypdf",
                            "parser_quality": {
                                "quality_tier": "review",
                                "requires_review": True,
                            },
                        }
                    }
                )
            ],
            confidence="medium",
            warnings=["BASE_WARNING"],
            max_chunks=4,
            answer_mode="normative_with_citations",
        )
    )

    assert answer.warnings == [
        "BASE_WARNING",
        "SOURCE_OCR_USED",
        "SOURCE_QUALITY_REVIEW_REQUIRED",
    ]


def test_model_abstention_drops_unrelated_citations_and_confidence() -> None:
    llm = CaptureLLMClient(
        "V poskytnutém kontextu není uveden limit veřejné zakázky."
    )
    composer = AnswerComposer(_settings(), llm)

    answer = asyncio.run(
        composer.compose(
            query_id="query-unsupported",
            query="Jaký je limit veřejné zakázky?",
            chunks=[_chunk("chunk_unrelated")],
            confidence="high",
            warnings=[],
            max_chunks=4,
            answer_mode="it_support_answer",
            response_language="cs",
        )
    )

    assert answer.confidence == "insufficient_source"
    assert answer.citations == []
    assert answer.used_chunks == []
    assert answer.warnings == ["LLM_DECLINED_INSUFFICIENT_CONTEXT"]
    assert "dostatečně důvěryhodný zdroj" in answer.answer


def test_premature_abstention_is_retried_once_with_the_same_authorized_context() -> None:
    class RecoveringLLMClient(CaptureLLMClient):
        async def chat_completion(self, **kwargs: Any) -> str:
            self.models.append(kwargs.get("model"))
            self.metadata.append(kwargs["metadata"])
            self.messages.append(kwargs["messages"])
            if len(self.messages) == 1:
                return "V poskytnutém kontextu nejsou uvedeny povinnosti zaměstnanců."
            return "Zaměstnanec musí zachovávat mlčenlivost."

    llm = RecoveringLLMClient()
    composer = AnswerComposer(_settings(), llm)

    answer = asyncio.run(
        composer.compose(
            query_id="query-recovered",
            query="Jaké povinnosti má zaměstnanec?",
            chunks=[_chunk("chunk_1")],
            confidence="high",
            warnings=[],
            max_chunks=4,
            answer_mode="it_support_answer",
            response_language="cs",
        )
    )

    assert answer.answer == "Zaměstnanec musí zachovávat mlčenlivost."
    assert answer.confidence == "high"
    assert answer.used_chunks == ["chunk_1"]
    assert answer.warnings == ["LLM_ABSTENTION_RECOVERED"]
    assert len(llm.messages) == 2
    assert llm.metadata[1]["abstention_recovery"] is True
    assert llm.messages[0][1] == llm.messages[1][1]


def test_sourced_partial_answer_is_not_misclassified_as_total_abstention() -> None:
    llm = CaptureLLMClient(
        "Zaměstnanec musí zachovávat mlčenlivost [chunk_1]. "
        "V poskytnutém kontextu není uvedena samostatná lhůta."
    )
    composer = AnswerComposer(_settings(), llm)

    answer = asyncio.run(
        composer.compose(
            query_id="query-supported-partial",
            query="Jaká je povinnost a její lhůta?",
            chunks=[_chunk("chunk_1")],
            confidence="high",
            warnings=[],
            max_chunks=4,
            answer_mode="extract_obligations",
            response_language="cs",
        )
    )

    assert answer.confidence == "high"
    assert answer.used_chunks == ["chunk_1"]
    assert [citation.chunk_id for citation in answer.citations] == ["chunk_1"]
    assert "LLM_DECLINED_INSUFFICIENT_CONTEXT" not in answer.warnings


def test_context_budget_skips_oversized_hits_without_losing_later_sources() -> None:
    llm = CaptureLLMClient()
    composer = AnswerComposer(replace(_settings(), max_context_chars=140), llm)
    chunks = [
        _chunk("oversized").model_copy(update={"text": "X" * 141}),
        _chunk("infrastructure"),
        _chunk("does-not-fit").model_copy(update={"text": "Y" * 100}),
        _chunk("security"),
    ]
    answer = asyncio.run(composer.compose(
        query_id="bounded", query="Describe infrastructure and security.", chunks=chunks,
        confidence="medium", warnings=[], max_chunks=4,
    ))
    assert answer.used_chunks == ["infrastructure", "security"]
    assert [citation.chunk_id for citation in answer.citations] == answer.used_chunks
    assert "CONTEXT_TRUNCATED" in answer.warnings
    assert "X" * 141 not in llm.messages[0][1]["content"]
    assert "Y" * 100 not in llm.messages[0][1]["content"]


def test_empty_oversized_or_low_scoring_context_never_calls_a_model() -> None:
    for chunks in [[], [_chunk("too-large")], [_chunk("low").model_copy(update={"score": 0.0})], [_chunk("blank").model_copy(update={"text": "  "})]]:
        llm = CaptureLLMClient()
        composer = AnswerComposer(replace(_settings(), max_context_chars=10), llm)
        answer = asyncio.run(composer.compose(
            query_id="no-context", query="What is guaranteed?", chunks=chunks,
            confidence="high", warnings=[], max_chunks=4,
        ))
        assert llm.models == []
        assert answer.confidence == "insufficient_source"
        assert answer.citations == [] and answer.used_chunks == []
        assert "NO_USABLE_CONTEXT" in answer.warnings


def test_empty_context_stream_and_director_extract_remain_fail_closed() -> None:
    llm = CaptureLLMClient()
    composer = AnswerComposer(replace(_settings(), max_context_chars=10), llm)

    async def collect():
        return [event async for event in composer.compose_stream(
            query_id="no-stream-context", query="Describe AKB", chunks=[_chunk("too-large")],
            confidence="high", warnings=[], max_chunks=4,
        )]

    events = asyncio.run(collect())
    assert [event.kind for event in events] == ["done"]
    assert events[0].answer.confidence == "insufficient_source"
    assert events[0].answer.citations == []
    extract = composer.compose_director_findings(
        query_id="no-extract-context", chunks=[], confidence="high", warnings=[], max_chunks=4,
    )
    assert extract.confidence == "insufficient_source"
    assert extract.citations == [] and extract.used_chunks == []
    assert llm.models == []


def test_prompt_keeps_pilot_proposals_templates_and_live_facts_distinct() -> None:
    llm = CaptureLLMClient()
    composer = AnswerComposer(_settings(), llm)
    asyncio.run(composer.compose(
        query_id="qualified-sources", query="What is the required RAM and guaranteed RPO?",
        chunks=[_chunk("pilot")], confidence="medium", warnings=[], max_chunks=4,
        answer_mode="explain_process",
    ))
    prompt = llm.messages[0][0]["content"]
    assert "unfilled template" in prompt
    assert "contractual guarantees" in prompt
    assert "current live business data" in prompt
    assert "untrusted evidence" in prompt


def _settings():
    return load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_RAG_DEPENDENCY_MODE": "mock",
            "AKL_RAG_CHAT_MODEL": "gemma4:12b-mlx",
            "AKL_RAG_HIGH_QUALITY_CHAT_MODEL": "gemma4:31b-mlx",
            "AKL_RAG_HIGH_QUALITY_MIN_CONTEXT_CHUNKS": "3",
        }
    )


def _chunk(chunk_id: str) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=chunk_id,
        score=0.95,
        retrieval_method="hybrid",
        text="Architektura popisuje system, jeho prvky, vztahy a principy navrhu.",
        citation=ChunkCitation(
            document_id="doc_1",
            document_version_id="ver_1",
            document_title="Metodika architektury",
            version_label="v1",
            page_number=1,
            section_path=["Uvod"],
        ),
    )
