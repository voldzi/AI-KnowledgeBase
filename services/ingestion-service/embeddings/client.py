from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings
from app.context import get_correlation_id, get_request_id
from app.errors import IngestionError
from app.security import AuthContext


@dataclass(frozen=True)
class EmbeddingBatch:
    model: str
    vectors: list[list[float]]


class EmbeddingClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def readiness(self) -> str:
        if self.settings.embedding_client_mode == "mock":
            return "mock"
        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.get(
                    f"{self._service_base_url()}/health",
                    headers=self._headers(),
                )
            return "ready" if response.status_code == 200 else "not_ready"
        except httpx.HTTPError:
            return "not_ready"

    async def embed_texts(
        self,
        texts: list[str],
        *,
        embedding_profile: str,
        auth_context: AuthContext | None = None,
    ) -> EmbeddingBatch:
        model = self._model_for_profile(embedding_profile)
        if self.settings.embedding_client_mode == "mock":
            return EmbeddingBatch(
                model=model,
                vectors=[_deterministic_embedding(text, model, self.settings.mock_embedding_dimensions) for text in texts],
            )

        batches = [
            texts[start : start + self.settings.embedding_batch_size]
            for start in range(0, len(texts), self.settings.embedding_batch_size)
        ]
        semaphore = asyncio.Semaphore(self.settings.embedding_concurrency)

        async def _bounded(batch: list[str]) -> list[list[float]]:
            async with semaphore:
                return await self._embed_batch(batch, model=model, auth_context=auth_context)

        # gather preserves input order, so vectors stay aligned with texts
        results = await asyncio.gather(*(_bounded(batch) for batch in batches))
        vectors: list[list[float]] = []
        for result in results:
            vectors.extend(result)
        return EmbeddingBatch(model=model, vectors=vectors)

    async def _embed_batch(
        self,
        texts: list[str],
        *,
        model: str,
        auth_context: AuthContext | None = None,
    ) -> list[list[float]]:
        payload = {
            "model": model,
            "input": texts,
            "metadata": {"purpose": "document_ingestion"},
        }
        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.post(
                    f"{self._api_base_url()}/embeddings",
                    headers=self._headers(auth_context),
                    json=payload,
                )
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPStatusError as exc:
            raise IngestionError(
                "EMBEDDING_REQUEST_FAILED",
                "LLM Gateway rejected embedding request",
                status_code=502,
                details={"status_code": exc.response.status_code},
            ) from exc
        except httpx.HTTPError as exc:
            raise IngestionError("LLM_GATEWAY_UNAVAILABLE", "LLM Gateway is unavailable", status_code=502) from exc

        items = sorted(body.get("data", []), key=lambda item: item.get("index", 0))
        vectors = [item.get("embedding") for item in items]
        if len(vectors) != len(texts) or any(not _is_vector(vector) for vector in vectors):
            raise IngestionError(
                "EMBEDDING_RESPONSE_INVALID",
                "LLM Gateway returned invalid embedding data",
                status_code=502,
            )
        return vectors

    def _model_for_profile(self, embedding_profile: str) -> str:
        return self.settings.embedding_profile_model_map.get(
            embedding_profile,
            self.settings.default_embedding_model,
        )

    def _api_base_url(self) -> str:
        base_url = self.settings.llm_gateway_base_url.rstrip("/")
        return base_url if base_url.endswith("/api/v1") else f"{base_url}/api/v1"

    def _service_base_url(self) -> str:
        return self._api_base_url().removesuffix("/api/v1")

    def _headers(self, auth_context: AuthContext | None = None) -> dict[str, str]:
        headers = {
            "X-Request-ID": get_request_id(),
            "X-Correlation-ID": get_correlation_id(),
            "X-Service-Name": self.settings.service_name,
        }
        if auth_context:
            headers["X-AKL-Subject"] = auth_context.subject_id
            if auth_context.roles:
                headers["X-AKL-Roles"] = ",".join(auth_context.roles)
            if auth_context.groups:
                headers["X-AKL-Groups"] = ",".join(auth_context.groups)
        bearer_token = auth_context.bearer_token if auth_context else None
        if bearer_token:
            headers["Authorization"] = f"Bearer {bearer_token}"
        elif self.settings.llm_gateway_token:
            headers["Authorization"] = f"Bearer {self.settings.llm_gateway_token}"
        return headers


def _deterministic_embedding(text: str, model: str, dimensions: int) -> list[float]:
    values: list[float] = []
    for index in range(dimensions):
        digest = hashlib.sha256(f"{model}:{index}:{text}".encode("utf-8")).digest()
        integer = int.from_bytes(digest[:4], byteorder="big", signed=False)
        values.append(round((integer / 2**32) * 2 - 1, 6))
    return values


def _is_vector(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(isinstance(item, (int, float)) for item in value)
