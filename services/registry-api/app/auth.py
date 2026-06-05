from dataclasses import dataclass

import jwt
from fastapi import Depends, Request
from jwt import PyJWKClient
from starlette import status

from app.config import Settings, get_settings
from app.errors import problem


@dataclass(frozen=True)
class Principal:
    subject_id: str
    roles: set[str]
    groups: set[str]


def _split_header(value: str | None) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(",") if item.strip()}


def _mock_principal(request: Request, settings: Settings) -> Principal:
    subject = request.headers.get("X-AKL-Subject") or settings.mock_subject
    roles = _split_header(request.headers.get("X-AKL-Roles")) or set(settings.mock_roles)
    groups = _split_header(request.headers.get("X-AKL-Groups"))
    return Principal(subject_id=subject, roles=roles, groups=groups)


def _oidc_principal(request: Request, settings: Settings) -> Principal:
    authorization = request.headers.get("Authorization")
    if not authorization or not authorization.startswith("Bearer "):
        raise problem(status.HTTP_401_UNAUTHORIZED, "unauthorized", "Bearer token is required")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        jwk_client = PyJWKClient(settings.oidc_jwks_url)
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience=settings.oidc_audience,
            issuer=settings.oidc_issuer,
        )
    except jwt.PyJWTError as exc:
        raise problem(status.HTTP_401_UNAUTHORIZED, "unauthorized", "Invalid bearer token") from exc

    roles = set(claims.get("roles") or [])
    roles.update(claims.get("realm_access", {}).get("roles", []))
    for client_claims in claims.get("resource_access", {}).values():
        roles.update(client_claims.get("roles", []))

    groups = set(claims.get("groups") or [])
    return Principal(subject_id=claims["sub"], roles=roles, groups=groups)


def get_current_principal(
    request: Request, settings: Settings = Depends(get_settings)
) -> Principal:
    if settings.auth_mode == "mock":
        return _mock_principal(request, settings)
    return _oidc_principal(request, settings)
