from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import threading
import time
from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings
from app.information_policy import InformationPolicyBinding, canonical_policy_hash, canonical_policy_payload


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


class GovernanceUnavailable(RuntimeError):
    pass


class GovernanceDenied(RuntimeError):
    pass


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
            canonical_policy_payload(binding),
        )
        binding_id = response.get("policyBindingId")
        policy_hash = response.get("policyHash")
        policy_version = response.get("policyVersion")
        if (
            binding_id != binding.policy_binding_id
            or policy_version != binding.policy_version
            or policy_hash != local_hash
        ):
            raise GovernanceUnavailable("STRATOS Policy Registry returned a conflicting binding")
        return local_hash

    def decide(
        self,
        *,
        actor_subject_id: str,
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
                "actorSubjectId": actor_subject_id,
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
        actor_subject_id: str | None,
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
        if actor_subject_id:
            body["actorSubjectId"] = actor_subject_id
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
            or not isinstance(response.get("id"), str)
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

    def _request(self, method: str, url: str, token: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            with httpx.Client(timeout=self.settings.stratos_access_timeout_seconds) as client:
                response = client.request(
                    method,
                    url,
                    headers={
                        "Accept": "application/json",
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
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
        scopes = _scopes(access.get("scopes")) if active else frozenset()
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
        settings.stratos_policy_service_token,
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
