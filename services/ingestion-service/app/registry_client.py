from __future__ import annotations

import asyncio
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
                    f"{self.settings.registry_base_url}/ready",
                    headers=self._headers(registry_service_token=service_token),
                )
            return "ready" if response.status_code == 200 else "not_ready"
        except (IngestionError, httpx.HTTPError):
            return "not_ready"

    async def require_authorized(
        self,
        *,
        subject_id: str,
        action: str,
        auth_context: AuthContext | None = None,
        document_id: str | None = None,
        document_version_id: str | None = None,
        classification: str | None = None,
    ) -> None:
        if self.settings.registry_client_mode == "mock":
            if not self.settings.registry_mock_allow:
                raise IngestionError("AUTHZ_DENIED", "Registry authorization denied ingestion", status_code=403)
            return

        payload = {
            "subject_id": subject_id,
            "action": action,
            "resource": {
                "document_id": document_id,
                "document_version_id": document_version_id,
                "classification": classification,
            },
        }
        if self.settings.auth_mode in {"disabled", "mock"}:
            payload.update(
                {
                    "roles": list(auth_context.roles) if auth_context else [],
                    "groups": list(auth_context.groups) if auth_context else [],
                    "capabilities": list(auth_context.capabilities) if auth_context else [],
                    "scopes": list(auth_context.scopes) if auth_context else [],
                    "organization_id": auth_context.organization_id if auth_context else "org_stratos",
                    "identity_active": auth_context.identity_active if auth_context else True,
                    "membership_active": auth_context.membership_active if auth_context else True,
                    "application_access_active": auth_context.application_access_active if auth_context else True,
                }
            )
        response = await self._post("/api/v1/authz/check", payload, auth_context=auth_context)
        if not response.get("allowed"):
            raise IngestionError(
                "AUTHZ_DENIED",
                "Registry authorization denied ingestion",
                status_code=403,
                details={"reason": response.get("reason", "denied")},
            )

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
        await self._patch(
            f"/api/v1/documents/{document_id}/external-references/current",
            {
                "current_document_version_id": document_version_id,
                "current_ingestion_job_id": ingestion_job_id,
                "current_ingestion_status": ingestion_status,
            },
            auth_context=auth_context,
        )

    async def _get(self, path: str, *, auth_context: AuthContext | None = None) -> dict[str, Any]:
        service_token = await self._registry_service_token()
        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.get(
                    f"{self.settings.registry_base_url}{path}",
                    headers=self._headers(
                        auth_context,
                        registry_service_token=service_token,
                    ),
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            raise IngestionError(
                "REGISTRY_REQUEST_FAILED",
                "Registry API rejected ingestion-service request",
                status_code=502,
                details={"status_code": exc.response.status_code},
            ) from exc
        except httpx.HTTPError as exc:
            raise IngestionError(
                "REGISTRY_UNAVAILABLE",
                "Registry API is unavailable",
                status_code=502,
            ) from exc

    async def _post(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        auth_context: AuthContext | None = None,
    ) -> dict[str, Any]:
        service_token = await self._registry_service_token()
        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.post(
                    f"{self.settings.registry_base_url}{path}",
                    headers=self._headers(
                        auth_context,
                        registry_service_token=service_token,
                    ),
                    json=payload,
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            raise IngestionError(
                "REGISTRY_REQUEST_FAILED",
                "Registry API rejected ingestion-service request",
                status_code=502,
                details={"status_code": exc.response.status_code},
            ) from exc
        except httpx.HTTPError as exc:
            raise IngestionError(
                "REGISTRY_UNAVAILABLE",
                "Registry API is unavailable",
                status_code=502,
            ) from exc

    async def _patch(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        auth_context: AuthContext | None = None,
    ) -> dict[str, Any]:
        service_token = await self._registry_service_token()
        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.patch(
                    f"{self.settings.registry_base_url}{path}",
                    headers=self._headers(
                        auth_context,
                        registry_service_token=service_token,
                    ),
                    json=payload,
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            raise IngestionError(
                "REGISTRY_REQUEST_FAILED",
                "Registry API rejected ingestion-service request",
                status_code=502,
                details={"status_code": exc.response.status_code},
            ) from exc
        except httpx.HTTPError as exc:
            raise IngestionError(
                "REGISTRY_UNAVAILABLE",
                "Registry API is unavailable",
                status_code=502,
            ) from exc

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
            if not math.isfinite(lifetime) or lifetime <= 0:
                raise IngestionError(
                    "REGISTRY_SERVICE_AUTH_INVALID",
                    "Registry service identity response contained an invalid token lifetime",
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
            if auth_context and auth_context.subject_id != headers["X-AKL-Subject"]:
                headers["X-AKL-On-Behalf-Of"] = auth_context.subject_id
        if registry_service_token:
            headers["Authorization"] = f"Bearer {registry_service_token}"
        return headers


def _access_scope_from_document(document: dict[str, Any]) -> list[str]:
    scopes: set[str] = set()
    for policy in document.get("access_policies") or []:
        actions = set(policy.get("actions") or [])
        if not actions.intersection({"document.read", "rag.query", "*"}):
            continue
        scopes.update(str(subject) for subject in policy.get("subjects") or [])
    return sorted(scopes)


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
