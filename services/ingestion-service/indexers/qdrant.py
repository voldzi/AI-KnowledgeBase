from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings
from app.errors import IngestionError
from app.schemas import DocumentChunk
from intelligence.entities import intelligence_payload_fields

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IndexingResult:
    indexed_chunks: int


class QdrantIndexer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.mock_points: list[dict[str, Any]] = []

    async def readiness(self) -> str:
        if self.settings.indexer_mode == "mock":
            return "mock"
        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.get(f"{self.settings.qdrant_base_url}/readyz", headers=self._headers())
                if response.status_code == 404:
                    response = await client.get(f"{self.settings.qdrant_base_url}/", headers=self._headers())
            return "ready" if response.status_code < 500 else "not_ready"
        except httpx.HTTPError:
            return "not_ready"

    async def index(
        self,
        *,
        chunks: list[DocumentChunk],
        vectors: list[list[float]],
        embedding_model: str,
    ) -> IndexingResult:
        if len(chunks) != len(vectors):
            raise IngestionError("INDEXING_INPUT_INVALID", "Chunk and vector counts do not match", status_code=500)
        if not chunks:
            return IndexingResult(indexed_chunks=0)

        if self.settings.indexer_mode == "mock":
            self.mock_points = [
                self._point(chunk, vector, embedding_model=embedding_model)
                for chunk, vector in zip(chunks, vectors, strict=True)
            ]
            return IndexingResult(indexed_chunks=len(chunks))

        vector_size = self._validate_vector_sizes(vectors, embedding_model=embedding_model)
        await self._ensure_collection(vector_size)
        await self._ensure_text_index()
        if self.settings.qdrant_delete_existing_version:
            await self._delete_existing_version(chunks[0].document_version_id)
        await self._upsert_points(
            [self._point(chunk, vector, embedding_model=embedding_model) for chunk, vector in zip(chunks, vectors, strict=True)]
        )
        if self.settings.rag_v2_mode != "off":
            try:
                await self._index_v2(
                    chunks=chunks,
                    vectors=vectors,
                    embedding_model=embedding_model,
                    vector_size=vector_size,
                )
            except IngestionError:
                if self.settings.rag_v2_mode == "enforce":
                    raise
                logger.warning("rag_v2_dual_write_failed mode=shadow content_logged=false")
        return IndexingResult(indexed_chunks=len(chunks))

    async def _index_v2(
        self,
        *,
        chunks: list[DocumentChunk],
        vectors: list[list[float]],
        embedding_model: str,
        vector_size: int,
    ) -> None:
        colbert_vectors: list[list[list[float]]] | None = None
        if self.settings.colbert_index_mode != "off":
            try:
                colbert_vectors = await self._encode_colbert([chunk.text for chunk in chunks])
            except Exception as exc:
                if self.settings.colbert_index_mode == "enforce":
                    if isinstance(exc, IngestionError):
                        raise
                    raise IngestionError(
                        "COLBERT_ENCODING_FAILED",
                        "ColBERT document encoding failed",
                        status_code=502,
                    ) from exc
                logger.warning(
                    "colbert_document_encoding_failed mode=shadow reason=%s content_logged=false",
                    exc.__class__.__name__,
                )
        await self._ensure_v2_collection(vector_size)
        if self.settings.qdrant_delete_existing_version:
            await self._delete_existing_version_from(
                self.settings.qdrant_v2_collection,
                chunks[0].document_version_id,
            )
        points = [
            self._v2_point(
                chunk,
                vector,
                embedding_model=embedding_model,
                colbert_vector=colbert_vectors[index] if colbert_vectors else None,
            )
            for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True))
        ]
        await self._upsert_points_to(self.settings.qdrant_v2_collection, points)

    async def _encode_colbert(self, texts: list[str]) -> list[list[list[float]]]:
        vectors: list[list[list[float]]] = []
        for start in range(0, len(texts), self.settings.colbert_batch_size):
            batch = texts[start : start + self.settings.colbert_batch_size]
            async with httpx.AsyncClient(timeout=self.settings.colbert_timeout_seconds) as client:
                response = await client.post(
                    f"{self.settings.colbert_base_url}/encode",
                    headers=self._colbert_headers(),
                    json={
                        "model": self.settings.colbert_model,
                        "texts": batch,
                        "input_type": "document",
                    },
                )
            if response.status_code >= 400:
                raise IngestionError(
                    "COLBERT_ENCODING_FAILED",
                    "ColBERT document encoder returned an error",
                    status_code=502,
                    details={"status_code": response.status_code},
                )
            vectors.extend(_colbert_vectors(response.json(), expected_count=len(batch)))
        return vectors

    async def _ensure_v2_collection(self, vector_size: int) -> None:
        collection = self.settings.qdrant_v2_collection
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            response = await client.get(
                f"{self.settings.qdrant_base_url}/collections/{collection}",
                headers=self._headers(),
            )
            if response.status_code == 200:
                dense, colbert = _v2_collection_vector_config(response.json())
                expected_dense = (vector_size, self.settings.qdrant_distance.lower())
                expected_colbert = (
                    self.settings.qdrant_colbert_vector_size,
                    "cosine",
                    "max_sim",
                )
                if dense != expected_dense or colbert != expected_colbert:
                    raise IngestionError(
                        "QDRANT_V2_COLLECTION_CONFIG_MISMATCH",
                        "Existing Qdrant V2 collection does not match named-vector configuration",
                        status_code=500,
                        details={"collection": collection},
                    )
                return
            if response.status_code != 404:
                raise IngestionError(
                    "QDRANT_V2_COLLECTION_CHECK_FAILED",
                    "Qdrant V2 collection check failed",
                    status_code=502,
                    details={"status_code": response.status_code},
                )
            create_response = await client.put(
                f"{self.settings.qdrant_base_url}/collections/{collection}",
                headers=self._headers(),
                json={
                    "vectors": {
                        "dense_bge_m3": {
                            "size": vector_size,
                            "distance": self.settings.qdrant_distance,
                        },
                        "colbert": {
                            "size": self.settings.qdrant_colbert_vector_size,
                            "distance": "Cosine",
                            "multivector_config": {"comparator": "max_sim"},
                            "hnsw_config": {"m": 0},
                        },
                    }
                },
            )
        if create_response.status_code >= 400:
            raise IngestionError(
                "QDRANT_V2_COLLECTION_CREATE_FAILED",
                "Qdrant V2 collection could not be created",
                status_code=502,
                details={"status_code": create_response.status_code},
            )

    def _validate_vector_sizes(self, vectors: list[list[float]], *, embedding_model: str) -> int:
        actual_sizes = {len(vector) for vector in vectors}
        expected_size = self.settings.qdrant_vector_size
        if actual_sizes == {expected_size}:
            return expected_size

        raise IngestionError(
            "QDRANT_VECTOR_SIZE_MISMATCH",
            (
                "Embedding vector size does not match the configured Qdrant vector size. "
                "Use bge-m3 with the real Qdrant profile, or switch both ingestion and RAG "
                "to the mock/dev-test profile."
            ),
            status_code=500,
            details={
                "collection": self.settings.qdrant_collection,
                "configured_vector_size": expected_size,
                "actual_vector_sizes": sorted(actual_sizes),
                "embedding_model": embedding_model,
            },
        )

    async def _ensure_collection(self, vector_size: int) -> None:
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            response = await client.get(
                f"{self.settings.qdrant_base_url}/collections/{self.settings.qdrant_collection}",
                headers=self._headers(),
            )
            if response.status_code == 200:
                existing_size, existing_distance = _collection_vector_config(response.json())
                expected_distance = self.settings.qdrant_distance
                if existing_size != vector_size:
                    raise IngestionError(
                        "QDRANT_COLLECTION_VECTOR_SIZE_MISMATCH",
                        "Qdrant collection vector size does not match the configured embedding model.",
                        status_code=500,
                        details={
                            "collection": self.settings.qdrant_collection,
                            "configured_vector_size": vector_size,
                            "existing_vector_size": existing_size,
                            "embedding_model": self.settings.default_embedding_model,
                        },
                    )
                if existing_distance and existing_distance.lower() != expected_distance.lower():
                    raise IngestionError(
                        "QDRANT_COLLECTION_DISTANCE_MISMATCH",
                        "Qdrant collection distance does not match the configured distance.",
                        status_code=500,
                        details={
                            "collection": self.settings.qdrant_collection,
                            "configured_distance": expected_distance,
                            "existing_distance": existing_distance,
                        },
                    )
                return
            if response.status_code != 404:
                raise IngestionError(
                    "QDRANT_COLLECTION_CHECK_FAILED",
                    "Qdrant collection check failed",
                    status_code=502,
                    details={"status_code": response.status_code},
                )
            create_response = await client.put(
                f"{self.settings.qdrant_base_url}/collections/{self.settings.qdrant_collection}",
                headers=self._headers(),
                json={
                    "vectors": {
                        "size": self.settings.qdrant_vector_size,
                        "distance": self.settings.qdrant_distance,
                    }
                },
            )
            if create_response.status_code >= 400:
                raise IngestionError(
                    "QDRANT_COLLECTION_CREATE_FAILED",
                    "Qdrant collection could not be created",
                    status_code=502,
                    details={"status_code": create_response.status_code},
                )

    async def _ensure_text_index(self) -> None:
        """Create a fulltext payload index on normalized_text for native lexical search.

        The index is idempotent – safe to call on every ingestion.  Without it,
        retrieval falls back to a full collection scan (slower, still correct).
        Index creation is non-fatal: a warning is logged but indexing continues.
        """
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            response = await client.put(
                f"{self.settings.qdrant_base_url}/collections/{self.settings.qdrant_collection}/index",
                headers=self._headers(),
                json={
                    "field_name": "normalized_text",
                    "field_schema": {
                        "type": "text",
                        "tokenizer": "word",
                        "min_token_len": 2,
                        "lowercase": True,
                    },
                },
            )
        if response.status_code >= 400:
            logger.warning(
                "Failed to create fulltext payload index on normalized_text "
                "(status %d) — lexical search will fall back to full collection scan: %s",
                response.status_code,
                response.text,
            )
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            index_response = await client.put(
                f"{self.settings.qdrant_base_url}/collections/{self.settings.qdrant_collection}/index",
                headers=self._headers(),
                json={
                    "field_name": "metadata.chunk_index",
                    "field_schema": "integer",
                },
            )
        if index_response.status_code >= 400:
            logger.warning(
                "Failed to create integer payload index on metadata.chunk_index "
                "(status %d) — neighbour-context lookups will scan the collection: %s",
                index_response.status_code,
                index_response.text,
            )
        for field_name in (
            "document_id",
            "document_version_id",
            "document_type",
            "classification",
            "status",
            "tags",
            "organization_id",
            "policy_binding_id",
            "policy_version",
            "policy_hash",
            "policy_summary.handlingClass",
            "policy_summary.audience.scopeType",
            "policy_summary.audience.scopeIds",
            "policy_summary.audience.recipientSubjectIds",
            "policy_summary.obligations",
        ):
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                policy_response = await client.put(
                    f"{self.settings.qdrant_base_url}/collections/{self.settings.qdrant_collection}/index",
                    headers=self._headers(),
                    json={"field_name": field_name, "field_schema": "keyword"},
                )
            if policy_response.status_code >= 400:
                logger.warning(
                    "Failed to create Qdrant policy payload index field=%s status=%d",
                    field_name,
                    policy_response.status_code,
                )

    async def _delete_existing_version(self, document_version_id: str) -> None:
        await self._delete_existing_version_from(self.settings.qdrant_collection, document_version_id)

    async def _delete_existing_version_from(self, collection: str, document_version_id: str) -> None:
        payload = {
            "filter": {
                "must": [
                    {"key": "document_version_id", "match": {"value": document_version_id}},
                ]
            }
        }
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            response = await client.post(
                f"{self.settings.qdrant_base_url}/collections/{collection}/points/delete",
                params={"wait": "true"},
                headers=self._headers(),
                json=payload,
            )
        if response.status_code >= 400:
            raise IngestionError(
                "QDRANT_DELETE_FAILED",
                "Qdrant failed to delete existing vectors for document version",
                status_code=502,
                details={"status_code": response.status_code},
            )

    async def _upsert_points(self, points: list[dict[str, Any]]) -> None:
        await self._upsert_points_to(self.settings.qdrant_collection, points)

    async def _upsert_points_to(self, collection: str, points: list[dict[str, Any]]) -> None:
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            response = await client.put(
                f"{self.settings.qdrant_base_url}/collections/{collection}/points",
                params={"wait": "true"},
                headers=self._headers(),
                json={"points": points},
            )
        if response.status_code >= 400:
            raise IngestionError(
                "QDRANT_UPSERT_FAILED",
                "Qdrant vector upsert failed",
                status_code=502,
                details={"status_code": response.status_code},
            )

    def _point(self, chunk: DocumentChunk, vector: list[float], *, embedding_model: str) -> dict[str, Any]:
        payload = chunk.model_dump(mode="json")
        for key in ("tenant_id", "external_system", "external_ref"):
            if payload.get(key) is None:
                payload.pop(key, None)
        chunk_metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        for key in ("document_title", "version_label", "document_type", "status", "tags"):
            if key in chunk_metadata and key not in payload:
                payload[key] = chunk_metadata[key]
        payload.update(intelligence_payload_fields(chunk_metadata))
        payload["embedding_model"] = embedding_model
        return {
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, chunk.chunk_id)),
            "vector": vector,
            "payload": payload,
        }

    def _v2_point(
        self,
        chunk: DocumentChunk,
        vector: list[float],
        *,
        embedding_model: str,
        colbert_vector: list[list[float]] | None = None,
    ) -> dict[str, Any]:
        point = self._point(chunk, vector, embedding_model=embedding_model)
        named_vectors: dict[str, Any] = {"dense_bge_m3": vector}
        if colbert_vector is not None:
            if not colbert_vector or any(
                len(token) != self.settings.qdrant_colbert_vector_size
                for token in colbert_vector
            ):
                raise IngestionError(
                    "COLBERT_VECTOR_SIZE_MISMATCH",
                    "ColBERT token vector size does not match the V2 collection",
                    status_code=500,
                )
            named_vectors["colbert"] = colbert_vector
        point["vector"] = named_vectors
        point["payload"] = {
            **point["payload"],
            "rag_index_version": "v2",
            "colbert_status": "indexed" if colbert_vector is not None else "pending_backfill",
            "colbert_model": self.settings.colbert_model if colbert_vector is not None else None,
        }
        return point

    def _colbert_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.settings.colbert_token:
            headers["Authorization"] = f"Bearer {self.settings.colbert_token}"
        return headers

    def _headers(self) -> dict[str, str]:
        if not self.settings.qdrant_api_key:
            return {}
        return {"api-key": self.settings.qdrant_api_key}


