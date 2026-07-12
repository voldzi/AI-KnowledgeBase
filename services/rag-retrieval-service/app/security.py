from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Request
import jwt
from jwt import PyJWKClient

from app.config import Settings
from app.errors import RetrievalError


@dataclass(frozen=True)
class AuthContext:
    subject_id: str
    roles: tuple[str, ...]
    groups: tuple[str, ...]
    capabilities: tuple[str, ...] = ()
    scopes: tuple[str, ...] = ()
    organization_id: str = "org_stratos"
    identity_active: bool = True
    membership_active: bool = True
    application_access_active: bool = True
    bearer_token: str | None = None
    service_identity: bool = False


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

    if settings.auth_mode == "bearer":
        if not settings.service_token or token != settings.service_token:
            raise RetrievalError(
                "AUTH_FORBIDDEN",
                "Bearer token is not authorized for this service",
                status_code=403,
            )
        request.state.principal = "service-account"
        request.state.auth_context = AuthContext(
            subject_id=settings.service_account_subject,
            roles=settings.service_account_roles,
            groups=(),
            bearer_token=token,
            service_identity=True,
            identity_active=True,
            membership_active=False,
            application_access_active=False,
        )
        return

    claims = _verified_oidc_claims(token, settings)
    request.state.principal = "verified-oidc"
    request.state.auth_context = _oidc_context(claims, token)


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
    if settings.auth_mode not in {"disabled", "mock"}:
        return AuthContext(
            subject_id=settings.service_account_subject,
            roles=(),
            groups=(),
            bearer_token=bearer_token,
            service_identity=settings.auth_mode == "bearer",
            identity_active=False,
            membership_active=False,
            application_access_active=False,
        )
    claims: dict[str, Any] = {}
    subject_id = (
        request.headers.get("X-AKL-Subject")
        or _claim_str(claims, "sub")
        or settings.service_account_subject
    )
    roles = _csv_header(request.headers.get("X-AKL-Roles")) or _claim_roles(claims)
    groups = _csv_header(request.headers.get("X-AKL-Groups")) or _claim_list(claims.get("groups"))
    capabilities = _csv_header(request.headers.get("X-STRATOS-Capabilities"))
    scopes = _csv_header(request.headers.get("X-STRATOS-Scopes"))
    if not roles and settings.auth_mode in {"disabled", "mock", "bearer"}:
        roles = settings.service_account_roles

    return AuthContext(
        subject_id=subject_id,
        roles=tuple(roles),
        groups=tuple(groups),
        capabilities=tuple(capabilities),
        scopes=tuple(scopes),
        organization_id=request.headers.get("X-STRATOS-Organization-ID") or "org_stratos",
        identity_active=_header_bool(request, "X-STRATOS-Identity-Active", True),
        membership_active=_header_bool(request, "X-STRATOS-Membership-Active", True),
        application_access_active=_header_bool(request, "X-STRATOS-Application-Access-Active", True),
        bearer_token=bearer_token,
    )


def _csv_header(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _verified_oidc_claims(token: str, settings: Settings) -> dict[str, Any]:
    if not settings.oidc_issuer or not settings.oidc_audience or not settings.oidc_jwks_url:
        raise RetrievalError("AUTH_CONFIG_INVALID", "OIDC verification is not configured", status_code=503)
    try:
        signing_key = PyJWKClient(settings.oidc_jwks_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience=settings.oidc_audience,
            issuer=settings.oidc_issuer,
        )
    except jwt.PyJWTError as exc:
        raise RetrievalError("AUTH_REQUIRED", "Invalid bearer token", status_code=401) from exc
    return claims


def _oidc_context(claims: dict[str, Any], token: str) -> AuthContext:
    roles = _claim_roles(claims)
    subject = _claim_str(claims, "sub")
    if not subject:
        raise RetrievalError("AUTH_REQUIRED", "Bearer token subject is missing", status_code=401)
    service_identity = _is_service_identity(claims)
    return AuthContext(
        subject_id=subject,
        roles=roles,
        groups=_claim_list(claims.get("groups")),
        capabilities=(),
        scopes=(),
        organization_id="org_stratos",
        identity_active=service_identity,
        membership_active=False,
        application_access_active=False,
        bearer_token=token,
        service_identity=service_identity,
    )


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


def _header_bool(request: Request, name: str, default: bool) -> bool:
    value = request.headers.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _is_service_identity(claims: dict[str, Any]) -> bool:
    return bool(
        str(claims.get("sub") or "").startswith("service-account-")
        or str(claims.get("preferred_username") or "").startswith("service-account-")
    )
