from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import threading
import time
from typing import Any, Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.config import Settings
from app.information_policy import (
    InformationPolicyBinding,
    IntegrationEnvelope,
    canonical_policy_hash,
    canonical_policy_payload,
)


@dataclass(frozen=True)
class AccessProjection:
    capabilities: frozenset[str]
    scopes: frozenset[str]
    organization_id: str
    identity_active: bool
    membership_active: bool
    application_access_active: bool


@dataclass(frozen=True)
class GovernedResourceRegistration:
    resource_id: str
    source_version: str
    policy_binding_id: str
    policy_hash: str


@dataclass(frozen=True)
class AiipAkbGovernedResourceRegistration:
    governed_resource_id: str
    resource_type: Literal["document", "document-version"]
    resource_id: str
    source_version: str
    parent_id: str
    scope: dict[str, str]
    inherited_from_resource_id: str
    policy_binding_id: str
    policy_version: str
    policy_hash: str
    registered_by_subject_id: str
    confirmed_by_subject_id: str
    correlation_id: str
    idempotency_key: str


@dataclass(frozen=True)
class InformationPublicationRegistration:
    publication_id: str
    governed_resource_id: str
    resource_type: str
    resource_id: str
    source_version: str
    public_slug: str
    policy_binding_id: str
    policy_hash: str
    status: str
    published_at: str | None
    revoked_at: str | None


class CentralPublicDecisionPublication(BaseModel):
    model_config = ConfigDict(extra="forbid")

    publication_id: str = Field(alias="id", min_length=1)
    application: Literal["AKB"]
    resource_type: str = Field(alias="resourceType", min_length=1)
    resource_id: str = Field(alias="resourceId", min_length=1)
    source_version: str = Field(alias="sourceVersion", min_length=1)
    public_slug: str = Field(alias="publicSlug", min_length=1)
    policy_binding_id: str = Field(alias="policyBindingId", min_length=1)
    policy_hash: str = Field(alias="policyHash", pattern=r"^sha256:[a-f0-9]{64}$")
    published_at: datetime = Field(alias="publishedAt")


class CentralPublicDecisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["ALLOW", "DENY"]
    reason_codes: list[str] = Field(alias="reasonCodes")
    obligations: list[str]
    policy_version: str = Field(alias="policyVersion", min_length=1)
    decision_id: str = Field(alias="decisionId", min_length=1)
    publication: CentralPublicDecisionPublication | None


class GovernanceUnavailable(RuntimeError):
    pass


class GovernanceInvalidResponse(GovernanceUnavailable):
    pass


class GovernanceDenied(RuntimeError):
    pass


def validate_public_decision_response(value: Any) -> dict[str, Any]:
    try:
        decision = CentralPublicDecisionResponse.model_validate(value)
    except ValidationError as exc:
        raise GovernanceInvalidResponse(
            "STRATOS public access governance returned an invalid response"
        ) from exc
    if (decision.decision == "ALLOW") != (decision.publication is not None):
        raise GovernanceInvalidResponse(
            "STRATOS public access governance returned an invalid response"
        )
    return decision.model_dump(mode="json", by_alias=True)


class StratosGovernanceClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._cache: dict[str, tuple[float, AccessProjection]] = {}
        self._lock = threading.Lock()

    def user_projection(self, token: str, *, token_expires_at: float | None) -> AccessProjection:
        if not self.settings.stratos_auth_me_url:
            raise GovernanceUnavailable("STRATOS access projection is not configured")
        cache_key = sha256(token.encode("utf-8")).hexdigest()
        now = time.time()
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached and cached[0] > now:
                return cached[1]
        try:
            with httpx.Client(timeout=self.settings.stratos_access_timeout_seconds) as client:
                response = client.get(
                    self.settings.stratos_auth_me_url,
                    headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
                )
        except httpx.HTTPError as exc:
            raise GovernanceUnavailable("STRATOS access projection is unavailable") from exc
        if response.status_code in {401, 403}:
            raise GovernanceDenied("STRATOS rejected the bearer identity")
        if response.status_code != 200:
            raise GovernanceUnavailable(
                f"STRATOS access projection returned {response.status_code}"
            )
        try:
            body = response.json()
            projection = self._parse_projection(body)
        except (ValueError, TypeError) as exc:
            raise GovernanceUnavailable("STRATOS access projection is malformed") from exc

        ttl = self.settings.stratos_access_cache_ttl_seconds
        expires_at = min(now + ttl, token_expires_at or now + ttl)
        if ttl > 0 and expires_at > now:
            with self._lock:
                self._cache[cache_key] = (expires_at, projection)
        return projection

    def ensure_binding_registered(self, binding: InformationPolicyBinding) -> str:
        local_hash = canonical_policy_hash(binding)
        if self.settings.auth_mode == "mock":
            return local_hash
        url = self.settings.stratos_policy_bindings_url
        token = self.settings.stratos_policy_service_token
        if not url or not token:
            raise GovernanceUnavailable("STRATOS Policy Registry is not configured")
        response = self._request(
            "POST",
            url,
            token,
            {"applicationId": "akb", **canonical_policy_payload(binding)},
        )
        expected = {
            "schemaVersion": "stratos-information-policy-2",
            "organizationId": "org_stratos",
            "applicationId": "akb",
            **canonical_policy_payload(binding),
            "policyHash": local_hash,
        }
        if any(response.get(key) != value for key, value in expected.items()):
            raise GovernanceUnavailable("STRATOS Policy Registry returned a conflicting binding")
        return local_hash

    def decide(
        self,
        *,
        capability_id: str,
        operation: str,
        scope: dict[str, str],
        policy_binding: dict[str, Any] | None,
        policy_hash: str | None,
        credential_token: str | None = None,
    ) -> dict[str, Any]:
        url = self.settings.stratos_policy_decisions_url
        token = credential_token or self.settings.stratos_policy_service_token
        if not url or not token:
            raise GovernanceUnavailable("STRATOS policy decision endpoint is not configured")
        return self._request(
            "POST",
            url,
            token,
            {
                "applicationId": "akb",
                "capabilityId": capability_id,
                "operation": operation,
                "scope": scope,
                "policyBinding": policy_binding,
                "policyHash": policy_hash,
            },
        )

    def register_information_resource(
        self,
        *,
        credential_token: str,
        audit_actor_subject_id: str | None,
        resource_type: str,
        resource_id: str,
        source_version: str,
        title: str,
        scope: dict[str, str],
        binding: InformationPolicyBinding,
        parent_resource_id: str | None,
        reason: str,
        metadata: dict[str, Any] | None = None,
    ) -> GovernedResourceRegistration:
        base_url = self.settings.stratos_information_resources_url
        if not base_url:
            raise GovernanceUnavailable("STRATOS governed information resource endpoint is not configured")
        body: dict[str, Any] = {
            "sourceVersion": source_version,
            "title": title,
            "scope": scope,
            "policyBindingId": binding.policy_binding_id,
            "policyHash": canonical_policy_hash(binding),
            "reason": reason,
            "metadata": metadata or {},
        }
        if parent_resource_id:
            body["parentId"] = parent_resource_id
        if audit_actor_subject_id:
            body["metadata"] = {**body["metadata"], "auditActorSubjectId": audit_actor_subject_id}
        response = self._request(
            "PUT",
            (
                f"{base_url.rstrip('/')}/akb/"
                f"{quote(resource_type, safe='')}/{quote(resource_id, safe='')}"
            ),
            credential_token,
            body,
        )
        effective_policy = response.get("effectivePolicy")
        expected_hash = canonical_policy_hash(binding)
        if (
            response.get("application") != "AKB"
            or response.get("resourceType") != resource_type
            or response.get("resourceId") != resource_id
            or response.get("sourceVersion") != source_version
            or response.get("parentId") != parent_resource_id
            or response.get("scope") != scope
            or not isinstance(response.get("id"), str)
            or response.get("policyAssignment") != "EXPLICIT"
            or response.get("explicitPolicyBindingId") != binding.policy_binding_id
            or not isinstance(response.get("confirmedBySubjectId"), str)
            or not response.get("confirmedBySubjectId")
            or not isinstance(effective_policy, dict)
            or effective_policy.get("policyBindingId") != binding.policy_binding_id
            or effective_policy.get("policyHash") != expected_hash
        ):
            raise GovernanceUnavailable("STRATOS returned a conflicting governed resource")
        return GovernedResourceRegistration(
            resource_id=response["id"],
            source_version=source_version,
            policy_binding_id=binding.policy_binding_id,
            policy_hash=expected_hash,
        )

    def register_aiip_akb_resource(
        self,
        *,
        actor_token: str,
        resource_type: Literal["document", "document-version"],
        resource_id: str,
        source_version: str,
        title: str,
        parent_id: str,
        scope: dict[str, str],
        envelope: IntegrationEnvelope,
        binding: InformationPolicyBinding,
        reason: str,
    ) -> AiipAkbGovernedResourceRegistration:
        base_url = self.settings.stratos_aiip_akb_resources_url
        credential = self.settings.stratos_aiip_ingest_service_token
        if not base_url or not credential:
            raise GovernanceUnavailable("The dedicated AIIP to AKB governance route is not configured")
        source = envelope.source_resource
        expected_source_id = source.governed_resource_id
        expected_hash = canonical_policy_hash(binding)
        response = self._request(
            "PUT",
            (
                f"{base_url.rstrip('/')}/{quote(resource_type, safe='')}/"
                f"{quote(resource_id, safe='')}"
            ),
            credential,
            {
                "sourceVersion": source_version,
                "title": title,
                "parentId": parent_id,
                "scope": scope,
                "integrationEnvelope": envelope.model_dump(
                    mode="json", by_alias=True, exclude_none=True
                ),
                "reason": reason,
            },
            extra_headers={
                "X-AIIP-Actor-Authorization": f"Bearer {actor_token}",
                "Idempotency-Key": envelope.idempotency_key,
                "X-Correlation-ID": envelope.correlation_id,
            },
        )
        effective_policy = response.get("effectivePolicy")
        registered_by = response.get("registeredBySubjectId")
        confirmed_by = response.get("confirmedBySubjectId")
        if (
            response.get("application") != "AKB"
            or response.get("resourceType") != resource_type
            or response.get("resourceId") != resource_id
            or response.get("sourceVersion") != source_version
            or response.get("parentId") != parent_id
            or response.get("scope") != scope
            or response.get("isActive") is not True
            or not isinstance(response.get("id"), str)
            or not response.get("id")
            or response.get("policyAssignment") != "INHERITED"
            or response.get("explicitPolicyBindingId") is not None
            or response.get("inheritedFromResourceId") != expected_source_id
            or not isinstance(effective_policy, dict)
            or effective_policy.get("policyBindingId") != binding.policy_binding_id
            or effective_policy.get("policyVersion") != binding.policy_version
            or effective_policy.get("policyHash") != expected_hash
            or not isinstance(registered_by, str)
            or not registered_by
            or confirmed_by != envelope.actor.subject_id
            or response.get("correlation_id") != envelope.correlation_id
            or response.get("idempotency_key") != envelope.idempotency_key
        ):
            raise GovernanceInvalidResponse(
                "STRATOS returned a conflicting AIIP-derived AKB governed resource"
            )
        return AiipAkbGovernedResourceRegistration(
            governed_resource_id=response["id"],
            resource_type=resource_type,
            resource_id=resource_id,
            source_version=source_version,
            parent_id=parent_id,
            scope=scope,
            inherited_from_resource_id=expected_source_id,
            policy_binding_id=binding.policy_binding_id,
            policy_version=binding.policy_version,
            policy_hash=expected_hash,
            registered_by_subject_id=registered_by,
            confirmed_by_subject_id=confirmed_by,
            correlation_id=envelope.correlation_id,
            idempotency_key=envelope.idempotency_key,
        )

    def upsert_information_publication(
        self,
        *,
        credential_token: str,
        resource_type: str,
        resource_id: str,
        source_version: str,
        scope: dict[str, str],
        policy_binding_id: str,
        policy_hash: str,
        public_slug: str,
        status: str,
        reason: str,
    ) -> InformationPublicationRegistration:
        base_url = self.settings.stratos_information_publications_url
        if not base_url:
            raise GovernanceUnavailable("STRATOS information publication endpoint is not configured")
        body: dict[str, Any] = {
            "sourceVersion": source_version,
            "status": status,
            "reason": reason,
        }
        if status != "REVOKED":
            body.update(
                {
                    "scope": scope,
                    "policyBindingId": policy_binding_id,
                    "policyHash": policy_hash,
                    "publicSlug": public_slug,
                }
            )
        response = self._request(
            "PUT",
            (
                f"{base_url.rstrip('/')}/akb/"
                f"{quote(resource_type, safe='')}/{quote(resource_id, safe='')}"
            ),
            credential_token,
            body,
        )
        expected_status = status
        if (
            not isinstance(response.get("id"), str)
            or response.get("application") != "AKB"
            or response.get("resourceType") != resource_type
            or response.get("resourceId") != resource_id
            or response.get("sourceVersion") != source_version
            or not isinstance(response.get("governedResourceId"), str)
            or response.get("policyBindingId") != policy_binding_id
            or response.get("policyHash") != policy_hash
            or response.get("publicSlug") != public_slug
            or response.get("status") != expected_status
            or (status == "PUBLISHED" and not isinstance(response.get("publishedAt"), str))
            or (status == "REVOKED" and not _is_timestamp(response.get("revokedAt")))
        ):
            raise GovernanceUnavailable("STRATOS returned a conflicting information publication")
        return InformationPublicationRegistration(
            publication_id=response["id"],
            governed_resource_id=response["governedResourceId"],
            resource_type=resource_type,
            resource_id=resource_id,
            source_version=source_version,
            public_slug=public_slug,
            policy_binding_id=policy_binding_id,
            policy_hash=policy_hash,
            status=expected_status,
            published_at=response.get("publishedAt"),
            revoked_at=response.get("revokedAt"),
        )

    def public_decide(self, *, public_slug: str, operation: str) -> dict[str, Any]:
        url = self.settings.stratos_public_decisions_url
        if not url:
            raise GovernanceUnavailable("STRATOS public policy decision endpoint is not configured")
        return validate_public_decision_response(
            self._anonymous_request(
                "POST",
                url,
                {"publicSlug": public_slug, "operation": operation},
            )
        )

    def _request(
        self,
        method: str,
        url: str,
        token: str,
        body: dict[str, Any],
        *,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            **(extra_headers or {}),
        }
        headers["Authorization"] = f"Bearer {token}"
        try:
            with httpx.Client(timeout=self.settings.stratos_access_timeout_seconds) as client:
                response = client.request(
                    method,
                    url,
                    headers=headers,
                    json=body,
                )
        except httpx.HTTPError as exc:
            raise GovernanceUnavailable("STRATOS access governance is unavailable") from exc
        if response.status_code in {401, 403}:
            raise GovernanceDenied("STRATOS access governance rejected the runtime credential")
        if response.status_code >= 400:
            raise GovernanceUnavailable(
                f"STRATOS access governance returned {response.status_code}"
            )
        try:
            value = response.json()
        except ValueError as exc:
            raise GovernanceUnavailable("STRATOS access governance returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise GovernanceUnavailable("STRATOS access governance returned an invalid response")
        return value

    def _anonymous_request(self, method: str, url: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            with httpx.Client(timeout=self.settings.stratos_access_timeout_seconds) as client:
                response = client.request(
                    method,
                    url,
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                    json=body,
                )
        except httpx.HTTPError as exc:
            raise GovernanceUnavailable("STRATOS public access governance is unavailable") from exc
        if response.status_code >= 400:
            raise GovernanceUnavailable(
                f"STRATOS public access governance returned {response.status_code}"
            )
        try:
            value = response.json()
        except ValueError as exc:
            raise GovernanceUnavailable("STRATOS public access governance returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise GovernanceUnavailable("STRATOS public access governance returned an invalid response")
        return value

    @staticmethod
    def _parse_projection(body: Any) -> AccessProjection:
        if not isinstance(body, dict) or body.get("tenantId") != "org_stratos":
            raise ValueError("organization mismatch")
        accesses = body.get("applicationAccess")
        if not isinstance(accesses, list):
            raise ValueError("applicationAccess missing")
        access = next(
            (
                item
                for item in accesses
                if isinstance(item, dict)
                and str(item.get("application") or "").lower().replace("_", "-") == "akb"
            ),
            None,
        )
        active = access is not None and _not_expired(access.get("validUntil"))
        capabilities = _strings(access.get("capabilities")) if active else frozenset()
        # The explicit grants are an administrative input.  Runtime access is
        # based only on the active/connected closure calculated by STRATOS.
        scopes = _scopes(access.get("effectiveScopes")) if active else frozenset()
        return AccessProjection(
            capabilities=capabilities,
            scopes=scopes,
            organization_id="org_stratos",
            identity_active=True,
            membership_active=True,
            application_access_active=active,
        )


_CLIENT_LOCK = threading.Lock()
_CLIENTS: dict[tuple[object, ...], StratosGovernanceClient] = {}


def governance_client(settings: Settings) -> StratosGovernanceClient:
    key = (
        settings.stratos_auth_me_url,
        settings.stratos_policy_bindings_url,
        settings.stratos_policy_decisions_url,
        settings.stratos_information_resources_url,
        settings.stratos_aiip_akb_resources_url,
        settings.stratos_information_publications_url,
        settings.stratos_public_decisions_url,
        settings.stratos_policy_service_token,
        settings.stratos_aiip_ingest_service_token,
        settings.stratos_access_timeout_seconds,
        settings.stratos_access_cache_ttl_seconds,
        settings.auth_mode,
    )
    with _CLIENT_LOCK:
        return _CLIENTS.setdefault(key, StratosGovernanceClient(settings))


def reset_governance_clients_for_tests() -> None:
    with _CLIENT_LOCK:
        _CLIENTS.clear()


def _strings(value: Any) -> frozenset[str]:
    if not isinstance(value, list):
        return frozenset()
    return frozenset(item for item in value if isinstance(item, str) and item)


def _scopes(value: Any) -> frozenset[str]:
    if not isinstance(value, list):
        return frozenset()
    result: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("type"), str):
            continue
        scope_id = item.get("id")
        result.add(f"{item['type']}:{scope_id}" if isinstance(scope_id, str) and scope_id else item["type"])
    return frozenset(result)


def _not_expired(value: Any) -> bool:
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed > datetime.now(timezone.utc)


def _is_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None
