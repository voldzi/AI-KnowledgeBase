from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from app.config import Settings
from app.http_utils import request_json_with_retry
from app.schemas import ChunkCitation, RagQueryFilters, RetrievedChunk
from retrievers.scoring import CLASSIFICATION_ORDER, deterministic_embedding, hybrid_score, normalize_text, sparse_score


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
        vector_chunks, lexical_chunks = await asyncio.gather(
            self._retrieve_vector_candidates(query=query, filters=filters, limit=limit, vector=vector),
            self._retrieve_lexical_candidates(query=query, filters=filters, limit=max(limit * 3, 50)),
        )
        return _fuse_ranked_chunks(vector_chunks, lexical_chunks)[:limit]

    async def _retrieve_vector_candidates(
        self,
        *,
        query: str,
        filters: RagQueryFilters,
        limit: int,
        vector: list[float],
    ) -> list[RetrievedChunk]:
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
        return _points_to_hybrid_chunks(
            query=query,
            points=payload.get("result", []),
            dense_weight=self._settings.hybrid_dense_weight,
        )

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

    async def get_neighbors(self, chunk: RetrievedChunk) -> tuple[str, str]:
        """Return (before_text, after_text) from the chunks adjacent to the
        given chunk inside the same document version, based on chunk_index."""
        chunk_index = chunk.metadata.get("chunk_index")
        document_version_id = chunk.citation.document_version_id
        if not isinstance(chunk_index, int) or not document_version_id:
            return "", ""
        payload = await request_json_with_retry(
            dependency="qdrant",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.qdrant_base_url}/collections/{self._settings.qdrant_collection}/points/scroll",
            json_body={
                "limit": 8,
                "with_payload": True,
                "with_vector": False,
                "filter": {
                    "must": [
                        {"key": "document_version_id", "match": {"value": document_version_id}},
                        {
                            "key": "metadata.chunk_index",
                            "range": {"gte": chunk_index - 1, "lte": chunk_index + 1},
                        },
                    ]
                },
            },
        )
        result = payload.get("result", {})
        points = result.get("points", []) if isinstance(result, dict) else []
        before_text = ""
        after_text = ""
        for point in points:
            if not isinstance(point, dict):
                continue
            point_payload = point.get("payload", {})
            if not isinstance(point_payload, dict):
                continue
            point_metadata = point_payload.get("metadata") if isinstance(point_payload.get("metadata"), dict) else {}
            point_index = point_metadata.get("chunk_index")
            text = str(point_payload.get("text") or "").strip()
            if point_index == chunk_index - 1:
                before_text = text
            elif point_index == chunk_index + 1:
                after_text = text
        return before_text, after_text

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

    async def _retrieve_lexical_candidates(
        self,
        *,
        query: str,
        filters: RagQueryFilters,
        limit: int,
    ) -> list[RetrievedChunk]:
        # The indexed normalized_text field may contain diacritics (documents
        # ingested before normalization was unified) or have them stripped
        # (current ingestion).  Match both variants via a should clause so
        # lexical recall works across both index generations.
        normalized_query = normalize_text(query)
        lowercase_query = query.strip().lower()
        text_conditions: list[dict[str, Any]] = [
            {"key": "normalized_text", "match": {"text": normalized_query}},
        ]
        if lowercase_query and lowercase_query != normalized_query:
            text_conditions.append({"key": "normalized_text", "match": {"text": lowercase_query}})
        base_must = _qdrant_filter(filters).get("must", [])
        combined_filter: dict[str, Any] = {
            "must": base_must,
            "should": text_conditions,
        }
        payload = await request_json_with_retry(
            dependency="qdrant",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.qdrant_base_url}/collections/{self._settings.qdrant_collection}/points/scroll",
            json_body={
                "limit": limit,
                "with_payload": True,
                "with_vector": False,
                "filter": combined_filter,
            },
        )
        result = payload.get("result", {})
        points = result.get("points", []) if isinstance(result, dict) else []
        return _points_to_lexical_chunks(query=query, points=points)


