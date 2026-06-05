from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any

from fastapi import Request

from app.config import Settings
from app.errors import RetrievalError


@dataclass(frozen=True)
class AuthContext:
    subject_id: str
    roles: tuple[str, ...]
    groups: tuple[str, ...]
    bearer_token: str | None = None


def require_service_auth(request: Request, settings: Settings) -> None:
    if settings.auth_mode == "disabled":
        request.state.auth_context = _auth_context(request, settings)
        return

    if settings.auth_mode == "mock":
        request.state.principal = "mock-service-account"
        request.state.auth_context = _auth_context(request, settings)
        return

    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise RetrievalError("AUTH_REQUIRED", "Bearer token is required", status_code=401)

    if settings.auth_mode == "bearer" and settings.service_token and token != settings.service_token:
        raise RetrievalError(
            "AUTH_FORBIDDEN",
            "Bearer token is not authorized for this service",
            status_code=403,
        )

    request.state.principal = "service-account"
    request.state.auth_context = _auth_context(request, settings, bearer_token=token)


def auth_context_for_request(request: Request, settings: Settings) -> AuthContext:
    context = getattr(request.state, "auth_context", None)
    if isinstance(context, AuthContext):
        return context
    return _auth_context(request, settings)


def _auth_context(
    request: Request,
    settings: Settings,
    *,
    bearer_token: str | None = None,
) -> AuthContext:
    claims = _unverified_jwt_claims(bearer_token)
    subject_id = (
        request.headers.get("X-AKL-Subject")
        or _claim_str(claims, "sub")
        or settings.service_account_subject
    )
    roles = _csv_header(request.headers.get("X-AKL-Roles")) or _claim_roles(claims)
    groups = _csv_header(request.headers.get("X-AKL-Groups")) or _claim_list(claims.get("groups"))
    if not roles and settings.auth_mode in {"disabled", "mock", "bearer"}:
        roles = settings.service_account_roles

    return AuthContext(
        subject_id=subject_id,
        roles=tuple(roles),
        groups=tuple(groups),
        bearer_token=bearer_token,
    )


def _csv_header(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _unverified_jwt_claims(token: str | None) -> dict[str, Any]:
    if not token or token.count(".") < 2:
        return {}
    payload_segment = token.split(".", 2)[1]
    padding = "=" * (-len(payload_segment) % 4)
    try:
        decoded = base64.urlsafe_b64decode(f"{payload_segment}{padding}")
        claims = json.loads(decoded)
    except (ValueError, json.JSONDecodeError):
        return {}
    return claims if isinstance(claims, dict) else {}


def _claim_str(claims: dict[str, Any], key: str) -> str | None:
    value = claims.get(key)
    return value if isinstance(value, str) and value else None


def _claim_list(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item for item in value if isinstance(item, str) and item)


def _claim_roles(claims: dict[str, Any]) -> tuple[str, ...]:
    roles = set(_claim_list(claims.get("roles")))
    realm_access = claims.get("realm_access")
    if isinstance(realm_access, dict):
        roles.update(_claim_list(realm_access.get("roles")))
    resource_access = claims.get("resource_access")
    if isinstance(resource_access, dict):
        for client_claims in resource_access.values():
            if isinstance(client_claims, dict):
                roles.update(_claim_list(client_claims.get("roles")))
    return tuple(sorted(roles))
