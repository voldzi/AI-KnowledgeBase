from __future__ import annotations

import time
from dataclasses import dataclass

from fastapi import Request

from app.config import Settings
from app.errors import GatewayError


@dataclass
class WindowCounter:
    window_start: float
    count: int


class InMemoryRateLimiter:
    """Bounded per-caller limiter for the single gateway process."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._windows: dict[str, WindowCounter] = {}

    def check(self, request: Request) -> None:
        if not self.settings.rate_limit_enabled:
            return

        principal = getattr(request.state, "principal", None)
        client_host = request.client.host if request.client else "unknown"
        key = principal if isinstance(principal, str) and principal else client_host
        now = time.monotonic()
        self._discard_expired(now)
        window = self._windows.get(key)

        if window is None or now - window.window_start >= 60:
            if len(self._windows) >= self.settings.rate_limit_max_identities:
                oldest_key = min(
                    self._windows,
                    key=lambda candidate: self._windows[candidate].window_start,
                )
                self._windows.pop(oldest_key, None)
            self._windows[key] = WindowCounter(window_start=now, count=1)
            return

        window.count += 1
        if window.count > self.settings.rate_limit_per_minute:
            raise GatewayError(
                "RATE_LIMIT_EXCEEDED",
                "Rate limit exceeded for this service",
                status_code=429,
                details={"limit_per_minute": self.settings.rate_limit_per_minute},
            )

    def _discard_expired(self, now: float) -> None:
        expired = [
            key
            for key, window in self._windows.items()
            if now - window.window_start >= 60
        ]
        for key in expired:
            self._windows.pop(key, None)