def _points_to_hybrid_chunks(*, query: str, points: Any, dense_weight: float) -> list[RetrievedChunk]:
    if not isinstance(points, list):
        return []

    chunks: list[RetrievedChunk] = []
    for point in points:
        if not isinstance(point, dict):
            continue
        point_payload = point.get("payload", {})
        if not isinstance(point_payload, dict):
            continue
        text = str(point_payload.get("text") or point_payload.get("normalized_text") or "").strip()
        if not text:
            continue

        dense = max(0.0, min(1.0, float(point.get("score", 0.0))))
        sparse = sparse_score(query, text)
        score = hybrid_score(dense, sparse, dense_weight)
        chunks.append(_point_to_chunk(point_payload, score=score, dense_score=dense, sparse_score=sparse))

    return chunks


def _points_to_lexical_chunks(*, query: str, points: Any) -> list[RetrievedChunk]:
    if not isinstance(points, list):
        return []

    chunks: list[RetrievedChunk] = []
    for point in points:
        if not isinstance(point, dict):
            continue
        point_payload = point.get("payload", {})
        if not isinstance(point_payload, dict):
            continue
        text = str(point_payload.get("text") or point_payload.get("normalized_text") or "").strip()
        if not text:
            continue

        sparse = sparse_score(query, text)
        if sparse <= 0:
            continue
        chunk = _point_to_chunk(point_payload, score=sparse, dense_score=0.0, sparse_score=sparse)
        chunks.append(
            chunk.model_copy(
                update={
                    "metadata": {
                        **chunk.metadata,
                        "lexical_fallback": True,
                    }
                }
            )
        )

    return chunks


RRF_K = 60


def _fuse_ranked_chunks(
    vector_chunks: list[RetrievedChunk],
    lexical_chunks: list[RetrievedChunk],
) -> list[RetrievedChunk]:
    """Reciprocal Rank Fusion across the dense and lexical rankings.

    RRF is scale-free, so it is robust against the incomparable score
    distributions of cosine similarity vs lexical overlap.  The fused order
    decides ranking; chunk.score keeps the calibrated hybrid value used by
    the no-answer policy and confidence thresholds.
    """
    dense_ranked = sorted(vector_chunks, key=lambda item: item.metadata.get("dense_score", 0.0), reverse=True)
    lexical_ranked = sorted(lexical_chunks, key=lambda item: item.metadata.get("sparse_score", 0.0), reverse=True)

    rrf_scores: dict[str, float] = {}
    for ranking in (dense_ranked, lexical_ranked):
        for rank, chunk in enumerate(ranking):
            rrf_scores[chunk.chunk_id] = rrf_scores.get(chunk.chunk_id, 0.0) + 1.0 / (RRF_K + rank + 1)

    best_by_chunk_id: dict[str, RetrievedChunk] = {}
    for chunk in [*vector_chunks, *lexical_chunks]:
        existing = best_by_chunk_id.get(chunk.chunk_id)
        if existing is None or (chunk.score, chunk.metadata.get("sparse_score", 0)) > (
            existing.score,
            existing.metadata.get("sparse_score", 0),
        ):
            best_by_chunk_id[chunk.chunk_id] = chunk

    fused: list[RetrievedChunk] = []
    for chunk in best_by_chunk_id.values():
        rrf = round(rrf_scores.get(chunk.chunk_id, 0.0), 6)
        fused.append(chunk.model_copy(update={"metadata": {**chunk.metadata, "rrf_score": rrf}}))
    return sorted(
        fused,
        key=lambda item: (
            item.metadata.get("rrf_score", 0.0),
            item.score,
            item.metadata.get("sparse_score", 0),
        ),
        reverse=True,
    )


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
            "chunk_index": chunk_metadata.get("chunk_index"),
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
