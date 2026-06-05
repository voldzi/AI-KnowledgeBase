from __future__ import annotations

from fastapi import Request

from app.config import Settings
from app.errors import GovernanceError


def require_service_auth(request: Request, settings: Settings) -> None:
    if settings.auth_mode == "disabled":
        return

    if settings.auth_mode == "mock":
        request.state.principal = "mock-service-account"
        return

    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise GovernanceError("AUTH_REQUIRED", "Bearer token is required", status_code=401)

    if settings.service_token and token != settings.service_token:
        raise GovernanceError(
            "AUTH_FORBIDDEN",
            "Bearer token is not authorized for this service",
            status_code=403,
        )

    request.state.principal = "service-account"
