from __future__ import annotations

import httpx
import pytest

from app.config import load_settings
from app.errors import IngestionError
from embeddings.client import EmbeddingClient


def _settings(tmp_path, **overrides):
    env = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "disabled",
        "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
        "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
        "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
        "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "http",
        "AKL_INGESTION_INDEXER_MODE": "mock",
        "AKL_INGESTION_JOB_STORE_PATH": str(tmp_path / "jobs"),
        "AKL_LLM_GATEWAY_BASE_URL": "http://gateway.test/api/v1",
        "AKL_INGESTION_DEFAULT_EMBEDDING_MODEL": "bge-m3",
        "AKL_INGESTION_EMBEDDING_BATCH_SIZE": "2",
        "AKL_INGESTION_EMBEDDING_CONCURRENCY": "1",
        "AKL_INGESTION_EMBEDDING_RETRY_ATTEMPTS": "2",
        "AKL_INGESTION_EMBEDDING_RETRY_BACKOFF_SECONDS": "0",
    }
    env.update(overrides)
    return load_settings(env)


def _install_transport(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def factory(**kwargs):
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr("embeddings.client.httpx.AsyncClient", factory)


@pytest.mark.asyncio
async def test_embedding_retries_transient_status_and_preserves_order(
    tmp_path, monkeypatch
) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(502, request=request)
        return httpx.Response(
            200,
            request=request,
            json={
                "data": [
                    {"index": 1, "embedding": [2.0, 2.0]},
                    {"index": 0, "embedding": [1.0, 1.0]},
                ]
            },
        )

    _install_transport(monkeypatch, handler)

    result = await EmbeddingClient(_settings(tmp_path)).embed_texts(
        ["first", "second"], embedding_profile="default"
    )

    assert calls == 2
    assert result.vectors == [[1.0, 1.0], [2.0, 2.0]]


@pytest.mark.asyncio
async def test_embedding_retries_transport_error_then_succeeds(
    tmp_path, monkeypatch
) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ConnectTimeout("temporary timeout", request=request)
        return httpx.Response(
            200,
            request=request,
            json={"data": [{"index": 0, "embedding": [1.0]}]},
        )

    _install_transport(monkeypatch, handler)

    result = await EmbeddingClient(_settings(tmp_path)).embed_texts(
        ["first"], embedding_profile="default"
    )

    assert calls == 2
    assert result.vectors == [[1.0]]


@pytest.mark.asyncio
async def test_embedding_does_not_retry_non_transient_4xx(
    tmp_path, monkeypatch
) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(403, request=request)

    _install_transport(monkeypatch, handler)

    with pytest.raises(IngestionError) as exc:
        await EmbeddingClient(_settings(tmp_path)).embed_texts(
            ["first"], embedding_profile="default"
        )

    assert calls == 1
    assert exc.value.code == "EMBEDDING_REQUEST_FAILED"
    assert exc.value.details == {"status_code": 403}


@pytest.mark.asyncio
async def test_embedding_stops_after_bounded_transient_retries(
    tmp_path, monkeypatch
) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503, request=request)

    _install_transport(monkeypatch, handler)

    with pytest.raises(IngestionError) as exc:
        await EmbeddingClient(_settings(tmp_path)).embed_texts(
            ["first"], embedding_profile="default"
        )

    assert calls == 3
    assert exc.value.code == "EMBEDDING_REQUEST_FAILED"
    assert exc.value.details == {"status_code": 503}