def _collection_vector_config(data: dict[str, Any]) -> tuple[int | None, str | None]:
    result = data.get("result")
    if not isinstance(result, dict):
        return None, None
    config = result.get("config")
    if not isinstance(config, dict):
        return None, None
    params = config.get("params")
    if not isinstance(params, dict):
        return None, None
    vectors = params.get("vectors")
    if not isinstance(vectors, dict):
        return None, None

    size = vectors.get("size")
    distance = vectors.get("distance")
    return size if isinstance(size, int) else None, distance if isinstance(distance, str) else None


def _v2_collection_vector_config(
    data: dict[str, Any],
) -> tuple[tuple[int | None, str | None], tuple[int | None, str | None, str | None]]:
    result = data.get("result")
    config = result.get("config") if isinstance(result, dict) else None
    params = config.get("params") if isinstance(config, dict) else None
    vectors = params.get("vectors") if isinstance(params, dict) else None
    if not isinstance(vectors, dict):
        return (None, None), (None, None, None)
    dense = vectors.get("dense_bge_m3")
    colbert = vectors.get("colbert")
    dense_size = dense.get("size") if isinstance(dense, dict) else None
    dense_distance = dense.get("distance") if isinstance(dense, dict) else None
    colbert_size = colbert.get("size") if isinstance(colbert, dict) else None
    colbert_distance = colbert.get("distance") if isinstance(colbert, dict) else None
    multivector = colbert.get("multivector_config") if isinstance(colbert, dict) else None
    comparator = multivector.get("comparator") if isinstance(multivector, dict) else None
    return (
        (
            dense_size if isinstance(dense_size, int) else None,
            dense_distance.lower() if isinstance(dense_distance, str) else None,
        ),
        (
            colbert_size if isinstance(colbert_size, int) else None,
            colbert_distance.lower() if isinstance(colbert_distance, str) else None,
            comparator if isinstance(comparator, str) else None,
        ),
    )


def _colbert_vectors(payload: Any, *, expected_count: int) -> list[list[list[float]]]:
    vectors = payload.get("vectors", payload.get("data")) if isinstance(payload, dict) else payload
    if not isinstance(vectors, list) or len(vectors) != expected_count:
        raise IngestionError(
            "COLBERT_RESPONSE_INVALID",
            "ColBERT encoder returned an invalid batch",
            status_code=502,
        )
    result: list[list[list[float]]] = []
    for multivector in vectors:
        if not isinstance(multivector, list) or not multivector:
            raise IngestionError(
                "COLBERT_RESPONSE_INVALID",
                "ColBERT encoder returned an invalid multivector",
                status_code=502,
            )
        try:
            result.append([[float(value) for value in token] for token in multivector])
        except (TypeError, ValueError) as exc:
            raise IngestionError(
                "COLBERT_RESPONSE_INVALID",
                "ColBERT encoder returned non-numeric values",
                status_code=502,
            ) from exc
    return result
