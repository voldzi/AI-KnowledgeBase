from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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

ACTIVE_PROJECTION_SCHEMA = "stratos-access-projection-2"
ACTIVE_PROJECTION_REVISION = "2.1.0"
ACTIVE_PROJECTION_STATUS = "active"
ACTIVE_PROJECTION_DIGEST = (
    "sha256:16509ccbdc3e49e7a9918a29c833a8ae1aa7c78777b0a8693a2477acc2f0dafa"
)
ACTIVE_PROJECTION_CATALOG = "capabilities-1.12.4"
ACTIVE_PROJECTION_ORGANIZATION = "org_stratos"
_PROJECTION_ROOT_KEYS = {
    "applicationAccess", "catalogVersion", "contractDigest", "contractRevision",
    "contractStatus", "expiresAt", "generatedAt", "identity", "membership",
    "organizationId", "schemaVersion",
}
_IDENTITY_KEYS = {"active", "employeeEligible", "kind", "subjectId"}
_MEMBERSHIP_KEYS = {"active", "validUntil"}
_APPLICATION_KEYS = {"applicationId", "entitlements"}
_ENTITLEMENT_KEYS = {
    "capabilities", "definitionVersion", "effectiveScopes", "entitlementId",
    "profileId", "scopes", "source", "sourceRef", "validFrom", "validUntil",
    "virtual",
}
_SCOPE_TYPES = {
    "own", "public", "organization", "organization_unit", "budget_scope",
    "portfolio", "project", "document", "recipient_set",
}
_ENTITLEMENT_SOURCES = {"MANUAL", "KEYCLOAK_GROUP", "OIDC", "SYSTEM"}
_EVALUATION_CAPABILITY_PRIORITY = (
    "akb:manage_access", "akb:read_audit", "akb:manage_document", "akb:read_document"
)


@dataclass(frozen=True)
class EvaluationPrincipal:
    subject_id: str
    roles: tuple[str, ...]
    groups: tuple[str, ...]
    bearer_token: str | None
    capabilities: tuple[str, ...] = ()
    scopes: tuple[str, ...] = ()
    trusted_service: bool = False
    token_expires_at: int | None = None


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
    capabilities, scopes = _stratos_projection(token, settings, expected_subject_id=subject_id)
    return EvaluationPrincipal(
        subject_id=subject_id,
        roles=(),
        groups=(),
        bearer_token=token,
        capabilities=capabilities,
        scopes=scopes,
        token_expires_at=int(claims["exp"]) if isinstance(claims.get("exp"), (int, float)) else None,
    )


