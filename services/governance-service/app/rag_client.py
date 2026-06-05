from __future__ import annotations

from typing import Protocol

from app.config import Settings
from app.http_utils import request_json_with_retry
from app.schemas import ChunkCitation, RagQueryFilters, RetrievedChunk


class RagClient(Protocol):
    async def retrieve(
        self,
        *,
        subject_id: str,
        query: str,
        filters: RagQueryFilters,
        max_chunks: int,
    ) -> list[RetrievedChunk]:
        ...

    async def readiness(self) -> str:
        ...


class MockRagClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def retrieve(
        self,
        *,
        subject_id: str,
        query: str,
        filters: RagQueryFilters,
        max_chunks: int,
    ) -> list[RetrievedChunk]:
        return _mock_chunks()[:max_chunks]

    async def readiness(self) -> str:
        return "ready"


class HttpRagClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def retrieve(
        self,
        *,
        subject_id: str,
        query: str,
        filters: RagQueryFilters,
        max_chunks: int,
    ) -> list[RetrievedChunk]:
        payload = await request_json_with_retry(
            dependency="rag-retrieval-service",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.rag_base_url}/rag/retrieve",
            json_body={
                "subject_id": subject_id,
                "query": query,
                "filters": filters.model_dump(),
                "max_chunks": max_chunks,
            },
        )
        return [RetrievedChunk.model_validate(chunk) for chunk in payload.get("chunks", [])]

    async def readiness(self) -> str:
        try:
            await request_json_with_retry(
                dependency="rag-retrieval-service",
                settings=self._settings,
                method="GET",
                url=f"{self._settings.rag_base_url.removesuffix('/api/v1')}/ready",
            )
        except Exception:
            return "not_ready"
        return "ready"


def create_rag_client(settings: Settings) -> RagClient:
    if settings.rag_client_mode == "mock":
        return MockRagClient(settings)
    return HttpRagClient(settings)


def _mock_chunks() -> list[RetrievedChunk]:
    return [
        RetrievedChunk(
            chunk_id="chunk_gov_001",
            score=0.92,
            retrieval_method="hybrid",
            text=(
                "Kazdy rizeny dokument musi mit urceneho gestora nebo vlastnika, stav platnosti "
                "a vazbu na aktualni verzi v registru dokumentu."
            ),
            citation=ChunkCitation(
                document_id="doc_124",
                document_version_id="ver_457",
                document_title="Metodika rizeni platnosti dokumentu",
                version_label="2.1",
                page_number=3,
                section_path=["Kap. 2"],
            ),
            metadata={"document_type": "methodology", "classification": "internal", "status": "valid"},
        ),
        RetrievedChunk(
            chunk_id="chunk_gov_002",
            score=0.88,
            retrieval_method="hybrid",
            text=(
                "Vyjimku ze smernice schvaluje gestor dokumentu po posouzeni dopadu. "
                "Zadost musi obsahovat duvod, rozsah a dobu platnosti vyjimky."
            ),
            citation=ChunkCitation(
                document_id="doc_123",
                document_version_id="ver_456",
                document_title="Smernice pro spravu dokumentu",
                version_label="1.0",
                page_number=7,
                section_path=["Cl. 4", "Odst. 2"],
                article_number="4",
                paragraph_number="2",
            ),
            metadata={"document_type": "directive", "classification": "internal", "status": "valid"},
        ),
    ]
