from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import secrets

import jwt

from app.config import Settings


ISSUER = "akb-registry"
AUDIENCE = "akb-ingestion-service"
ALLOWED_ACTIONS = frozenset(
    {"document.ingest", "document.read", "document.reindex"}
)
INTELLIGENCE_SCOPE_ACTION = "intelligence.query"


@dataclass(frozen=True)
class ConfirmedIngestionAuthorization:
    authorization_id: str
    subject_id: str
    expires_at: datetime


@dataclass(frozen=True)
class ConfirmedIntelligenceScopeAuthorization:
    authorization_id: str
    subject_id: str
    document_scope_hash: str
    document_count: int
    expires_at: datetime


def canonical_intelligence_scope(
    documents: list[dict[str, str]],
) -> tuple[tuple[dict[str, str], ...], str]:
    normalized = tuple(
        sorted(
            (
                {
                    "document_id": item.get("document_id", ""),
                    "document_version_id": item.get("document_version_id", ""),
                    "policy_hash": item.get("policy_hash", ""),
                }
                for item in documents
            ),
            key=lambda item: item["document_id"],
        )
    )
    document_ids = [item["document_id"] for item in normalized]
    if (
        not normalized
        or len(set(document_ids)) != len(normalized)
        or any(
            not item["document_id"]
            or not item["document_version_id"]
            or len(item["document_id"]) > 128
            or len(item["document_version_id"]) > 128
            or len(item["policy_hash"]) != 71
            or not item["policy_hash"].startswith("sha256:")
            for item in normalized
        )
    ):
        raise ValueError("The intelligence document coordinates are invalid")
    payload = json.dumps(
        normalized,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return normalized, f"sha256:{sha256(payload).hexdigest()}"


def issue_intelligence_scope_authorization(
    settings: Settings,
    *,
    subject_id: str,
    documents: list[dict[str, str]],
    correlation_id: str,
    idempotency_key: str,
) -> tuple[str, ConfirmedIntelligenceScopeAuthorization]:
    normalized, document_scope_hash = canonical_intelligence_scope(documents)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=settings.ingestion_authorization_ttl_seconds)
    authorization_id = f"iscope_{secrets.token_urlsafe(18)}"
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": subject_id,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": authorization_id,
        "action": INTELLIGENCE_SCOPE_ACTION,
        "document_scope_hash": document_scope_hash,
        "document_count": len(normalized),
        "correlation_id": correlation_id,
        "idempotency_key": idempotency_key,
    }
    token = jwt.encode(claims, _secret(settings), algorithm="HS256")
    return token, ConfirmedIntelligenceScopeAuthorization(
        authorization_id=authorization_id,
        subject_id=subject_id,
        document_scope_hash=document_scope_hash,
        document_count=len(normalized),
        expires_at=expires_at,
    )


def confirm_intelligence_scope_authorization(
    settings: Settings,
    token: str,
    *,
    expected_subject_id: str,
    documents: list[dict[str, str]],
    correlation_id: str,
    idempotency_key: str,
) -> ConfirmedIntelligenceScopeAuthorization:
    normalized, document_scope_hash = canonical_intelligence_scope(documents)
    try:
        claims = jwt.decode(
            token,
            _secret(settings),
            algorithms=["HS256"],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={
                "require": [
                    "iss",
                    "aud",
                    "sub",
                    "iat",
                    "exp",
                    "jti",
                    "action",
                    "document_scope_hash",
                    "document_count",
                    "correlation_id",
                    "idempotency_key",
                ]
            },
        )
    except jwt.PyJWTError as exc:
        raise ValueError("The intelligence scope proof is invalid or expired") from exc
    exact_claims = {
        "sub": expected_subject_id,
        "action": INTELLIGENCE_SCOPE_ACTION,
        "document_scope_hash": document_scope_hash,
        "document_count": len(normalized),
        "correlation_id": correlation_id,
        "idempotency_key": idempotency_key,
    }
    if any(claims.get(key) != value for key, value in exact_claims.items()):
        raise ValueError("The intelligence scope proof is bound to another request")
    authorization_id = claims.get("jti")
    expires_at_value = claims.get("exp")
    if (
        not isinstance(authorization_id, str)
        or not authorization_id.startswith("iscope_")
        or not isinstance(expires_at_value, int | float)
        or isinstance(expires_at_value, bool)
    ):
        raise ValueError("The intelligence scope proof contains invalid claims")
    return ConfirmedIntelligenceScopeAuthorization(
        authorization_id=authorization_id,
        subject_id=expected_subject_id,
        document_scope_hash=document_scope_hash,
        document_count=len(normalized),
        expires_at=datetime.fromtimestamp(float(expires_at_value), tz=timezone.utc),
    )


