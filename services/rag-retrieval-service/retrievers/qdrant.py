from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.config import Settings
from app.http_utils import request_json_with_retry
from app.schemas import ChunkCitation, RagQueryFilters, RetrievedChunk
from retrievers.scoring import CLASSIFICATION_ORDER, deterministic_embedding, hybrid_score, sparse_score


class QdrantHybridRetriever:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def retrieve(
        self,
        *,
        query: str,
        filters: RagQueryFilters,
        limit: int,
        query_vector: list[float] | None = None,
    ) -> list[RetrievedChunk]:
        vector = query_vector or deterministic_embedding(query)
        body = {
            "vector": vector,
            "limit": limit,
            "with_payload": True,
            "with_vector": False,
            "filter": _qdrant_filter(filters),
        }
        payload = await request_json_with_retry(
            dependency="qdrant",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.qdrant_base_url}/collections/{self._settings.qdrant_collection}/points/search",
            json_body=body,
        )
        points = payload.get("result", [])
        chunks: list[RetrievedChunk] = []
        for point in points:
            point_payload = point.get("payload", {})
            if not isinstance(point_payload, dict):
                continue
            text = str(point_payload.get("text") or point_payload.get("normalized_text") or "").strip()
            if not text:
                continue

            dense = max(0.0, min(1.0, float(point.get("score", 0.0))))
            sparse = sparse_score(query, text)
            score = hybrid_score(dense, sparse, self._settings.hybrid_dense_weight)
            chunks.append(_point_to_chunk(point_payload, score=score, dense_score=dense, sparse_score=sparse))

        return sorted(chunks, key=lambda item: item.score, reverse=True)[:limit]

    async def get_chunk(self, chunk_id: str) -> RetrievedChunk | None:
        payload = await request_json_with_retry(
            dependency="qdrant",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.qdrant_base_url}/collections/{self._settings.qdrant_collection}/points/scroll",
            json_body={
                "limit": 1,
                "with_payload": True,
                "with_vector": False,
                "filter": {
                    "must": [
                        {"key": "chunk_id", "match": {"value": chunk_id}},
                    ]
                },
            },
        )
        result = payload.get("result", {})
        points = result.get("points", []) if isinstance(result, dict) else []
        if not points:
            return None
        point_payload = points[0].get("payload", {})
        if not isinstance(point_payload, dict):
            return None
        text = str(point_payload.get("text") or point_payload.get("normalized_text") or "").strip()
        if not text:
            return None
        return _point_to_chunk(point_payload, score=1.0, dense_score=1.0, sparse_score=1.0)

    async def readiness(self) -> str:
        try:
            await request_json_with_retry(
                dependency="qdrant",
                settings=self._settings,
                method="GET",
                url=f"{self._settings.qdrant_base_url}/collections/{self._settings.qdrant_collection}",
            )
        except Exception:
            return "not_ready"
        return "ready"


def _point_to_chunk(
    payload: dict[str, Any],
    *,
    score: float,
    dense_score: float,
    sparse_score: float,
) -> RetrievedChunk:
    chunk_metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    chunk_id = str(payload.get("chunk_id") or "")
    document_id = str(payload.get("document_id") or "")
    document_version_id = str(payload.get("document_version_id") or "")
    return RetrievedChunk(
        chunk_id=chunk_id,
        score=round(score, 6),
        retrieval_method="qdrant",
        text=str(payload.get("text") or payload.get("normalized_text")),
        citation=ChunkCitation(
            document_id=document_id,
            document_version_id=document_version_id,
            document_title=str(payload.get("document_title") or chunk_metadata.get("document_title") or document_id),
            version_label=str(payload.get("version_label") or chunk_metadata.get("version_label") or document_version_id),
            page_number=payload.get("page_number"),
            section_path=list(payload.get("section_path") or []),
            article_number=payload.get("article_number"),
            paragraph_number=payload.get("paragraph_number"),
        ),
        metadata={
            "dense_score": round(dense_score, 6),
            "sparse_score": round(sparse_score, 6),
            "classification": payload.get("classification"),
            "document_type": payload.get("document_type") or chunk_metadata.get("document_type"),
            "tags": payload.get("tags", chunk_metadata.get("tags", [])),
            "status": payload.get("status") or chunk_metadata.get("status"),
            "source_file_uri": payload.get("source_file_uri") or chunk_metadata.get("source_file_uri"),
            "source_file_name": payload.get("source_file_name") or chunk_metadata.get("source_file_name"),
            "source_mime_type": payload.get("source_mime_type") or chunk_metadata.get("source_mime_type"),
            "source_size_bytes": payload.get("source_size_bytes"),
            "source_sha256": payload.get("source_sha256") or chunk_metadata.get("source_file_sha256"),
            "section_title": payload.get("section_title"),
            "char_start": payload.get("char_start"),
            "char_end": payload.get("char_end"),
        },
    )


def _qdrant_filter(filters: RagQueryFilters) -> dict[str, Any]:
    must: list[dict[str, Any]] = []

    allowed_classifications = CLASSIFICATION_ORDER[
        : CLASSIFICATION_ORDER.index(filters.classification_max) + 1
    ]
    must.append({"key": "classification", "match": {"any": list(allowed_classifications)}})

    if filters.document_types:
        must.append({"key": "document_type", "match": {"any": filters.document_types}})

    if filters.tags:
        must.append({"key": "tags", "match": {"any": filters.tags}})

    if filters.only_valid:
        today = datetime.now(UTC).date().isoformat()
        must.append({"key": "status", "match": {"value": "valid"}})
        must.append({"key": "valid_from", "range": {"lte": today}})

    return {"must": must}


def create_retriever(settings: Settings):
    if settings.retriever_mode == "mock":
        return MockHybridRetriever(settings)
    return QdrantHybridRetriever(settings)


from retrievers.mock import MockHybridRetriever  # noqa: E402
