from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

import jwt
import httpx
from fastapi import Request
from jwt import PyJWKClient

from app.config import Settings
from app.errors import EvaluationError


EVALUATION_CAPABILITIES = {
    "akb:read_document",
    "akb:manage_document",
    "akb:read_audit",
    "akb:manage_access",
}


@dataclass(frozen=True)
class EvaluationPrincipal:
    subject_id: str
    roles: tuple[str, ...]
    groups: tuple[str, ...]
    bearer_token: str | None
    capabilities: tuple[str, ...] = ()
    scopes: tuple[str, ...] = ()
    trusted_service: bool = False


def require_service_auth(request: Request, settings: Settings) -> EvaluationPrincipal:
    if settings.auth_mode == "disabled":
        principal = EvaluationPrincipal(
            subject_id="local-evaluator",
            roles=("admin",),
            groups=(),
            bearer_token=None,
            trusted_service=True,
        )
    elif settings.auth_mode == "mock":
        principal = EvaluationPrincipal(
            subject_id=request.headers.get("X-AKL-Subject") or "mock-evaluator",
            roles=_csv_header(request.headers.get("X-AKL-Roles")) or ("admin",),
            groups=_csv_header(request.headers.get("X-AKL-Groups")),
            bearer_token=None,
            trusted_service=True,
        )
    else:
        token = _bearer_token(request)
        if settings.auth_mode == "bearer":
            if settings.service_token and token != settings.service_token:
                raise EvaluationError(
                    "AUTH_FORBIDDEN",
                    "Bearer token is not authorized for this service",
                    status_code=403,
                )
            principal = EvaluationPrincipal(
                subject_id="service-evaluation",
                roles=("service_evaluation",),
                groups=(),
                bearer_token=token,
                trusted_service=True,
            )
        else:
            principal = _oidc_principal(token, settings)

    if not principal.trusted_service and not EVALUATION_CAPABILITIES.intersection(principal.capabilities):
        raise EvaluationError(
            "AUTH_FORBIDDEN",
            "The current STRATOS projection cannot access retrieval quality evaluations",
            status_code=403,
        )

    request.state.evaluation_principal = principal
    return principal


def principal_for_request(request: Request) -> EvaluationPrincipal:
    principal = getattr(request.state, "evaluation_principal", None)
    if not isinstance(principal, EvaluationPrincipal):
        raise EvaluationError("AUTH_REQUIRED", "Evaluation principal is missing", status_code=401)
    return principal


def _bearer_token(request: Request) -> str:
    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise EvaluationError("AUTH_REQUIRED", "Bearer token is required", status_code=401)
    return token


def _oidc_principal(token: str, settings: Settings) -> EvaluationPrincipal:
    assert settings.oidc_jwks_url
    assert settings.oidc_audience
    assert settings.oidc_issuer
    try:
        signing_key = _jwk_client(settings.oidc_jwks_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience=settings.oidc_audience,
            issuer=settings.oidc_issuer,
        )
    except jwt.PyJWTError as exc:
        raise EvaluationError("AUTH_FORBIDDEN", "Bearer token is invalid", status_code=403) from exc
    subject_id = claims.get("sub")
    if not isinstance(subject_id, str) or not subject_id:
        raise EvaluationError("AUTH_FORBIDDEN", "Bearer token has no subject", status_code=403)
    capabilities, scopes = _stratos_projection(token, settings)
    return EvaluationPrincipal(
        subject_id=subject_id,
        roles=(),
        groups=(),
        bearer_token=token,
        capabilities=capabilities,
        scopes=scopes,
    )


def _stratos_projection(token: str, settings: Settings) -> tuple[tuple[str, ...], tuple[str, ...]]:
    if not settings.stratos_auth_me_url:
        raise EvaluationError(
            "ACCESS_PROJECTION_UNAVAILABLE",
            "STRATOS access projection is not configured",
            status_code=503,
        )
    try:
        with httpx.Client(timeout=settings.stratos_access_timeout_seconds) as client:
            response = client.get(
                settings.stratos_auth_me_url,
                headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as exc:
        raise EvaluationError(
            "ACCESS_PROJECTION_UNAVAILABLE",
            "STRATOS access projection is unavailable",
            status_code=503,
        ) from exc
    if response.status_code in {401, 403}:
        raise EvaluationError("AUTH_FORBIDDEN", "STRATOS rejected the bearer identity", status_code=403)
    if response.status_code != 200:
        raise EvaluationError(
            "ACCESS_PROJECTION_UNAVAILABLE",
            "STRATOS access projection is unavailable",
            status_code=503,
        )
    try:
        body = response.json()
    except ValueError as exc:
        raise EvaluationError(
            "ACCESS_PROJECTION_UNAVAILABLE",
            "STRATOS access projection is malformed",
            status_code=503,
        ) from exc
    if not isinstance(body, dict) or body.get("tenantId") != "org_stratos":
        raise EvaluationError(
            "ACCESS_PROJECTION_UNAVAILABLE",
            "STRATOS access projection is malformed",
            status_code=503,
        )
    accesses = body.get("applicationAccess")
    if not isinstance(accesses, list):
        raise EvaluationError(
            "ACCESS_PROJECTION_UNAVAILABLE",
            "STRATOS access projection is malformed",
            status_code=503,
        )
    access = next(
        (
            item for item in accesses
            if isinstance(item, dict)
            and str(item.get("application") or "").lower().replace("_", "-") == "akb"
        ),
        None,
    )
    if access is None:
        return (), ()
    if not _access_is_current(access.get("validUntil")):
        return (), ()
    capabilities = tuple(sorted(_claim_list(access.get("capabilities"))))
    scopes_value = access.get("scopes")
    scopes: list[str] = []
    if isinstance(scopes_value, list):
        for item in scopes_value:
            if not isinstance(item, dict) or not isinstance(item.get("type"), str):
                continue
            scope_id = item.get("id")
            scopes.append(f"{item['type']}:{scope_id}" if isinstance(scope_id, str) and scope_id else item["type"])
    return capabilities, tuple(sorted(set(scopes)))


def _access_is_current(value: Any) -> bool:
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")) > datetime.now(timezone.utc)
    except ValueError:
        return False


@lru_cache(maxsize=4)
def _jwk_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url)


def _csv_header(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _claim_list(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item for item in value if isinstance(item, str) and item)
