from __future__ import annotations

import pytest
from starlette.datastructures import Headers

from app.config import Settings
from app.public_delivery_limiter import (
    PublicDeliveryCapacityExceeded,
    PublicDeliveryLimiter,
)


def _settings(**overrides) -> Settings:
    values = {
        "registry_public_rate_window_ms": 60000,
        "registry_public_rate_per_client_slug": 2,
        "registry_public_rate_global": 3,
        "registry_public_concurrency_per_client": 1,
        "registry_public_concurrency_global": 2,
        "registry_public_limiter_max_keys": 10,
        "registry_public_trusted_proxy_hops": 1,
        "public_client_key_secret": "test-public-client-key-secret-000000000000000",
    }
    values.update(overrides)
    return Settings(AKL_ENV="test", AKL_AUTH_MODE="mock", **values)


def _headers(address: str) -> Headers:
    return Headers({"X-Forwarded-For": address})


def test_registry_public_limiter_enforces_rate_and_global_spoof_backstop() -> None:
    limiter = PublicDeliveryLimiter(
        _settings(
            registry_public_rate_per_client_slug=10,
            registry_public_rate_global=2,
        )
    )
    limiter.acquire(_headers("203.0.113.1"), "public-guide").release()
    limiter.acquire(_headers("203.0.113.2"), "public-guide").release()
    with pytest.raises(PublicDeliveryCapacityExceeded):
        limiter.acquire(_headers("203.0.113.3"), "public-guide")


def test_registry_public_limiter_holds_per_client_and_global_concurrency() -> None:
    limiter = PublicDeliveryLimiter(
        _settings(
            registry_public_rate_per_client_slug=20,
            registry_public_rate_global=20,
        )
    )
    first = limiter.acquire(_headers("203.0.113.1"), "document-a")
    with pytest.raises(PublicDeliveryCapacityExceeded):
        limiter.acquire(_headers("203.0.113.1"), "document-b")
    second = limiter.acquire(_headers("203.0.113.2"), "document-a")
    with pytest.raises(PublicDeliveryCapacityExceeded):
        limiter.acquire(_headers("203.0.113.3"), "document-a")
    first.release()
    third = limiter.acquire(_headers("203.0.113.3"), "document-a")
    second.release()
    third.release()


def test_registry_public_limiter_keeps_map_bounded_and_ignores_spoofed_prefix() -> None:
    now = [1000.0]
    settings = _settings(
        registry_public_rate_per_client_slug=20,
        registry_public_rate_global=20,
        registry_public_limiter_max_keys=1,
    )
    limiter = PublicDeliveryLimiter(settings, clock=lambda: now[0])
    direct = limiter.acquire(_headers("203.0.113.7"), "document-a")
    direct.release()
    # With one trusted right-hand proxy hop, an attacker-controlled prefix does
    # not change the selected client address or create another map entry.
    prefixed = limiter.acquire(
        _headers("198.51.100.99, 203.0.113.7"),
        "document-a",
    )
    prefixed.release()
    with pytest.raises(PublicDeliveryCapacityExceeded):
        limiter.acquire(_headers("203.0.113.8"), "document-b")
    now[0] += 60.001
    limiter.acquire(_headers("203.0.113.8"), "document-b").release()