def _stratos_projection(
    token: str,
    settings: Settings,
    *,
    expected_subject_id: str,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
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
    try:
        return _parse_active_projection(body, expected_subject_id=expected_subject_id)
    except (TypeError, ValueError) as exc:
        raise EvaluationError(
            "ACCESS_PROJECTION_UNAVAILABLE",
            "STRATOS access projection is malformed",
            status_code=503,
        ) from exc


def _parse_active_projection(
    body: Any,
    *,
    expected_subject_id: str,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    root = _exact_record(body, _PROJECTION_ROOT_KEYS, "projection")
    expected_literals = {
        "schemaVersion": ACTIVE_PROJECTION_SCHEMA,
        "contractRevision": ACTIVE_PROJECTION_REVISION,
        "contractStatus": ACTIVE_PROJECTION_STATUS,
        "contractDigest": ACTIVE_PROJECTION_DIGEST,
        "catalogVersion": ACTIVE_PROJECTION_CATALOG,
        "organizationId": ACTIVE_PROJECTION_ORGANIZATION,
    }
    for key, expected in expected_literals.items():
        if root.get(key) != expected:
            raise ValueError(f"invalid {key}")

    now = datetime.now(timezone.utc)
    generated_at = _projection_datetime(root.get("generatedAt"), "generatedAt")
    expires_at = _projection_datetime(root.get("expiresAt"), "expiresAt")
    if (
        generated_at > now
        or expires_at <= now
        or expires_at <= generated_at
        or expires_at - generated_at > timedelta(minutes=15)
    ):
        raise ValueError("invalid projection window")

    identity = _exact_record(root.get("identity"), _IDENTITY_KEYS, "identity")
    if (
        identity.get("subjectId") != expected_subject_id
        or identity.get("kind") != "person"
        or identity.get("active") is not True
        or not isinstance(identity.get("employeeEligible"), bool)
    ):
        return (), ()
    membership = _exact_record(root.get("membership"), _MEMBERSHIP_KEYS, "membership")
    membership_until = membership.get("validUntil")
    if membership.get("active") is not True:
        return (), ()
    if membership_until is not None:
        if _projection_datetime(membership_until, "membership.validUntil") <= now:
            return (), ()

    accesses = root.get("applicationAccess")
    if not isinstance(accesses, list) or len(accesses) > 5:
        raise ValueError("invalid applicationAccess")
    applications: dict[str, dict[str, Any]] = {}
    for value in accesses:
        application = _exact_record(value, _APPLICATION_KEYS, "applicationAccess item")
        application_id = application.get("applicationId")
        if not isinstance(application_id, str) or not application_id or application_id in applications:
            raise ValueError("invalid applicationId")
        applications[application_id] = application
    access = applications.get("akb")
    if access is None:
        return (), ()
    values = access.get("entitlements")
    if not isinstance(values, list) or not 1 <= len(values) <= 32:
        raise ValueError("invalid entitlements")

    eligible: list[tuple[int, str, tuple[str, ...], tuple[str, ...]]] = []
    seen: set[str] = set()
    for value in values:
        entitlement = _exact_record(value, _ENTITLEMENT_KEYS, "entitlement")
        entitlement_id = entitlement.get("entitlementId")
        if not isinstance(entitlement_id, str) or not entitlement_id or entitlement_id in seen:
            raise ValueError("invalid entitlementId")
        seen.add(entitlement_id)
        if (
            entitlement.get("definitionVersion") != ACTIVE_PROJECTION_CATALOG
            or entitlement.get("source") not in _ENTITLEMENT_SOURCES
            or not isinstance(entitlement.get("virtual"), bool)
        ):
            raise ValueError("invalid entitlement metadata")
        valid_from = _optional_projection_datetime(entitlement.get("validFrom"), "validFrom")
        valid_until = _optional_projection_datetime(entitlement.get("validUntil"), "validUntil")
        if valid_from is not None and valid_until is not None and valid_until <= valid_from:
            raise ValueError("invalid entitlement window")
        capabilities = _strict_string_list(entitlement.get("capabilities"), "capabilities")
        _parse_scopes(entitlement.get("scopes"), "scopes")
        scopes = _parse_scopes(entitlement.get("effectiveScopes"), "effectiveScopes")
        if (valid_from is not None and valid_from > now) or (valid_until is not None and valid_until <= now):
            continue
        matched = [
            index for index, capability in enumerate(_EVALUATION_CAPABILITY_PRIORITY)
            if capability in capabilities
        ]
        if matched:
            eligible.append((min(matched), entitlement_id, tuple(sorted(capabilities)), scopes))

    if not eligible:
        return (), ()
    # Preserve a single entitlement boundary. Never form a cartesian union of
    # capabilities and scopes from separate STRATOS grants.
    _, _, capabilities, scopes = sorted(eligible, key=lambda item: (item[0], item[1]))[0]
    return capabilities, scopes


def _exact_record(value: Any, expected_keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise ValueError(f"invalid {label}")
    return value


def _projection_datetime(value: Any, label: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"invalid {label}")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"invalid {label}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"invalid {label}")
    return parsed.astimezone(timezone.utc)


def _optional_projection_datetime(value: Any, label: str) -> datetime | None:
    return None if value is None else _projection_datetime(value, label)


def _strict_string_list(value: Any, label: str) -> tuple[str, ...]:
    if (
        not isinstance(value, list)
        or not value
        or any(not isinstance(item, str) or not item for item in value)
        or len(set(value)) != len(value)
    ):
        raise ValueError(f"invalid {label}")
    return tuple(value)


def _parse_scopes(value: Any, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"invalid {label}")
    parsed: list[str] = []
    for item in value:
        if not isinstance(item, dict) or set(item) not in ({"type"}, {"id", "type"}):
            raise ValueError(f"invalid {label}")
        scope_type = item.get("type")
        scope_id = item.get("id")
        if scope_type not in _SCOPE_TYPES:
            raise ValueError(f"invalid {label}")
        if scope_type in {"own", "public"}:
            if set(item) != {"type"}:
                raise ValueError(f"invalid {label}")
            parsed.append(str(scope_type))
        else:
            if not isinstance(scope_id, str) or not scope_id:
                raise ValueError(f"invalid {label}")
            parsed.append(f"{scope_type}:{scope_id}")
    if len(set(parsed)) != len(parsed):
        raise ValueError(f"invalid {label}")
    return tuple(sorted(parsed))


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
