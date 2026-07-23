from __future__ import annotations

import asyncio
import logging
import time
from typing import Any
import uuid

import httpx

from app.config import Settings
from app.schemas import RetrievedChunk
from rerankers.lexical import LexicalReranker

logger = logging.getLogger(__name__)


class ScoredValues(list[float]):
    def __init__(self, values: list[float], diagnostics: dict[str, Any]) -> None:
        super().__init__(values)
        self.diagnostics = diagnostics


class CrossEncoderReranker:
    def __init__(self, settings: Settings, lexical: LexicalReranker | None = None) -> None:
        self._settings = settings
        self._lexical = lexical or LexicalReranker()
        self._active_base_url: str | None = None
        self._endpoint_lock = asyncio.Lock()
        self._inference_semaphore = asyncio.Semaphore(settings.reranker_max_concurrency)
        self._failed_until: dict[str, float] = {}
        self._http_client: httpx.AsyncClient | None = None

    async def close(self) -> None:
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

    async def readiness(self) -> str:
        dependencies: list[tuple[str, str, dict[str, str]]] = []
        if self._settings.reranker_mode == "enforce":
            reranker_available = await self._resolve_reranker_base_url() is not None
            if not reranker_available:
                return "not_ready"
        if self._settings.colbert_mode == "enforce":
            dependencies.append(
                (
                    self._settings.colbert_mode,
                    self._settings.colbert_base_url,
                    self._colbert_headers(),
                )
            )
        for mode, base_url, headers in dependencies:
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    response = await client.get(f"{base_url}/health", headers=headers)
                available = response.status_code < 400
            except httpx.HTTPError:
                available = False
            if not available:
                return "not_ready"
        return "ready"

    async def rerank(
        self,
        *,
        query: str,
        chunks: list[RetrievedChunk],
        limit: int,
    ) -> tuple[list[RetrievedChunk], list[str]]:
        lexical = self._lexical.rerank(query=query, chunks=chunks, limit=max(limit, len(chunks)))
        colbert_active = (
            self._settings.colbert_mode != "off"
            and self._settings.reranker_strategy in {"colbert", "cascade"}
        )
        if not chunks or (self._settings.reranker_mode == "off" and not colbert_active):
            return lexical[:limit], []

        candidates = chunks
        warnings: list[str] = []
        if self._settings.colbert_mode != "off" and self._settings.reranker_strategy in {"colbert", "cascade"}:
            try:
                colbert = await self._colbert_score(query=query, chunks=chunks)
                if self._settings.colbert_mode == "shadow":
                    ranks = {item.chunk_id: rank for rank, item in enumerate(colbert, start=1)}
                    candidates = [
                        item.model_copy(
                            update={"metadata": {**item.metadata, "colbert_shadow_rank": ranks.get(item.chunk_id)}}
                        )
                        for item in chunks
                    ]
                    warnings.append("COLBERT_SHADOW")
                else:
                    candidates = colbert[: self._settings.colbert_candidate_limit]
                if (
                    self._settings.reranker_strategy == "colbert"
                    and self._settings.colbert_mode == "enforce"
                ):
                    return candidates[:limit], warnings
            except Exception as exc:
                logger.warning("colbert_fallback reason=%s content_logged=false", exc.__class__.__name__)
                if self._settings.colbert_mode == "enforce":
                    return [], [*warnings, "COLBERT_UNAVAILABLE"]
                warnings.append("COLBERT_FALLBACK")

        if self._settings.reranker_mode == "off":
            return candidates[:limit], warnings

        started = time.perf_counter()
        try:
            scores = await self._score(query=query, chunks=candidates)
        except Exception as exc:
            logger.warning("reranker_fallback reason=%s content_logged=false", exc.__class__.__name__)
            if self._settings.reranker_mode == "enforce":
                return [], [*warnings, "RERANKER_UNAVAILABLE"]
            fallback = candidates if self._settings.colbert_mode == "enforce" else lexical
            return fallback[:limit], [*warnings, "RERANKER_FALLBACK_LEXICAL"]

        latency_ms = max(0, int((time.perf_counter() - started) * 1000))
        score_diagnostics = getattr(scores, "diagnostics", {})
        scored: list[RetrievedChunk] = []
        for chunk, score in zip(candidates, scores, strict=True):
            metadata = {
                **chunk.metadata,
                "cross_encoder_score": score,
                "cross_encoder_model": self._settings.reranker_model,
                "cross_encoder_revision": self._settings.reranker_model_revision,
                "cross_encoder_latency_ms": latency_ms,
                **score_diagnostics,
            }
            scored.append(chunk.model_copy(update={"score": score, "metadata": metadata}))
        scored.sort(key=lambda item: item.score, reverse=True)
        enforced = [item for item in scored if item.score >= self._settings.reranker_min_score]

        if self._settings.reranker_mode == "shadow":
            shadow_rank = {item.chunk_id: rank for rank, item in enumerate(scored, start=1)}
            candidate_metadata = {item.chunk_id: item.metadata for item in candidates}
            return [
                item.model_copy(
                    update={
                        "metadata": {
                            **item.metadata,
                            **candidate_metadata.get(item.chunk_id, {}),
                            "cross_encoder_shadow_rank": shadow_rank.get(item.chunk_id),
                        }
                    }
                )
                for item in lexical[:limit]
            ], [*warnings, "RERANKER_SHADOW"]
        return enforced[:limit], warnings

    async def _colbert_score(self, *, query: str, chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
        async with httpx.AsyncClient(timeout=self._settings.colbert_timeout_seconds) as client:
            encoded = await client.post(
                f"{self._settings.colbert_base_url}/encode",
                headers=self._colbert_headers(),
                json={"model": self._settings.colbert_model, "texts": [query], "input_type": "query"},
            )
        encoded.raise_for_status()
        query_vector = _first_multivector(encoded.json())
        ids = [str(uuid.uuid5(uuid.NAMESPACE_URL, chunk.chunk_id)) for chunk in chunks]
        async with httpx.AsyncClient(timeout=self._settings.colbert_timeout_seconds) as client:
            response = await client.post(
                (
                    f"{self._settings.qdrant_base_url}/collections/"
                    f"{self._settings.qdrant_v2_collection}/points/query"
                ),
                json={
                    "query": query_vector,
                    "using": "colbert",
                    "filter": {"must": [{"has_id": ids}]},
                    "limit": min(len(ids), self._settings.colbert_candidate_limit),
                    "with_payload": ["chunk_id"],
                    "with_vector": False,
                },
            )
        response.raise_for_status()
        result = response.json().get("result", {})
        points = result.get("points", result) if isinstance(result, dict) else result
        if not isinstance(points, list):
            raise ValueError("ColBERT query returned no points")
        scores: dict[str, float] = {}
        for point in points:
            payload = point.get("payload") if isinstance(point, dict) else None
            chunk_id = payload.get("chunk_id") if isinstance(payload, dict) else None
            raw_score = point.get("score") if isinstance(point, dict) else None
            if isinstance(chunk_id, str) and isinstance(raw_score, (int, float)):
                scores[chunk_id] = max(0.0, min(1.0, float(raw_score)))
        scored = [
            chunk.model_copy(
                update={
                    "score": scores[chunk.chunk_id],
                    "metadata": {
                        **chunk.metadata,
                        "colbert_score": scores[chunk.chunk_id],
                        "colbert_model": self._settings.colbert_model,
                    },
                }
            )
            for chunk in chunks
            if chunk.chunk_id in scores
        ]
        return sorted(scored, key=lambda item: item.score, reverse=True)

    async def _score(self, *, query: str, chunks: list[RetrievedChunk]) -> ScoredValues:
        results: list[float] = []
        batch_diagnostics: list[dict[str, Any]] = []
        for start in range(0, len(chunks), self._settings.reranker_batch_size):
            batch = chunks[start : start + self._settings.reranker_batch_size]
            payload = self._payload(query, batch)
            endpoint = "/v1/rerank" if self._settings.reranker_provider == "llama" else "/rerank"
            request_started = time.perf_counter()
            response = await self._post_with_endpoint_fallback(endpoint=endpoint, payload=payload)
            request_ms = max(0.0, (time.perf_counter() - request_started) * 1000)
            results.extend(_ordered_scores(response.json(), len(batch)))
            batch_diagnostics.append(
                _response_diagnostics(
                    response,
                    request_ms=request_ms,
                    base_urls=self._settings.reranker_base_urls,
                )
            )
        return ScoredValues(results, _aggregate_diagnostics(batch_diagnostics))

    async def _post_with_endpoint_fallback(
        self,
        *,
        endpoint: str,
        payload: dict[str, Any],
    ) -> httpx.Response:
        async with self._inference_semaphore:
            return await self._post_to_selected_endpoint(endpoint=endpoint, payload=payload)

    async def _post_to_selected_endpoint(
        self,
        *,
        endpoint: str,
        payload: dict[str, Any],
    ) -> httpx.Response:
        last_error: Exception | None = None
        attempted: set[str] = set()
        for _ in range(2):
            base_url = await self._resolve_reranker_base_url()
            if base_url is None or base_url in attempted:
                break
            attempted.add(base_url)
            try:
                response = await self._client().post(
                    f"{base_url}{endpoint}", headers=self._headers(), json=payload
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                last_error = exc
                self._mark_endpoint_failed(base_url)
                continue
            self._active_base_url = base_url
            return response
        if last_error is not None:
            raise last_error
        raise RuntimeError("reranker has no configured endpoint")

    async def _resolve_reranker_base_url(self) -> str | None:
        if self._endpoint_is_eligible(self._active_base_url):
            return self._active_base_url
        async with self._endpoint_lock:
            if self._endpoint_is_eligible(self._active_base_url):
                return self._active_base_url
            candidates = tuple(
                base_url
                for base_url in self._settings.reranker_base_urls
                if not self._endpoint_is_cooling_down(base_url)
            )
            if not candidates:
                return None
            for base_url in candidates:
                if await self._endpoint_is_healthy(base_url):
                    self._active_base_url = base_url
                    return base_url
            return None

    async def _endpoint_is_healthy(self, base_url: str) -> bool:
        try:
            response = await self._client().get(
                f"{base_url}/health",
                headers=self._headers(),
                timeout=self._settings.reranker_health_timeout_seconds,
            )
            return response.status_code < 400
        except httpx.HTTPError:
            return False

    def _client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(
                timeout=self._settings.reranker_timeout_seconds,
            )
        return self._http_client

    def _mark_endpoint_failed(self, base_url: str) -> None:
        self._failed_until[base_url] = (
            time.monotonic() + self._settings.reranker_failure_cooldown_seconds
        )
        if self._active_base_url == base_url:
            self._active_base_url = None

    def _endpoint_is_eligible(self, base_url: str | None) -> bool:
        return (
            base_url in self._settings.reranker_base_urls
            and not self._endpoint_is_cooling_down(base_url)
        )

    def _endpoint_is_cooling_down(self, base_url: str | None) -> bool:
        if base_url is None:
            return False
        return time.monotonic() < self._failed_until.get(base_url, 0)

    def _payload(self, query: str, chunks: list[RetrievedChunk]) -> dict[str, Any]:
        documents = [
            _bounded_reranker_text(
                chunk.text,
                max_chars=self._settings.reranker_max_document_chars,
            )
            for chunk in chunks
        ]
        if self._settings.reranker_provider == "llama":
            return {
                "model": self._settings.reranker_model,
                "query": query,
                "documents": documents,
                "top_n": len(documents),
            }
        return {"query": query, "texts": documents, "raw_scores": False}

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._settings.reranker_api_key:
            headers["Authorization"] = f"Bearer {self._settings.reranker_api_key}"
        return headers

    def _colbert_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._settings.colbert_token:
            headers["Authorization"] = f"Bearer {self._settings.colbert_token}"
        return headers


def _bounded_reranker_text(text: str, *, max_chars: int) -> str:
    normalized = text.strip()
    if len(normalized) <= max_chars:
        return normalized
    return normalized[:max_chars].rstrip()


def _ordered_scores(payload: Any, size: int) -> list[float]:
    items = payload.get("results") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise ValueError("reranker response has no results")
    scores: list[float | None] = [None] * size
    for item in items:
        if not isinstance(item, dict):
            continue
        index = item.get("index")
        raw_score = item.get("relevance_score", item.get("score"))
        if isinstance(index, int) and 0 <= index < size and isinstance(raw_score, (int, float)):
            scores[index] = max(0.0, min(1.0, float(raw_score)))
    if any(score is None for score in scores):
        raise ValueError("reranker response is incomplete")
    return [float(score) for score in scores if score is not None]


def _response_diagnostics(
    response: httpx.Response,
    *,
    request_ms: float,
    base_urls: tuple[str, ...],
) -> dict[str, Any]:
    server_total_ms = _float_header(response, "X-AKB-Reranker-Total-Ms")
    request = getattr(response, "request", None)
    request_url = str(request.url) if request is not None else "unknown"
    return {
        "device": getattr(response, "headers", {}).get("X-AKB-Reranker-Device"),
        "endpoint_slot": _endpoint_slot(request_url, base_urls),
        "queue_ms": _float_header(response, "X-AKB-Reranker-Queue-Ms"),
        "inference_ms": _float_header(response, "X-AKB-Reranker-Inference-Ms"),
        "server_total_ms": server_total_ms,
        "transport_ms": (
            round(max(0.0, request_ms - server_total_ms), 2)
            if server_total_ms is not None
            else round(request_ms, 2)
        ),
    }


def _aggregate_diagnostics(batches: list[dict[str, Any]]) -> dict[str, Any]:
    if not batches:
        return {}
    return {
        "cross_encoder_device": next(
            (item["device"] for item in batches if item.get("device")),
            None,
        ),
        "cross_encoder_endpoint_slot": batches[-1]["endpoint_slot"],
        "cross_encoder_batch_count": len(batches),
        "cross_encoder_queue_ms": _sum_metric(batches, "queue_ms"),
        "cross_encoder_inference_ms": _sum_metric(batches, "inference_ms"),
        "cross_encoder_server_total_ms": _sum_metric(batches, "server_total_ms"),
        "cross_encoder_transport_ms": _sum_metric(batches, "transport_ms"),
    }


def _float_header(response: httpx.Response, name: str) -> float | None:
    try:
        value = float(getattr(response, "headers", {})[name])
    except (KeyError, TypeError, ValueError):
        return None
    return round(max(0.0, value), 2)


def _endpoint_slot(request_url: str, base_urls: tuple[str, ...]) -> int | None:
    for index, base_url in enumerate(base_urls, start=1):
        if request_url.startswith(f"{base_url}/"):
            return index
    return None


def _sum_metric(items: list[dict[str, Any]], key: str) -> float | None:
    values = [item[key] for item in items if isinstance(item.get(key), (int, float))]
    return round(sum(values), 2) if values else None


def _first_multivector(payload: Any) -> list[list[float]]:
    vectors = payload.get("vectors", payload.get("data")) if isinstance(payload, dict) else payload
    if isinstance(vectors, list) and len(vectors) == 1:
        vectors = vectors[0]
    if not isinstance(vectors, list) or not vectors or not all(isinstance(item, list) for item in vectors):
        raise ValueError("ColBERT encoder returned an invalid multivector")
    return [[float(value) for value in token] for token in vectors]
