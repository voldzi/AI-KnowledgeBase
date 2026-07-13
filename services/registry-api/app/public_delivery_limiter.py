from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import hmac
from ipaddress import ip_address
from threading import Lock
import time

from starlette.datastructures import Headers

from app.config import Settings


MAX_FORWARDED_FOR_BYTES = 1024
MAX_FORWARDED_FOR_ENTRIES = 16


class PublicDeliveryCapacityExceeded(RuntimeError):
    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__("Public delivery capacity is exhausted")
        self.retry_after_seconds = retry_after_seconds


@dataclass
class _RateWindow:
    started_at: float
    count: int = 0


class PublicDeliveryLease:
    def __init__(self, limiter: "PublicDeliveryLimiter", client_key: str) -> None:
        self._limiter = limiter
        self._client_key = client_key
        self._released = False

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        self._limiter.release(self._client_key)


class PublicDeliveryLimiter:
    def __init__(self, settings: Settings, *, clock=time.monotonic) -> None:
        self.window_seconds = settings.registry_public_rate_window_ms / 1000
        self.per_client_slug_rate = settings.registry_public_rate_per_client_slug
        self.global_rate_limit = settings.registry_public_rate_global
        self.per_client_concurrency = settings.registry_public_concurrency_per_client
        self.global_concurrency = settings.registry_public_concurrency_global
        self.max_keys = settings.registry_public_limiter_max_keys
        self.trusted_proxy_hops = settings.registry_public_trusted_proxy_hops
        self.client_key_secret = (
            settings.public_client_key_secret
            or settings.public_delivery_internal_token
            or "akb-development-public-client-key"
        ).encode("utf-8")
        self._clock = clock
        self._lock = Lock()
        self._rate_by_client_slug: dict[str, _RateWindow] = {}
        self._active_by_client: dict[str, int] = {}
        self._global_rate = _RateWindow(0)
        self._global_active = 0

    def acquire(self, headers: Headers, public_slug: str) -> PublicDeliveryLease:
        client_key = self._client_key(headers)
        rate_key = f"{client_key}:{public_slug}"
        with self._lock:
            now = self._clock()
            self._global_rate = self._current_window(self._global_rate, now)
            client_rate = self._rate_by_client_slug.get(rate_key)
            if client_rate is None or now - client_rate.started_at >= self.window_seconds:
                if client_rate is None and len(self._rate_by_client_slug) >= self.max_keys:
                    self._prune(now)
                if client_rate is None and len(self._rate_by_client_slug) >= self.max_keys:
                    raise PublicDeliveryCapacityExceeded(self._retry_after(self._global_rate, now))
                client_rate = _RateWindow(now)
                self._rate_by_client_slug[rate_key] = client_rate
            client_active = self._active_by_client.get(client_key, 0)
            retry_after = max(
                self._retry_after(self._global_rate, now),
                self._retry_after(client_rate, now),
            )
            if (
                self._global_rate.count >= self.global_rate_limit
                or client_rate.count >= self.per_client_slug_rate
                or self._global_active >= self.global_concurrency
                or client_active >= self.per_client_concurrency
            ):
                raise PublicDeliveryCapacityExceeded(retry_after)
            self._global_rate.count += 1
            client_rate.count += 1
            self._global_active += 1
            self._active_by_client[client_key] = client_active + 1
        return PublicDeliveryLease(self, client_key)

    def release(self, client_key: str) -> None:
        with self._lock:
            self._global_active = max(0, self._global_active - 1)
            active = self._active_by_client.get(client_key, 0)
            if active <= 1:
                self._active_by_client.pop(client_key, None)
            else:
                self._active_by_client[client_key] = active - 1

    def _client_key(self, headers: Headers) -> str:
        forwarded = headers.get("x-forwarded-for", "")
        address = "shared-untrusted-client"
        if self.trusted_proxy_hops > 0 and len(forwarded) <= MAX_FORWARDED_FOR_BYTES:
            entries = [item.strip().lower() for item in forwarded.split(",") if item.strip()]
            candidate_index = len(entries) - self.trusted_proxy_hops
            if len(entries) <= MAX_FORWARDED_FOR_ENTRIES and candidate_index >= 0:
                candidate = entries[candidate_index]
                try:
                    address = str(ip_address(candidate))
                except ValueError:
                    pass
        return hmac.new(self.client_key_secret, address.encode("utf-8"), sha256).hexdigest()[:32]

    def _current_window(self, window: _RateWindow, now: float) -> _RateWindow:
        return _RateWindow(now) if now - window.started_at >= self.window_seconds else window

    def _retry_after(self, window: _RateWindow, now: float) -> int:
        return max(1, int(window.started_at + self.window_seconds - now + 0.999))

    def _prune(self, now: float) -> None:
        expired = [
            key
            for key, window in self._rate_by_client_slug.items()
            if now - window.started_at >= self.window_seconds
        ]
        for key in expired:
            self._rate_by_client_slug.pop(key, None)


_limiter_lock = Lock()
_limiter: PublicDeliveryLimiter | None = None
_limiter_fingerprint: tuple[object, ...] | None = None


def public_delivery_limiter(settings: Settings) -> PublicDeliveryLimiter:
    global _limiter, _limiter_fingerprint
    fingerprint = (
        settings.registry_public_rate_window_ms,
        settings.registry_public_rate_per_client_slug,
        settings.registry_public_rate_global,
        settings.registry_public_concurrency_per_client,
        settings.registry_public_concurrency_global,
        settings.registry_public_limiter_max_keys,
        settings.registry_public_trusted_proxy_hops,
        settings.public_client_key_secret,
        settings.public_delivery_internal_token,
    )
    with _limiter_lock:
        if _limiter is None or _limiter_fingerprint != fingerprint:
            _limiter = PublicDeliveryLimiter(settings)
            _limiter_fingerprint = fingerprint
        return _limiter
