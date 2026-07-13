from __future__ import annotations

import asyncio
from base64 import b64encode
from datetime import UTC, datetime
from typing import Any

import httpx

from app.config import Settings
from app.errors import RetrievalError
from app.http_utils import request_json_with_retry
from app.schemas import ChunkCitation, RagQueryFilters, RetrievedChunk
from retrievers.scoring import (
    CLASSIFICATION_ORDER,
    deterministic_embedding,
    expand_query_text,
    extract_query_identifiers,
    hybrid_score,
    normalize_text,
    sparse_score,
)


class QdrantHybridRetriever:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._opensearch = OpenSearchFullTextClient(settings) if settings.fulltext_mode == "opensearch" else None

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
        payload = await _request_qdrant_json_allow_missing(
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
        payload = await _request_qdrant_json_allow_missing(
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
        """Return (before_text, after_text) from chunks around the given chunk
        inside the same document version, based on chunk_index."""
        chunk_index = chunk.metadata.get("chunk_index")
        document_version_id = chunk.citation.document_version_id
        if not isinstance(chunk_index, int) or not document_version_id:
            return "", ""
        window = self._settings.source_context_window
        if window == 0:
            return "", ""
        payload = await _request_qdrant_json_allow_missing(
            settings=self._settings,
            method="POST",
            url=f"{self._settings.qdrant_base_url}/collections/{self._settings.qdrant_collection}/points/scroll",
            json_body={
                "limit": max(8, window * 2 + 1),
                "with_payload": True,
                "with_vector": False,
                "filter": {
                    "must": [
                        {"key": "document_version_id", "match": {"value": document_version_id}},
                        {
                            "key": "metadata.chunk_index",
                            "range": {"gte": chunk_index - window, "lte": chunk_index + window},
                        },
                    ]
                },
            },
        )
        result = payload.get("result", {})
        points = result.get("points", []) if isinstance(result, dict) else []
        before: list[tuple[int, str]] = []
        after: list[tuple[int, str]] = []
        for point in points:
            if not isinstance(point, dict):
                continue
            point_payload = point.get("payload", {})
            if not isinstance(point_payload, dict):
                continue
            point_metadata = point_payload.get("metadata") if isinstance(point_payload.get("metadata"), dict) else {}
            point_index = point_metadata.get("chunk_index")
            text = str(point_payload.get("text") or "").strip()
            if not text or not isinstance(point_index, int):
                continue
            if chunk_index - window <= point_index < chunk_index:
                before.append((point_index, text))
            elif chunk_index < point_index <= chunk_index + window:
                after.append((point_index, text))
        before_text = "\n\n".join(text for _, text in sorted(before))
        after_text = "\n\n".join(text for _, text in sorted(after))
        return before_text, after_text

    async def list_document_titles(self, *, limit: int = 64) -> list[dict[str, str]]:
        """Return distinct documents present in the index as
        [{"document_title": ..., "document_type": ...}], newest-first by scroll order."""
        payload = await _request_qdrant_json_allow_missing(
            settings=self._settings,
            method="POST",
            url=f"{self._settings.qdrant_base_url}/collections/{self._settings.qdrant_collection}/points/scroll",
            json_body={
                "limit": 512,
                "with_payload": ["document_id", "document_title", "document_type", "metadata"],
                "with_vector": False,
            },
        )
        result = payload.get("result", {})
        points = result.get("points", []) if isinstance(result, dict) else []
        seen: dict[str, dict[str, str]] = {}
        for point in points:
            if not isinstance(point, dict):
                continue
            point_payload = point.get("payload", {})
            if not isinstance(point_payload, dict):
                continue
            metadata = point_payload.get("metadata") if isinstance(point_payload.get("metadata"), dict) else {}
            document_id = str(point_payload.get("document_id") or "")
            title = str(point_payload.get("document_title") or metadata.get("document_title") or "").strip()
            if not document_id or not title or document_id in seen:
                continue
            seen[document_id] = {
                "document_title": title,
                "document_type": str(point_payload.get("document_type") or metadata.get("document_type") or ""),
            }
            if len(seen) >= limit:
                break
        return list(seen.values())

    async def readiness(self) -> str:
        try:
            await _request_qdrant_json_allow_missing(
                settings=self._settings,
                method="GET",
                url=f"{self._settings.qdrant_base_url}/collections/{self._settings.qdrant_collection}",
            )
            if self._opensearch is not None and await self._opensearch.readiness() != "ready":
                return "not_ready"
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
        if self._opensearch is not None:
            return await self._opensearch.retrieve(query=query, filters=filters, limit=limit)

        # The indexed normalized_text field may contain diacritics (documents
        # ingested before normalization was unified) or have them stripped
        # (current ingestion).  Match both variants via a should clause so
        # lexical recall works across both index generations.
        expanded_query = expand_query_text(query)
        normalized_query = normalize_text(query)
        normalized_expanded_query = normalize_text(expanded_query)
        lowercase_query = query.strip().lower()
        text_conditions: list[dict[str, Any]] = [
            {"key": "normalized_text", "match": {"text": normalized_query}},
        ]
        if normalized_expanded_query and normalized_expanded_query != normalized_query:
            text_conditions.append({"key": "normalized_text", "match": {"text": normalized_expanded_query}})
        if lowercase_query and lowercase_query != normalized_query:
            text_conditions.append({"key": "normalized_text", "match": {"text": lowercase_query}})
        base_must = _qdrant_filter(filters).get("must", [])
        combined_filter: dict[str, Any] = {
            "must": base_must,
            "should": text_conditions,
        }
        payload = await _request_qdrant_json_allow_missing(
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


class OpenSearchFullTextClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def readiness(self) -> str:
        try:
            async with httpx.AsyncClient(timeout=self._settings.request_timeout_seconds) as client:
                response = await client.get(
                    f"{self._settings.opensearch_base_url}/{self._settings.opensearch_index}",
                    headers=self._headers(),
                )
        except httpx.HTTPError:
            return "not_ready"
        return "ready" if response.status_code in {200, 404} else "not_ready"

    async def retrieve(self, *, query: str, filters: RagQueryFilters, limit: int) -> list[RetrievedChunk]:
        body = _opensearch_query(query=query, filters=filters, limit=limit)
        async with httpx.AsyncClient(timeout=self._settings.request_timeout_seconds) as client:
            response = await client.post(
                f"{self._settings.opensearch_base_url}/{self._settings.opensearch_index}/_search",
                headers=self._headers(),
                json=body,
            )
        if response.status_code == 404:
            return []
        if response.status_code >= 400:
            raise RetrievalError(
                "UPSTREAM_ERROR",
                "opensearch returned an error",
                status_code=502,
                details={"dependency": "opensearch", "status_code": response.status_code},
            )
        payload = response.json()
        return _opensearch_hits_to_chunks(query=query, payload=payload)

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._settings.opensearch_api_key:
            headers["Authorization"] = f"ApiKey {self._settings.opensearch_api_key}"
        elif self._settings.opensearch_username and self._settings.opensearch_password:
            token = b64encode(
                f"{self._settings.opensearch_username}:{self._settings.opensearch_password}".encode("utf-8")
            ).decode("ascii")
            headers["Authorization"] = f"Basic {token}"
        return headers


async def _request_qdrant_json_allow_missing(
    *,
    settings: Settings,
    method: str,
    url: str,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Treat an absent post-reset collection as an empty retrieval index."""
    try:
        return await request_json_with_retry(
            dependency="qdrant",
            settings=settings,
            method=method,
            url=url,
            json_body=json_body,
        )
    except RetrievalError as exc:
        if (exc.details or {}).get("status_code") == 404:
            return {}
        raise


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


def _opensearch_hits_to_chunks(*, query: str, payload: dict[str, Any]) -> list[RetrievedChunk]:
    hits_block = payload.get("hits")
    if not isinstance(hits_block, dict):
        return []
    hits = hits_block.get("hits")
    if not isinstance(hits, list):
        return []
    max_score = float(hits_block.get("max_score") or 0.0)
    chunks: list[RetrievedChunk] = []
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        source = hit.get("_source")
        if not isinstance(source, dict):
            continue
        text = str(source.get("text") or source.get("normalized_text") or "").strip()
        if not text:
            continue
        bm25_score = float(hit.get("_score") or 0.0)
        bm25_normalized = bm25_score / max_score if max_score > 0 else 0.0
        sparse = max(sparse_score(query, text), min(1.0, bm25_normalized * 0.85))
        if sparse <= 0:
            continue
        chunk = _point_to_chunk(source, score=sparse, dense_score=0.0, sparse_score=sparse)
        chunks.append(
            chunk.model_copy(
                update={
                    "retrieval_method": "opensearch",
                    "metadata": {
                        **chunk.metadata,
                        "opensearch_score": round(bm25_score, 6),
                        "opensearch_score_normalized": round(bm25_normalized, 6),
                        "lexical_fallback": True,
                    },
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
            "organization_id": payload.get("organization_id"),
            "policy_binding_id": payload.get("policy_binding_id"),
            "policy_version": payload.get("policy_version"),
            "policy_hash": payload.get("policy_hash"),
            "policy_summary": payload.get("policy_summary") if isinstance(payload.get("policy_summary"), dict) else {},
            "document_type": payload.get("document_type") or chunk_metadata.get("document_type"),
            "tenant_id": payload.get("tenant_id") or chunk_metadata.get("tenant_id"),
            "external_system": payload.get("external_system") or chunk_metadata.get("external_system"),
            "external_ref": payload.get("external_ref") or chunk_metadata.get("external_ref"),
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
            "parser_name": payload.get("parser_name") or chunk_metadata.get("parser_name"),
            "parser_engine": payload.get("parser_engine") or chunk_metadata.get("parser_engine"),
            "ocr_used": payload.get("ocr_used", chunk_metadata.get("ocr_used")),
            "quality_score": payload.get("quality_score", chunk_metadata.get("quality_score")),
            "quality_tier": payload.get("quality_tier", chunk_metadata.get("quality_tier")),
            "requires_review": payload.get("requires_review", chunk_metadata.get("requires_review")),
            "parser_quality": chunk_metadata.get("parser_quality"),
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

    if filters.document_ids:
        must.append({"key": "document_id", "match": {"any": filters.document_ids}})

    if filters.document_version_ids:
        must.append({"key": "document_version_id", "match": {"any": filters.document_version_ids}})

    if filters.tags:
        must.append({"key": "tags", "match": {"any": filters.tags}})

    if filters.tenant_id:
        must.append({"key": "tenant_id", "match": {"value": filters.tenant_id}})

    if filters.external_system:
        must.append({"key": "external_system", "match": {"value": filters.external_system}})

    if filters.only_valid:
        today = datetime.now(UTC).date().isoformat()
        must.append({"key": "status", "match": {"value": "valid"}})
        must.append(
            {
                "min_should": {
                    "conditions": [
                        {"key": "valid_from", "range": {"lte": today}},
                        {"is_empty": {"key": "valid_from"}},
                    ],
                    "min_count": 1,
                }
            }
        )

    return {"must": must}


def _opensearch_query(*, query: str, filters: RagQueryFilters, limit: int) -> dict[str, Any]:
    expanded_query = expand_query_text(query)
    should = [
        {
            "multi_match": {
                "query": query,
                "fields": [
                    "document_title^6",
                    "section_title^4",
                    "section_path^3",
                    "article_number^4",
                    "paragraph_number^3",
                    "search_text^2",
                    "text",
                    "normalized_text",
                ],
                "type": "best_fields",
                "operator": "or",
            }
        },
        {
            "multi_match": {
                "query": expanded_query,
                "fields": [
                    "document_title^4",
                    "section_title^3",
                    "section_path^2",
                    "article_number^3",
                    "paragraph_number^2",
                    "search_text^3",
                    "text^2",
                    "normalized_text",
                ],
                "type": "best_fields",
                "operator": "or",
                "boost": 1.4,
            }
        },
        {
            "multi_match": {
                "query": query,
                "fields": ["document_title^8", "section_title^5", "search_text^4", "text^3"],
                "type": "phrase",
                "boost": 3,
            }
        },
        *_opensearch_identifier_clauses(query),
    ]
    return {
        "size": limit,
        "track_total_hits": False,
        "_source": True,
        "query": {
            "bool": {
                "filter": _opensearch_filter(filters),
                "should": should,
                "minimum_should_match": 1,
            }
        },
    }


def _opensearch_filter(filters: RagQueryFilters) -> list[dict[str, Any]]:
    filter_clauses: list[dict[str, Any]] = []
    allowed_classifications = CLASSIFICATION_ORDER[
        : CLASSIFICATION_ORDER.index(filters.classification_max) + 1
    ]
    filter_clauses.append({"terms": {"classification": list(allowed_classifications)}})
    if filters.document_types:
        filter_clauses.append({"terms": {"document_type": filters.document_types}})
    if filters.document_ids:
        filter_clauses.append({"terms": {"document_id": filters.document_ids}})
    if filters.document_version_ids:
        filter_clauses.append({"terms": {"document_version_id": filters.document_version_ids}})
    if filters.tags:
        filter_clauses.append({"terms": {"tags": filters.tags}})
    if filters.tenant_id:
        filter_clauses.append({"term": {"tenant_id": filters.tenant_id}})
    if filters.external_system:
        filter_clauses.append({"term": {"external_system": filters.external_system}})
    if filters.only_valid:
        today = datetime.now(UTC).date().isoformat()
        filter_clauses.append({"term": {"status": "valid"}})
        filter_clauses.append(
            {
                "bool": {
                    "should": [
                        {"range": {"valid_from": {"lte": today}}},
                        {"bool": {"must_not": {"exists": {"field": "valid_from"}}}},
                    ],
                    "minimum_should_match": 1,
                }
            }
        )
    return filter_clauses


def _opensearch_identifier_clauses(query: str) -> list[dict[str, Any]]:
    clauses: list[dict[str, Any]] = []
    for identifier in extract_query_identifiers(query):
        clauses.append(
            {
                "multi_match": {
                    "query": identifier,
                    "fields": [
                        "document_title^12",
                        "section_title^6",
                        "section_path^5",
                        "article_number^10",
                        "paragraph_number^8",
                        "search_text^6",
                        "text^4",
                    ],
                    "type": "phrase",
                    "boost": 5,
                }
            }
        )
        clauses.append(
            {
                "wildcard": {
                    "document_title.keyword": {
                        "value": f"*{identifier}*",
                        "case_insensitive": True,
                        "boost": 8,
                    }
                }
            }
        )
    return clauses


def create_retriever(settings: Settings):
    if settings.retriever_mode == "mock":
        return MockHybridRetriever(settings)
    return QdrantHybridRetriever(settings)


from retrievers.mock import MockHybridRetriever  # noqa: E402
