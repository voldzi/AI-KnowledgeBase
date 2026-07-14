from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import math
import time
from datetime import date
from typing import Any

import httpx

from app.config import Settings
from app.context import get_correlation_id, get_request_id
from app.errors import IngestionError
from app.schemas import Classification, DocumentMetadata
from app.security import AuthContext


class RegistryClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._service_token_value: str | None = None
        self._service_token_expires_at = 0.0
        self._service_token_lock = asyncio.Lock()

    async def readiness(self) -> str:
        if self.settings.registry_client_mode == "mock":
            return "mock"
        try:
            service_token = await self._registry_service_token()
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.get(
                    f"{self.settings.registry_base_url}/api/v1/integrations/ingestion/readiness",
                    headers=self._headers(registry_service_token=service_token),
                )
            return "ready" if response.status_code == 200 else "not_ready"
        except (IngestionError, httpx.HTTPError):
            return "not_ready"

    async def confirm_ingestion_authorization(
        self,
        *,
        authorization_token: str,
        expected_subject_id: str,
        action: str,
        document_id: str,
        document_version_id: str,
        correlation_id: str,
        idempotency_key: str,
    ) -> tuple[str, str]:
        if self.settings.registry_client_mode == "mock":
            if not self.settings.registry_mock_allow:
                raise IngestionError(
                    "AUTHZ_DENIED",
                    "Registry denied the ingestion authorization proof",
                    status_code=403,
                )
            return expected_subject_id, "iauth_mock_confirmed"

        response = await self._post(
            "/api/v1/integrations/ingestion/authorizations/confirm",
            {
                "authorization_token": authorization_token,
                "expected_subject_id": expected_subject_id,
                "action": action,
                "document_id": document_id,
                "document_version_id": document_version_id,
                "correlation_id": correlation_id,
                "idempotency_key": idempotency_key,
            },
        )
        confirmed_subject_id = response.get("confirmed_subject_id")
        authorization_id = response.get("authorization_id")
        exact = {
            "action": action,
            "document_id": document_id,
            "document_version_id": document_version_id,
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        }
        if (
            confirmed_subject_id != expected_subject_id
            or not isinstance(authorization_id, str)
            or not authorization_id.startswith("iauth_")
            or any(response.get(key) != value for key, value in exact.items())
        ):
            raise IngestionError(
                "REGISTRY_AUTHORIZATION_CONFLICT",
                "Registry returned a conflicting ingestion authorization confirmation",
                status_code=502,
            )
        return confirmed_subject_id, authorization_id

    async def confirm_intelligence_scope_authorization(
        self,
        *,
        authorization_token: str,
        expected_subject_id: str,
        documents: list[dict[str, str]],
        correlation_id: str,
        idempotency_key: str,
    ) -> tuple[str, str]:
        if self.settings.registry_client_mode == "mock":
            if not self.settings.registry_mock_allow:
                raise IngestionError(
                    "AUTHZ_DENIED",
                    "Registry denied the intelligence scope proof",
                    status_code=403,
                )
            return expected_subject_id, "iscope_mock_confirmed"
        normalized = sorted(documents, key=lambda item: item.get("document_id", ""))
        if (
            not normalized
            or len({item.get("document_id") for item in normalized}) != len(normalized)
        ):
            raise IngestionError(
                "INTELLIGENCE_SCOPE_INVALID",
                "The intelligence document scope must be non-empty and unique",
                status_code=403,
            )
        response = await self._post(
            "/api/v1/integrations/ingestion/intelligence-authorizations/confirm",
            {
                "authorization_token": authorization_token,
                "expected_subject_id": expected_subject_id,
                "documents": normalized,
                "correlation_id": correlation_id,
                "idempotency_key": idempotency_key,
            },
        )
        authorization_id = response.get("authorization_id")
        expected_scope_hash = _document_scope_hash(normalized)
        if (
            response.get("confirmed_subject_id") != expected_subject_id
            or response.get("action") != "intelligence.query"
            or response.get("document_scope_hash") != expected_scope_hash
            or response.get("document_count") != len(normalized)
            or response.get("correlation_id") != correlation_id
            or response.get("idempotency_key") != idempotency_key
            or not isinstance(authorization_id, str)
            or not authorization_id.startswith("iscope_")
        ):
            raise IngestionError(
                "REGISTRY_INTELLIGENCE_AUTHORIZATION_CONFLICT",
                "Registry returned a conflicting intelligence scope confirmation",
                status_code=502,
            )
        return expected_subject_id, authorization_id

    async def get_document_metadata(
        self,
        document_id: str,
        document_version_id: str,
        *,
        auth_context: AuthContext | None = None,
    ) -> DocumentMetadata:
        if self.settings.registry_client_mode == "mock":
            return DocumentMetadata(
                document_id=document_id,
                document_version_id=document_version_id,
                title=f"Mock document {document_id}",
                version_label="mock",
                document_type="directive",
                status="valid",
                tags=["mock"],
                classification=Classification(self.settings.registry_mock_classification),
                access_scope=list(self.settings.registry_mock_access_scope),
                source_file_uri=None,
                file_hash=None,
            )

        document = await self._get(f"/api/v1/documents/{document_id}", auth_context=auth_context)
        version = await self._get(
            f"/api/v1/documents/{document_id}/versions/{document_version_id}",
            auth_context=auth_context,
        )
        external = _external_metadata(document)
        return DocumentMetadata(
            document_id=document_id,
            document_version_id=document_version_id,
            title=_optional_str(document.get("title")),
            version_label=_optional_str(version.get("version_label")),
            document_type=_optional_str(document.get("document_type")),
            status=_optional_str(version.get("status")) or _optional_str(document.get("status")) or "valid",
            tags=_str_list(document.get("tags")),
            classification=Classification(document.get("classification", "internal")),
            valid_from=_optional_date(version.get("valid_from")),
            valid_to=_optional_date(version.get("valid_to")),
            access_scope=_access_scope_from_document(document),
            tenant_id=_optional_str(external.get("tenant_id")),
            external_system=_optional_str(external.get("external_system")),
            external_ref=_optional_str(external.get("external_ref")),
            organization_id=_optional_str(version.get("organization_id")) or "org_stratos",
            policy_binding_id=_optional_str(version.get("policy_binding_id")),
            policy_version=_optional_str(version.get("policy_version")),
            policy_hash=_optional_str(version.get("policy_hash")),
            policy_summary=(
                version.get("policy_summary")
                if isinstance(version.get("policy_summary"), dict)
                else {}
            ),
            source_file_uri=_optional_str(version.get("source_file_uri")),
            file_hash=_optional_str(version.get("file_hash")),
        )

    async def write_audit_event(
        self,
        *,
        actor_id: str,
        event_type: str,
        resource_id: str,
        severity: str = "info",
        metadata: dict[str, Any] | None = None,
        auth_context: AuthContext | None = None,
    ) -> None:
        if self.settings.registry_client_mode == "mock":
            return

        payload = {
            "actor_id": actor_id,
            "event_type": event_type,
            "resource_type": "ingestion_job",
            "resource_id": resource_id,
            "severity": severity,
            "correlation_id": get_correlation_id(),
            "metadata": metadata or {},
        }
        await self._post(
            "/api/v1/audit/events",
            payload,
            auth_context=auth_context,
        )

    async def update_external_document_current(
        self,
        *,
        document_id: str,
        document_version_id: str,
        ingestion_job_id: str,
        ingestion_status: str,
        auth_context: AuthContext | None = None,
    ) -> None:
        if self.settings.registry_client_mode == "mock":
            return
        response = await self._patch(
            f"/api/v1/documents/{document_id}/external-references/current",
            {
                "current_document_version_id": document_version_id,
                "expected_current_ingestion_job_id": ingestion_job_id,
                "current_ingestion_job_id": ingestion_job_id,
                "current_ingestion_status": ingestion_status,
            },
            auth_context=auth_context,
        )
        _require_authoritative_attempt(
            response,
            document_id=document_id,
            document_version_id=document_version_id,
            ingestion_job_id=ingestion_job_id,
            ingestion_status=ingestion_status,
        )

    async def claim_external_document_attempt(
        self,
        *,
        document_id: str,
        document_version_id: str,
        expected_ingestion_job_id: str | None,
        ingestion_job_id: str,
        auth_context: AuthContext | None = None,
    ) -> None:
        if self.settings.registry_client_mode == "mock":
            return
        response = await self._patch(
            f"/api/v1/documents/{document_id}/external-references/current",
            {
                "current_document_version_id": document_version_id,
                "expected_current_ingestion_job_id": expected_ingestion_job_id,
                "current_ingestion_job_id": ingestion_job_id,
                "current_ingestion_status": "QUEUED",
            },
            auth_context=auth_context,
        )
        _require_authoritative_attempt(
            response,
            document_id=document_id,
            document_version_id=document_version_id,
            ingestion_job_id=ingestion_job_id,
            ingestion_status="QUEUED",
        )

    async def is_authoritative_attempt_selected(
        self,
        *,
        document_id: str,
        document_version_id: str,
        ingestion_job_id: str,
    ) -> bool:
        if self.settings.registry_client_mode == "mock":
            return True
        response = await self._get(
            f"/api/v1/documents/{document_id}/external-references/current"
        )
        attempt = response.get("ingestion_attempt")
        return bool(
            isinstance(attempt, dict)
            and attempt.get("document_id") == document_id
            and attempt.get("document_version_id") == document_version_id
            and attempt.get("ingestion_job_id") == ingestion_job_id
            and attempt.get("ingestion_status") == "QUEUED"
        )

    async def _get(self, path: str, *, auth_context: AuthContext | None = None) -> dict[str, Any]:
        return await self._request("GET", path, auth_context=auth_context)

    async def _post(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        auth_context: AuthContext | None = None,
    ) -> dict[str, Any]:
        return await self._request("POST", path, payload=payload, auth_context=auth_context)

    async def _patch(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        auth_context: AuthContext | None = None,
    ) -> dict[str, Any]:
        return await self._request("PATCH", path, payload=payload, auth_context=auth_context)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        auth_context: AuthContext | None = None,
    ) -> dict[str, Any]:
        for attempt in range(2):
            service_token = await self._registry_service_token()
            try:
                async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                    response = await client.request(
                        method,
                        f"{self.settings.registry_base_url}{path}",
                        headers=self._headers(
                            auth_context,
                            registry_service_token=service_token,
                        ),
                        json=payload,
                    )
                if response.status_code == 401 and service_token and attempt == 0:
                    await self._invalidate_service_token(service_token)
                    continue
                response.raise_for_status()
                body = response.json()
                return body if isinstance(body, dict) else {}
            except httpx.HTTPStatusError as exc:
                upstream_status = exc.response.status_code
                raise IngestionError(
                    "REGISTRY_CONFLICT" if upstream_status == 409 else "REGISTRY_REQUEST_FAILED",
                    "Registry API rejected ingestion-service request",
                    status_code=upstream_status if upstream_status in {401, 403, 404, 409, 503} else 502,
                    details={"status_code": upstream_status},
                ) from exc
            except httpx.HTTPError as exc:
                raise IngestionError(
                    "REGISTRY_UNAVAILABLE",
                    "Registry API is unavailable",
                    status_code=502,
                ) from exc
        raise IngestionError(
            "REGISTRY_REQUEST_FAILED",
            "Registry API rejected the refreshed service identity",
            status_code=401,
        )

    async def _invalidate_service_token(self, rejected_token: str) -> None:
        async with self._service_token_lock:
            if self._service_token_value == rejected_token:
                self._service_token_value = None
                self._service_token_expires_at = 0.0

    async def _registry_service_token(self) -> str | None:
        settings = self.settings
        if not (
            settings.registry_service_token_url
            and settings.registry_service_client_id
            and settings.registry_service_client_secret
        ):
            return None

        now = time.monotonic()
        if self._service_token_value and now < self._service_token_expires_at:
            return self._service_token_value

        async with self._service_token_lock:
            now = time.monotonic()
            if self._service_token_value and now < self._service_token_expires_at:
                return self._service_token_value
            try:
                async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                    response = await client.post(
                        settings.registry_service_token_url,
                        data={
                            "grant_type": "client_credentials",
                            "client_id": settings.registry_service_client_id,
                            "client_secret": settings.registry_service_client_secret,
                        },
                    )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise IngestionError(
                    "REGISTRY_SERVICE_AUTH_UNAVAILABLE",
                    "Ingestion service identity could not be obtained",
                    status_code=503,
                ) from exc

            if not isinstance(payload, dict):
                raise IngestionError(
                    "REGISTRY_SERVICE_AUTH_INVALID",
                    "Registry service identity response was invalid",
                    status_code=503,
                )
            access_token = payload.get("access_token")
            if not isinstance(access_token, str) or not access_token:
                raise IngestionError(
                    "REGISTRY_SERVICE_AUTH_INVALID",
                    "Registry service identity response did not contain an access token",
                    status_code=503,
                )
            expires_in = payload.get("expires_in")
            lifetime = (
                float(expires_in)
                if isinstance(expires_in, int | float) and not isinstance(expires_in, bool)
                else 60.0
            )
            if not math.isfinite(lifetime) or lifetime <= 0 or lifetime > 86_400:
                raise IngestionError(
                    "REGISTRY_SERVICE_AUTH_INVALID",
                    "Registry service identity response contained an invalid token lifetime",
                    status_code=503,
                )
            jwt_remaining = _jwt_remaining_seconds(access_token)
            if jwt_remaining is not None:
                lifetime = min(lifetime, jwt_remaining)
            if lifetime <= 0:
                raise IngestionError(
                    "REGISTRY_SERVICE_AUTH_INVALID",
                    "Registry service identity response contained an expired token",
                    status_code=503,
                )
            refresh_margin = min(30.0, max(1.0, lifetime * 0.1))
            self._service_token_value = access_token
            self._service_token_expires_at = now + max(0.0, lifetime - refresh_margin)
            return access_token

    def _headers(
        self,
        auth_context: AuthContext | None = None,
        *,
        registry_service_token: str | None = None,
    ) -> dict[str, str]:
        headers = {
            "X-Request-ID": get_request_id(),
            "X-Correlation-ID": get_correlation_id(),
            "X-Service-Name": self.settings.service_name,
        }
        if self.settings.auth_mode in {"disabled", "mock"}:
            service_client_id = (
                self.settings.registry_service_client_id
                or self.settings.service_account_subject
            )
            headers["X-AKL-Subject"] = f"service-account-{service_client_id}"
            headers["X-AKL-Service-Client-ID"] = service_client_id
            headers["X-AKL-Roles"] = ",".join(self.settings.service_account_roles)
        if registry_service_token:
            headers["Authorization"] = f"Bearer {registry_service_token}"
        return headers


