from __future__ import annotations

import asyncio
from typing import Any

from answer_composer.composer import AnswerComposer
from app.config import load_settings
from app.schemas import ChunkCitation, RetrievedChunk
from app.security import AuthContext


class CaptureLLMClient:
    def __init__(self) -> None:
        self.models: list[str | None] = []
        self.metadata: list[dict[str, Any]] = []

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
        return "Citovana odpoved."

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

    assert llm.models == [None]
    assert llm.metadata[0]["chat_model"] == "gemma4:12b-mlx"
    assert llm.metadata[0]["chat_model_tier"] == "standard"


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
    assert llm.metadata[0]["chat_model_tier"] == "high_quality"


def test_bounded_manager_brief_uses_standard_chat_model() -> None:
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

    assert llm.models == [None]
    assert llm.metadata[0]["chat_model"] == "gemma4:12b-mlx"
    assert llm.metadata[0]["chat_model_tier"] == "standard"


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
    assert llm.metadata[0]["chat_model_tier"] == "high_quality"


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
