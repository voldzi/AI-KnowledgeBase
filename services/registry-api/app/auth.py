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
    service_client_id: str | None = None
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
    authorization = request.headers.get("Authorization") or ""
    bearer_token = (
        authorization.removeprefix("Bearer ").strip()
        if authorization.startswith("Bearer ")
        else None
    )
    service_client_id = request.headers.get("X-AKL-Service-Client-ID")
    if service_client_id and (
        service_client_id not in settings.trusted_service_clients
        or subject != f"service-account-{service_client_id}"
    ):
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "untrusted_service_identity",
            "The service client is not trusted by AKB",
        )
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
        service_identity=bool(service_client_id),
        service_client_id=service_client_id,
        bearer_token=bearer_token,
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
    service_client_id, conflicting_client_claims = _service_client_id(claims)
    service_looking = _is_service_identity(claims)
    trusted_service = bool(
        service_looking
        and service_client_id
        and service_client_id in settings.trusted_service_clients
        and _service_account_matches_client(claims, service_client_id)
    )
    if conflicting_client_claims or (service_looking and not trusted_service):
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "untrusted_service_identity",
            "The bearer token does not identify an explicitly trusted AKB service client",
        )
    service_identity = trusted_service
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
            service_client_id=service_client_id,
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
        service_client_id=None,
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


def _service_client_id(claims: dict) -> tuple[str | None, bool]:
    values = {
        value
        for key in ("azp", "client_id")
        if isinstance((value := claims.get(key)), str) and value
    }
    if len(values) > 1:
        return None, True
    return (next(iter(values)) if values else None), False


def _service_account_matches_client(claims: dict, client_id: str) -> bool:
    expected = f"service-account-{client_id}"
    subject = str(claims.get("sub") or "")
    username = str(claims.get("preferred_username") or "")
    if username and username != expected:
        return False
    if subject.startswith("service-account-") and subject != expected:
        return False
    return expected in {subject, username}


def get_current_principal(
    request: Request, settings: Settings = Depends(get_settings)
) -> Principal:
    if settings.auth_mode == "mock":
        principal = _mock_principal(request, settings)
    else:
        principal = _oidc_principal(request, settings)
    if principal.service_identity:
        _enforce_service_route(principal, request, settings)
    return principal


def _enforce_service_route(
    principal: Principal,
    request: Request,
    settings: Settings,
) -> None:
    client_id = principal.service_client_id
    route = _service_route_for_request(request)
    if (
        not client_id
        or client_id not in settings.trusted_service_clients
        or route is None
        or route not in settings.service_route_grants.get(client_id, frozenset())
    ):
        raise problem(
            status.HTTP_403_FORBIDDEN,
            "service_route_forbidden",
            "The service client is not allowed to call this Registry route",
        )


def _service_route_for_request(request: Request) -> str | None:
    path = request.url.path.removeprefix("/api/v1")
    write = request.method.upper() not in {"GET", "HEAD", "OPTIONS"}
    path_segments = path.strip("/").split("/")
    if path.startswith("/integrations/aiip-upload/"):
        return "aiip-upload"
    if path.startswith("/authz/"):
        return "authz"
    if path.startswith("/integrations/idempotency/"):
        return "idempotency"
    if path.startswith("/audit/events"):
        return "audit" if write else "audit-read"
    if path.startswith("/external-documents/"):
        return "external-documents-write" if write else "external-documents-read"
    if path.startswith("/document-extractions"):
        return "extractions-write" if write else "extractions-read"
    if (
        write
        and len(path_segments) == 4
        and path_segments[0] == "documents"
        and path_segments[2:] == ["external-references", "current"]
    ):
        return "ingestion-status"
    if path.startswith("/documents"):
        return "documents-write" if write else "documents-read"
    if path.startswith("/workflow/"):
        return "workflow-write" if write else "workflow-read"
    if path.startswith("/intelligence/"):
        return "intelligence-write" if write else "intelligence-read"
    if path.startswith("/assistant/"):
        return "assistant-write" if write else "assistant-read"
    if path.startswith("/admin/directory/"):
        return "directory-write" if write else "directory-read"
    if path.startswith("/directory/"):
        return "directory-write" if write else "directory-read"
    if path.startswith("/admin/role-mappings"):
        return "access-admin-write" if write else "access-admin-read"
    if path.startswith("/user-profiles/"):
        return "profile-write" if write else "profile-read"
    return None
