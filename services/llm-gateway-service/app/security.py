from __future__ import annotations

from fastapi import Request

from app.config import Settings
from app.errors import GatewayError


def require_service_auth(request: Request, settings: Settings) -> None:
    if settings.auth_mode == "disabled":
        return

    if settings.auth_mode == "mock":
        request.state.principal = "mock-service-account"
        return

    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise GatewayError(
            "AUTH_REQUIRED",
            "Bearer token is required",
            status_code=401,
        )

    if settings.auth_mode == "bearer" and settings.service_token and token != settings.service_token:
        raise GatewayError(
            "AUTH_FORBIDDEN",
            "Bearer token is not authorized for this service",
            status_code=403,
        )

    subject = request.headers.get("X-AKL-Subject", "").strip()
    if settings.require_caller_identity:
        if not subject:
            raise GatewayError(
                "AUTH_IDENTITY_REQUIRED",
                "Service identity is required",
                status_code=403,
            )
        audience = request.headers.get("X-AKL-Audience", "").strip()
        if audience != settings.gateway_audience:
            raise GatewayError(
                "AUTH_AUDIENCE_FORBIDDEN",
                "Bearer token is not intended for this service audience",
                status_code=403,
            )
        roles = {
            role.strip()
            for role in request.headers.get("X-AKL-Roles", "").split(",")
            if role.strip()
        }
        if not roles.intersection(settings.allowed_caller_roles):
            raise GatewayError(
                "AUTH_ROLE_FORBIDDEN",
                "Service identity does not have an allowed caller role",
                status_code=403,
            )

    request.state.principal = subject or "service-account"
