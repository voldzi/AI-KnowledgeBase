from __future__ import annotations

import pytest

from app.config import load_settings
from rerankers.cross_encoder import CrossEncoderReranker


@pytest.mark.asyncio
async def test_shadow_reranker_is_not_a_readiness_dependency(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_MODE": "shadow",
            "AKL_RAG_RERANKER_PROVIDER": "tei",
            "AKL_RAG_RERANKER_BASE_URL": "http://reranker:3000",
        }
    )
    reranker = CrossEncoderReranker(settings)

    async def unexpected_probe():
        raise AssertionError("shadow dependency must not gate readiness")

    monkeypatch.setattr(reranker, "_resolve_reranker_base_url", unexpected_probe)

    assert await reranker.readiness() == "ready"


@pytest.mark.asyncio
async def test_enforced_reranker_remains_a_readiness_dependency(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_RERANKER_MODE": "enforce",
            "AKL_RAG_RERANKER_PROVIDER": "tei",
            "AKL_RAG_RERANKER_BASE_URL": "http://reranker:3000",
        }
    )
    reranker = CrossEncoderReranker(settings)

    async def unavailable():
        return None

    monkeypatch.setattr(reranker, "_resolve_reranker_base_url", unavailable)

    assert await reranker.readiness() == "not_ready"
