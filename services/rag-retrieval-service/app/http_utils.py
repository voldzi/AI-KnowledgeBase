from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import Settings
from app.context import get_correlation_id, get_request_id
from app.errors import RetrievalError
from app.security import AuthContext

logger = logging.getLogger(__name__)


def outgoing_headers(
    settings: Settings,
    auth_context: AuthContext | None = None,
    *,
    prefer_upstream_token: bool = False,
) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "X-Request-ID": get_request_id(),
        "X-Correlation-ID": get_correlation_id(),
        "X-Service-Name": settings.service_name,
    }
    use_upstream_identity = prefer_upstream_token and settings.upstream_bearer_token
    if use_upstream_identity:
        headers["X-AKL-Subject"] = settings.service_account_subject
        if settings.service_account_roles:
            headers["X-AKL-Roles"] = ",".join(settings.service_account_roles)
    elif auth_context:
        headers["X-AKL-Subject"] = auth_context.subject_id
        if auth_context.roles:
            headers["X-AKL-Roles"] = ",".join(auth_context.roles)
        if auth_context.groups:
            headers["X-AKL-Groups"] = ",".join(auth_context.groups)
    bearer_token = None if use_upstream_identity else auth_context.bearer_token if auth_context else None
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    elif settings.upstream_bearer_token:
        headers["Authorization"] = f"Bearer {settings.upstream_bearer_token}"
    return headers


async def request_json_with_retry(
    *,
    dependency: str,
    settings: Settings,
    method: str,
    url: str,
    json_body: dict[str, Any] | None = None,
    auth_context: AuthContext | None = None,
    prefer_upstream_token: bool = False,
) -> dict[str, Any]:
    last_error: Exception | None = None

    for attempt in range(settings.retry_attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                response = await client.request(
                    method,
                    url,
                    headers=outgoing_headers(
                        settings,
                        auth_context,
                        prefer_upstream_token=prefer_upstream_token,
                    ),
                    json=json_body,
                )

            if response.status_code >= 500 and attempt < settings.retry_attempts:
                await asyncio.sleep(settings.retry_backoff_seconds * (attempt + 1))
                continue

            if response.status_code >= 400:
                raise RetrievalError(
                    "UPSTREAM_ERROR",
                    f"{dependency} returned an error",
                    status_code=502,
                    details={"dependency": dependency, "status_code": response.status_code},
                )

            if not response.content:
                return {}
            return response.json()
        except RetrievalError:
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

    raise RetrievalError(
        "UPSTREAM_UNAVAILABLE",
        f"{dependency} is not reachable",
        status_code=502,
        details={"dependency": dependency, "reason": last_error.__class__.__name__ if last_error else "unknown"},
    )