def issue_ingestion_authorization(
    settings: Settings,
    *,
    subject_id: str,
    action: str,
    document_id: str,
    document_version_id: str,
    organization_id: str,
    governed_resource_id: str,
    governed_source_version: str,
    governed_parent_resource_id: str | None,
    policy_binding_id: str,
    policy_version: str,
    policy_hash: str,
    governance_scope_hash: str,
    correlation_id: str,
    idempotency_key: str,
) -> tuple[str, ConfirmedIngestionAuthorization]:
    if action not in ALLOWED_ACTIONS:
        raise ValueError("Unsupported ingestion authorization action")
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=settings.ingestion_authorization_ttl_seconds)
    authorization_id = f"iauth_{secrets.token_urlsafe(18)}"
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": subject_id,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": authorization_id,
        "action": action,
        "document_id": document_id,
        "document_version_id": document_version_id,
        "organization_id": organization_id,
        "governed_resource_id": governed_resource_id,
        "governed_source_version": governed_source_version,
        "governed_parent_resource_id": governed_parent_resource_id,
        "policy_binding_id": policy_binding_id,
        "policy_version": policy_version,
        "policy_hash": policy_hash,
        "governance_scope_hash": governance_scope_hash,
        "correlation_id": correlation_id,
        "idempotency_key": idempotency_key,
    }
    token = jwt.encode(claims, _secret(settings), algorithm="HS256")
    return token, ConfirmedIngestionAuthorization(
        authorization_id=authorization_id,
        subject_id=subject_id,
        expires_at=expires_at,
    )


def confirm_ingestion_authorization(
    settings: Settings,
    token: str,
    *,
    expected_subject_id: str,
    action: str,
    document_id: str,
    document_version_id: str,
    organization_id: str,
    governed_resource_id: str,
    governed_source_version: str,
    governed_parent_resource_id: str | None,
    policy_binding_id: str,
    policy_version: str,
    policy_hash: str,
    governance_scope_hash: str,
    correlation_id: str,
    idempotency_key: str,
) -> ConfirmedIngestionAuthorization:
    if action not in ALLOWED_ACTIONS:
        raise ValueError("Unsupported ingestion authorization action")
    try:
        claims = jwt.decode(
            token,
            _secret(settings),
            algorithms=["HS256"],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={
                "require": [
                    "iss",
                    "aud",
                    "sub",
                    "iat",
                    "exp",
                    "jti",
                    "action",
                    "document_id",
                    "document_version_id",
                    "organization_id",
                    "governed_resource_id",
                    "governed_source_version",
                    "governed_parent_resource_id",
                    "policy_binding_id",
                    "policy_version",
                    "policy_hash",
                    "governance_scope_hash",
                    "correlation_id",
                    "idempotency_key",
                ]
            },
        )
    except jwt.PyJWTError as exc:
        raise ValueError("The ingestion authorization proof is invalid or expired") from exc

    exact_claims = {
        "sub": expected_subject_id,
        "action": action,
        "document_id": document_id,
        "document_version_id": document_version_id,
        "organization_id": organization_id,
        "governed_resource_id": governed_resource_id,
        "governed_source_version": governed_source_version,
        "governed_parent_resource_id": governed_parent_resource_id,
        "policy_binding_id": policy_binding_id,
        "policy_version": policy_version,
        "policy_hash": policy_hash,
        "governance_scope_hash": governance_scope_hash,
        "correlation_id": correlation_id,
        "idempotency_key": idempotency_key,
    }
    if any(claims.get(key) != value for key, value in exact_claims.items()):
        raise ValueError("The ingestion authorization proof is bound to another request")
    authorization_id = claims.get("jti")
    expires_at_value = claims.get("exp")
    if (
        not isinstance(authorization_id, str)
        or not authorization_id.startswith("iauth_")
        or not isinstance(expires_at_value, int | float)
        or isinstance(expires_at_value, bool)
    ):
        raise ValueError("The ingestion authorization proof contains invalid claims")
    return ConfirmedIngestionAuthorization(
        authorization_id=authorization_id,
        subject_id=expected_subject_id,
        expires_at=datetime.fromtimestamp(float(expires_at_value), tz=timezone.utc),
    )


def _secret(settings: Settings) -> str:
    return settings.ingestion_authorization_signing_secret