def _jwt_remaining_seconds(token: str) -> float | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        encoded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
        expires_at = payload.get("exp") if isinstance(payload, dict) else None
        if not isinstance(expires_at, int | float) or isinstance(expires_at, bool):
            raise ValueError("JWT exp is missing")
        remaining = float(expires_at) - time.time()
        if not math.isfinite(remaining):
            raise ValueError("JWT exp is invalid")
        return remaining
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise IngestionError(
            "REGISTRY_SERVICE_AUTH_INVALID",
            "Registry service identity response contained an invalid JWT lifetime",
            status_code=503,
        ) from exc


def _document_scope_hash(documents: list[dict[str, str]]) -> str:
    payload = json.dumps(
        sorted(documents, key=lambda item: item["document_id"]),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _access_scope_from_document(document: dict[str, Any]) -> list[str]:
    scopes: set[str] = set()
    for policy in document.get("access_policies") or []:
        actions = set(policy.get("actions") or [])
        if not actions.intersection({"document.read", "rag.query", "*"}):
            continue
        scopes.update(str(subject) for subject in policy.get("subjects") or [])
    return sorted(scopes)


def _require_authoritative_attempt(
    response: dict[str, Any],
    *,
    document_id: str,
    document_version_id: str,
    ingestion_job_id: str,
    ingestion_status: str,
) -> None:
    attempt = response.get("ingestion_attempt")
    expected = {
        "document_id": document_id,
        "document_version_id": document_version_id,
        "ingestion_job_id": ingestion_job_id,
        "ingestion_status": ingestion_status,
    }
    if not isinstance(attempt, dict) or any(attempt.get(key) != value for key, value in expected.items()):
        raise IngestionError(
            "REGISTRY_ATTEMPT_CONFIRMATION_CONFLICT",
            "Registry did not confirm the exact authoritative ingestion attempt",
            status_code=502,
        )


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _external_metadata(document: dict[str, Any]) -> dict[str, Any]:
    metadata = document.get("metadata")
    if not isinstance(metadata, dict):
        return {}
    external = metadata.get("external")
    return external if isinstance(external, dict) else {}


def _optional_date(value: Any) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    return date.fromisoformat(value)


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item is not None]
