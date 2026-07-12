from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import threading
import time
from typing import Any

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
        policy_binding: dict[str, Any] | None,
        policy_hash: str | None,
    ) -> dict[str, Any]:
        url = self.settings.stratos_policy_decisions_url
        token = self.settings.stratos_policy_service_token
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
                "scope": {"type": "organization", "id": "org_stratos"},
                "policyBinding": policy_binding,
                "policyHash": policy_hash,
            },
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
