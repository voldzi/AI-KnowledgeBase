from __future__ import annotations

import logging
from typing import Any

from fastapi.testclient import TestClient

from answer_composer.composer import AnswerComposer
from app.config import load_settings
from app.main import create_app
from app.registry_client import create_registry_client
from app.schemas import ChunkCitation, RagQueryFilters, RetrievedChunk
from app.security import AuthContext
from app.service import RagRetrievalService
from policies.no_answer import NoAnswerPolicy
from rerankers.lexical import LexicalReranker


class FakeQdrantRetriever:
    async def retrieve(
        self,
        *,
        query: str,
        filters: RagQueryFilters,
        limit: int,
        query_vector: list[float] | None = None,
    ) -> list[RetrievedChunk]:
        return [
            RetrievedChunk(
                chunk_id="chunk_qdrant_dev",
                score=0.92,
                retrieval_method="qdrant",
                text="Vyjimku ze smernice schvaluje reditel odboru.",
                citation=ChunkCitation(
                    document_id="doc_qdrant_dev",
                    document_version_id="ver_qdrant_dev",
                    document_title="Smernice pro spravu testovaci dokumentace",
                    version_label="1.0",
                    page_number=1,
                    section_path=["Clanek 2 - Schvalovani vyjimky"],
                    article_number="2",
                ),
                metadata={"status": "valid", "classification": "internal"},
            )
        ]

    async def readiness(self) -> str:
        return "ready"


class FakeLLMClient:
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
        return "Fake answer."

    async def readiness(self) -> str:
        return "ready"


def test_retrieve_endpoint_dev_authz_allows_qdrant_candidates(caplog) -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_RAG_REGISTRY_CLIENT_MODE": "http",
            "AKL_RAG_RETRIEVER_MODE": "qdrant",
            "AKL_RAG_LLM_CLIENT_MODE": "mock",
            "AKL_RAG_AUTHZ_MODE": "dev",
        }
    )
    llm_client = FakeLLMClient()
    app = create_app(settings)

    with TestClient(app) as client:
        client.app.state.rag_service = RagRetrievalService(
            settings=settings,
            registry_client=create_registry_client(settings),
            retriever=FakeQdrantRetriever(),
            reranker=LexicalReranker(),
            llm_client=llm_client,
            no_answer_policy=NoAnswerPolicy(settings),
            answer_composer=AnswerComposer(settings, llm_client),
        )

        caplog.set_level(logging.INFO)
        response = client.post(
            "/api/v1/rag/retrieve",
            json={
                "subject_id": "dev-user",
                "query": "Kdo schvaluje vyjimku ze smernice?",
                "filters": {
                    "document_types": ["directive"],
                    "only_valid": True,
                    "classification_max": "internal",
                    "tags": [],
                },
                "max_chunks": 4,
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["chunks"][0]["chunk_id"] == "chunk_qdrant_dev"
    assert "AUTHZ_FILTERED_SOURCES" not in body["warnings"]
    assert any(
        "retriever_mode=qdrant" in record.message
        and "authz_mode=dev" in record.message
        and "candidates_before_authz=1" in record.message
        and "candidates_after_authz=1" in record.message
        for record in caplog.records
    )
