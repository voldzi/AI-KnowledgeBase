from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings
from app.errors import IngestionError
from app.schemas import DocumentChunk

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
        return IndexingResult(indexed_chunks=len(chunks))

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

    async def _delete_existing_version(self, document_version_id: str) -> None:
        payload = {
            "filter": {
                "must": [
                    {"key": "document_version_id", "match": {"value": document_version_id}},
                ]
            }
        }
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            response = await client.post(
                f"{self.settings.qdrant_base_url}/collections/{self.settings.qdrant_collection}/points/delete",
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
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            response = await client.put(
                f"{self.settings.qdrant_base_url}/collections/{self.settings.qdrant_collection}/points",
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
        chunk_metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        for key in ("document_title", "version_label", "document_type", "status", "tags"):
            if key in chunk_metadata and key not in payload:
                payload[key] = chunk_metadata[key]
        payload["embedding_model"] = embedding_model
        return {
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, chunk.chunk_id)),
            "vector": vector,
            "payload": payload,
        }

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
