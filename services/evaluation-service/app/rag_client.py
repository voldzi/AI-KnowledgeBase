from __future__ import annotations

import hashlib
import unicodedata
from typing import Protocol

from app.config import Settings
from app.http_utils import request_json_with_retry
from app.schemas import (
    ChunkCitation,
    Citation,
    RagAnswer,
    RagQueryRequest,
    RetrieveRequest,
    RetrieveResponse,
    RetrievedChunk,
)


class RagClient(Protocol):
    async def retrieve(self, payload: RetrieveRequest) -> RetrieveResponse:
        ...

    async def query(self, payload: RagQueryRequest) -> RagAnswer:
        ...

    async def readiness(self) -> str:
        ...


class MockRagClient:
    async def retrieve(self, payload: RetrieveRequest) -> RetrieveResponse:
        chunks = _mock_chunks(payload.query)[: payload.max_chunks]
        return RetrieveResponse(
            query_id=_query_id(payload.query),
            chunks=chunks,
            warnings=[] if chunks else ["NO_RETRIEVAL_CANDIDATES"],
        )

    async def query(self, payload: RagQueryRequest) -> RagAnswer:
        chunks = _mock_chunks(payload.query)[: payload.max_chunks]
        query_id = _query_id(payload.query)
        if not chunks:
            return RagAnswer(
                query_id=query_id,
                answer="K dotazu nebyl nalezen dostatečně důvěryhodný zdroj.",
                confidence="insufficient_source",
                citations=[],
                warnings=["LOW_RELEVANCE"],
                used_chunks=[],
                missing_information="No sufficiently relevant authorized source was found.",
            )

        citations = [_citation_from_chunk(chunks[0])]
        return RagAnswer(
            query_id=query_id,
            answer="Vyjimku ze smernice schvaluje gestor dokumentu podle citovaneho zdroje.",
            confidence="high",
            citations=citations,
            warnings=[],
            used_chunks=[chunks[0].chunk_id],
            missing_information=None,
        )

    async def readiness(self) -> str:
        return "ready"


class HttpRagClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def retrieve(self, payload: RetrieveRequest) -> RetrieveResponse:
        response = await request_json_with_retry(
            dependency="rag-retrieval-service",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.rag_base_url}/rag/retrieve",
            json_body=payload.model_dump(mode="json"),
        )
        return RetrieveResponse.model_validate(response)

    async def query(self, payload: RagQueryRequest) -> RagAnswer:
        response = await request_json_with_retry(
            dependency="rag-retrieval-service",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.rag_base_url}/rag/query",
            json_body=payload.model_dump(mode="json"),
        )
        return RagAnswer.model_validate(response)

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
        return MockRagClient()
    return HttpRagClient(settings)


def _query_id(query: str) -> str:
    return f"query_mock_{hashlib.sha256(query.encode('utf-8')).hexdigest()[:12]}"


def _mock_chunks(query: str) -> list[RetrievedChunk]:
    normalized = _normalize(query)
    if "vyjim" not in normalized and "vyjimku" not in normalized:
        return []

    return [
        RetrievedChunk(
            chunk_id="chunk_789",
            score=0.93,
            retrieval_method="hybrid",
            text="Vyjimku ze smernice schvaluje gestor dokumentu.",
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
            metadata={"mock": True, "dense_score": 0.91, "sparse_score": 0.86},
        )
    ]


def _citation_from_chunk(chunk: RetrievedChunk) -> Citation:
    return Citation(
        document_id=chunk.citation.document_id,
        document_version_id=chunk.citation.document_version_id,
        document_title=chunk.citation.document_title,
        version_label=chunk.citation.version_label,
        section_path=chunk.citation.section_path,
        page_number=chunk.citation.page_number,
        chunk_id=chunk.chunk_id,
    )


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_value = decomposed.encode("ascii", "ignore").decode("ascii")
    return ascii_value.casefold()
