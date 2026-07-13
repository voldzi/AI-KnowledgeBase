from dataclasses import dataclass

import jwt
from fastapi import Depends, Request
from jwt import PyJWKClient
from starlette import status

from app.config import Settings, get_settings
from app.access_governance import GovernanceDenied, GovernanceUnavailable, governance_client
from app.errors import problem


@dataclass(frozen=True)
class Principal:
    subject_id: str
    roles: set[str]
    groups: set[str]
    capabilities: set[str] = frozenset()
    scopes: set[str] = frozenset()
    organization_id: str = "org_stratos"
    identity_active: bool = True
    membership_active: bool = True
    application_access_active: bool = True
    dynamic_access_loaded: bool = False
    service_identity: bool = False
    bearer_token: str | None = None

    @property
    def access_v2(self) -> bool:
        return bool(
            self.dynamic_access_loaded
            or self.service_identity
            or self.capabilities
            or {"stratos_user", "stratos_admin"}.intersection(self.roles)
        )


def _split_header(value: str | None) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(",") if item.strip()}


def _mock_principal(request: Request, settings: Settings) -> Principal:
    subject = request.headers.get("X-AKL-Subject") or settings.mock_subject
    roles = _split_header(request.headers.get("X-AKL-Roles")) or set(settings.mock_roles)
    groups = _split_header(request.headers.get("X-AKL-Groups"))
    return Principal(
        subject_id=subject,
        roles=roles,
        groups=groups,
        capabilities=_split_header(request.headers.get("X-STRATOS-Capabilities")),
        scopes=_split_header(request.headers.get("X-STRATOS-Scopes")),
        organization_id=request.headers.get("X-STRATOS-Organization-ID") or "org_stratos",
        identity_active=_header_bool(request, "X-STRATOS-Identity-Active", True),
        membership_active=_header_bool(request, "X-STRATOS-Membership-Active", True),
        application_access_active=_header_bool(request, "X-STRATOS-Application-Access-Active", True),
    )


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
    subject_id = str(claims["sub"])
    service_identity = _is_service_identity(claims)
    if service_identity:
        return Principal(
            subject_id=subject_id,
            roles=roles,
            groups=groups,
            capabilities=frozenset(),
            scopes=frozenset(),
            organization_id="org_stratos",
            identity_active=True,
            membership_active=True,
            application_access_active=False,
            dynamic_access_loaded=False,
            service_identity=True,
            bearer_token=token,
        )
    try:
        projection = governance_client(settings).user_projection(
            token,
            token_expires_at=float(claims["exp"]) if isinstance(claims.get("exp"), int | float) else None,
        )
    except GovernanceDenied as exc:
        raise problem(status.HTTP_403_FORBIDDEN, "access_projection_denied", str(exc)) from exc
    except GovernanceUnavailable as exc:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "access_projection_unavailable",
            "STRATOS access projection is unavailable",
        ) from exc
    return Principal(
        subject_id=subject_id,
        roles=roles,
        groups=groups,
        capabilities=set(projection.capabilities),
        scopes=set(projection.scopes),
        organization_id=projection.organization_id,
        identity_active=projection.identity_active,
        membership_active=projection.membership_active,
        application_access_active=projection.application_access_active,
        dynamic_access_loaded=True,
        service_identity=False,
        bearer_token=token,
    )


def _header_bool(request: Request, name: str, default: bool) -> bool:
    value = request.headers.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _is_service_identity(claims: dict) -> bool:
    subject = str(claims.get("sub") or "")
    username = str(claims.get("preferred_username") or "")
    return bool(
        subject.startswith("service-account-")
        or username.startswith("service-account-")
    )


def get_current_principal(
    request: Request, settings: Settings = Depends(get_settings)
) -> Principal:
    if settings.auth_mode == "mock":
        return _mock_principal(request, settings)
    return _oidc_principal(request, settings)
