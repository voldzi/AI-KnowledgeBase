from __future__ import annotations

import asyncio

import pytest

from app.service import _bounded_readiness


@pytest.mark.asyncio
async def test_bounded_readiness_returns_dependency_status() -> None:
    async def ready() -> str:
        return "ready"

    assert await _bounded_readiness(ready(), timeout_seconds=0.05) == "ready"


@pytest.mark.asyncio
async def test_bounded_readiness_times_out_slow_dependency() -> None:
    async def slow() -> str:
        await asyncio.sleep(0.05)
        return "ready"

    assert await _bounded_readiness(slow(), timeout_seconds=0.001) == "not_ready"
