from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import Settings
from app.context import get_correlation_id, get_request_id
from app.errors import EvaluationError

logger = logging.getLogger(__name__)


def outgoing_headers(settings: Settings, *, bearer_token: str | None = None) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "X-Request-ID": get_request_id(),
        "X-Correlation-ID": get_correlation_id(),
        "X-Service-Name": settings.service_name,
    }
    resolved_token = bearer_token or settings.upstream_bearer_token
    if resolved_token:
        headers["Authorization"] = f"Bearer {resolved_token}"
    return headers


async def request_json_with_retry(
    *,
    dependency: str,
    settings: Settings,
    method: str,
    url: str,
    json_body: dict[str, Any] | None = None,
    bearer_token: str | None = None,
) -> dict[str, Any]:
    last_error: Exception | None = None

    for attempt in range(settings.retry_attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                response = await client.request(
                    method,
                    url,
                    headers=outgoing_headers(settings, bearer_token=bearer_token),
                    json=json_body,
                )

            if response.status_code >= 500 and attempt < settings.retry_attempts:
                await asyncio.sleep(settings.retry_backoff_seconds * (attempt + 1))
                continue

            if response.status_code >= 400:
                raise EvaluationError(
                    "UPSTREAM_ERROR",
                    f"{dependency} returned an error",
                    status_code=502,
                    details={"dependency": dependency, "status_code": response.status_code},
                )

            if not response.content:
                return {}
            return response.json()
        except EvaluationError:
            raise
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
            logger.warning(
                "upstream_request_failed dependency=%s attempt=%s reason=%s",
                dependency,
                attempt + 1,
                exc.__class__.__name__,
            )
            if attempt < settings.retry_attempts:
                await asyncio.sleep(settings.retry_backoff_seconds * (attempt + 1))
                continue

    raise EvaluationError(
        "UPSTREAM_UNAVAILABLE",
        f"{dependency} is not reachable",
        status_code=502,
        details={"dependency": dependency, "reason": last_error.__class__.__name__ if last_error else "unknown"},
    )
