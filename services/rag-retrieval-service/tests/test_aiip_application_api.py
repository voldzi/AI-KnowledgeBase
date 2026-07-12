from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from answer_composer.composer import AnswerComposer
from app.config import load_settings
from app.errors import RetrievalError
from app.llm_client import ChatCompletionResult
from app.main import create_app
from app.registry_client import MockRegistryClient
from app.schemas import (
    AiipDuplicateSearchRequest,
    AiipHarmonizeRequest,
    ChunkCitation,
    RetrievedChunk,
)
from app.security import AuthContext
from app.service import RagRetrievalService
from policies.no_answer import NoAnswerPolicy
from rerankers.lexical import LexicalReranker


class AiipLLMClient:
    def __init__(self, outputs: list[str], *, actual_model: str = "gemma4:12b-mlx") -> None:
        self.outputs = list(outputs)
        self.actual_model = actual_model

    async def embeddings(self, texts, *, auth_context=None):
        return [[0.1, 0.2, 0.3] for _ in texts]

    async def chat_completion(self, *, messages, metadata, model=None, auth_context=None):
        return (await self.chat_completion_result(
            messages=messages, metadata=metadata, model=model, auth_context=auth_context
        )).content

    async def chat_completion_result(self, *, messages, metadata, model=None, auth_context=None):
        return ChatCompletionResult(
            content=self.outputs.pop(0),
            model=self.actual_model,
            prompt_tokens=100,
            completion_tokens=40,
            total_tokens=140,
        )

    async def readiness(self):
        return "ready"


class StaticRetriever:
    async def retrieve(self, *, query, filters, limit, query_vector=None):
        return [
            RetrievedChunk(
                chunk_id="chunk_aiip_1",
                score=0.91,
                retrieval_method="hybrid",
                text="Automatizace zpracování podnětů s využitím AI.",
                citation=ChunkCitation(
                    document_id="doc_aiip_1",
                    document_version_id="ver_aiip_1",
                    document_title="AI automatizace podnětů",
                    version_label="1",
                    section_path=["Nápad"],
                ),
                metadata={
                    "external_system": "AIIP",
                    "external_ref": "idea-42",
                    "document_type": "ai_intake",
                    "classification": "internal",
                    "keywords": ["AI", "automatizace"],
                },
            )
        ][:limit]

    async def get_chunk(self, chunk_id):
        return None

    async def readiness(self):
        return "ready"


def _settings():
    return load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "mock",
            "AKL_RAG_DEPENDENCY_MODE": "mock",
            "AKL_RAG_REGISTRY_CLIENT_MODE": "mock",
            "AKL_RAG_RETRIEVER_MODE": "mock",
            "AKL_RAG_LLM_CLIENT_MODE": "mock",
            "AKL_RAG_AUTHZ_MODE": "dev",
            "AKL_RAG_CHAT_MODEL": "gemma4:12b-mlx",
            "AKL_RAG_HIGH_QUALITY_CHAT_MODEL": "gemma4:31b-mlx",
            "AKL_SERVICE_ACCOUNT_ROLES": "service_rag",
        }
    )


def _service(llm: AiipLLMClient) -> RagRetrievalService:
    settings = _settings()
    return RagRetrievalService(
        settings=settings,
        registry_client=MockRegistryClient(settings),
        retriever=StaticRetriever(),
        reranker=LexicalReranker(),
        llm_client=llm,
        no_answer_policy=NoAnswerPolicy(settings),
        answer_composer=AnswerComposer(settings, llm),
    )


def _auth() -> AuthContext:
    return AuthContext(subject_id="svc-aiip", roles=("service_aiip",), groups=())


def _record() -> dict[str, Any]:
    return {
        "record_id": "idea-100",
        "record_version": "3",
        "title": "Automatizace podnětů",
        "summary": "Nápad využívá AI pro třídění a harmonizaci podnětů.",
        "keywords": ["AI", "automatizace"],
    }


def _valid_harmonize_output() -> str:
    return json.dumps(
        {
            "suggestions": [
                {
                    "field": "normalized_title",
                    "proposed_value": "AI automatizace podnětů",
                    "confidence": 0.92,
                    "provenance": {
                        "source": "model_inference",
                        "input_fields": ["title", "summary"],
                        "prompt_template_version": "aiip-harmonize-v1",
                    },
                }
            ],
            "review_required": True,
        }
    )


def test_harmonize_validates_json_records_model_fallback_and_replays() -> None:
    service = _service(AiipLLMClient([_valid_harmonize_output()]))
    payload = AiipHarmonizeRequest(
        tenant_id="stratos",
        classification="internal",
        processing_purpose="idea_harmonization",
        model_preference="high_quality",
        locale="cs",
        record=_record(),
    )
    first = asyncio.run(service.aiip_harmonize(payload, idempotency_key="idem-harmonize-1", auth_context=_auth()))
    replay = asyncio.run(service.aiip_harmonize(payload, idempotency_key="idem-harmonize-1", auth_context=_auth()))

    assert first.response.model.requested_model == "gemma4:31b-mlx"
    assert first.response.model.actual_model == "gemma4:12b-mlx"
    assert first.response.model.fallback_applied is True
    assert first.response.usage.total_tokens == 140
    assert replay.replayed is True
    assert replay.response.model_dump() == first.response.model_dump()


def test_harmonize_repair_failure_returns_stable_422() -> None:
    service = _service(AiipLLMClient(["not json", "still not json"]))
    payload = AiipHarmonizeRequest(
        tenant_id="stratos",
        classification="internal",
        processing_purpose="idea_harmonization",
        record=_record(),
    )
    with pytest.raises(RetrievalError) as exc_info:
        asyncio.run(service.aiip_harmonize(payload, idempotency_key="idem-harmonize-2", auth_context=_auth()))
    assert exc_info.value.status_code == 422
    assert exc_info.value.code == "STRUCTURED_OUTPUT_INVALID"


def test_duplicate_search_returns_authorized_cited_candidate() -> None:
    service = _service(AiipLLMClient([]))
    payload = AiipDuplicateSearchRequest(
        tenant_id="stratos",
        classification="internal",
        processing_purpose="duplicate_detection",
        record=_record(),
        limit=10,
        min_score=0.35,
    )
    execution = asyncio.run(
        service.aiip_duplicate_search(payload, idempotency_key="idem-duplicates-1", auth_context=_auth())
    )
    replay = asyncio.run(
        service.aiip_duplicate_search(payload, idempotency_key="idem-duplicates-1", auth_context=_auth())
    )
    result = execution.response.result
    assert result.candidates[0].candidate_id == "idea-42"  # type: ignore[union-attr]
    assert result.candidates[0].citations[0].chunk_id == "chunk_aiip_1"  # type: ignore[union-attr]
    assert execution.response.retrieval_index_version
    assert replay.replayed is True
    assert replay.response.model_dump() == execution.response.model_dump()


def test_endpoint_rejects_sensitive_classification_before_service_call() -> None:
    settings = _settings()
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/integrations/aiip/harmonize",
            headers={
                "Authorization": "Bearer mock-token",
                "X-AKL-Subject": "svc-aiip",
                "X-AKL-Roles": "service_aiip",
                "Idempotency-Key": "idem-sensitive-1",
            },
            json={
                "tenant_id": "stratos",
                "classification": "restricted",
                "processing_purpose": "idea_harmonization",
                "record": _record(),
            },
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLASSIFICATION_NOT_ALLOWED"
