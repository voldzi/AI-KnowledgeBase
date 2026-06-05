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
    """Small single-process placeholder until platform rate limiting is introduced."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._windows: dict[str, WindowCounter] = {}

    def check(self, request: Request) -> None:
        if not self.settings.rate_limit_enabled:
            return

        client_host = request.client.host if request.client else "unknown"
        key = request.headers.get("X-Service-Name") or client_host
        now = time.monotonic()
        window = self._windows.get(key)

        if window is None or now - window.window_start >= 60:
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
