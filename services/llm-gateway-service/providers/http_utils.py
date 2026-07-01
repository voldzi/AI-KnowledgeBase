from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import Settings
from app.context import get_correlation_id, get_request_id
from app.errors import GatewayError

logger = logging.getLogger(__name__)


def outgoing_headers(settings: Settings, api_key: str | None = None) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "X-Request-ID": get_request_id(),
        "X-Correlation-ID": get_correlation_id(),
        "X-Service-Name": settings.service_name,
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def provider_error(provider: str, message: str, details: dict[str, Any] | None = None) -> GatewayError:
    return GatewayError(
        "LLM_PROVIDER_ERROR",
        message,
        status_code=502,
        details={"provider": provider, **(details or {})},
    )


async def request_json_with_retry(
    *,
    provider: str,
    settings: Settings,
    method: str,
    url: str,
    headers: dict[str, str],
    json_body: dict[str, Any] | None = None,
    timeout_seconds: float | None = None,
    retry_attempts: int | None = None,
) -> dict[str, Any]:
    last_error: Exception | None = None
    attempts = settings.retry_attempts if retry_attempts is None else retry_attempts
    timeout = settings.request_timeout_seconds if timeout_seconds is None else timeout_seconds

    for attempt in range(attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.request(method, url, headers=headers, json=json_body)

            if response.status_code >= 500 and attempt < attempts:
                await asyncio.sleep(settings.retry_backoff_seconds * (attempt + 1))
                continue

            if response.status_code >= 400:
                raise provider_error(
                    provider,
                    "LLM provider returned an error",
                    {"status_code": response.status_code},
                )

            return response.json()
        except GatewayError:
            raise
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
            logger.warning(
                "provider_request_failed provider=%s attempt=%s reason=%s",
                provider,
                attempt + 1,
                exc.__class__.__name__,
            )
            if attempt < attempts:
                await asyncio.sleep(settings.retry_backoff_seconds * (attempt + 1))
                continue

    raise provider_error(
        provider,
        "LLM provider is not reachable",
        {"reason": last_error.__class__.__name__ if last_error else "unknown"},
    )
