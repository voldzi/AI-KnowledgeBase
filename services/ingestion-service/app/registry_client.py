from __future__ import annotations

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

    async def readiness(self) -> str:
        if self.settings.registry_client_mode == "mock":
            return "mock"
        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.get(
                    f"{self.settings.registry_base_url}/ready",
                    headers=self._headers(),
                )
            return "ready" if response.status_code == 200 else "not_ready"
        except httpx.HTTPError:
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
            "roles": list(auth_context.roles) if auth_context else [],
            "groups": list(auth_context.groups) if auth_context else [],
        }
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
            prefer_service_account=True,
        )

    async def _get(self, path: str, *, auth_context: AuthContext | None = None) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.get(
                    f"{self.settings.registry_base_url}{path}",
                    headers=self._headers(auth_context),
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
        prefer_service_account: bool = False,
    ) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.post(
                    f"{self.settings.registry_base_url}{path}",
                    headers=self._headers(auth_context, prefer_service_account=prefer_service_account),
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

    def _headers(
        self,
        auth_context: AuthContext | None = None,
        *,
        prefer_service_account: bool = False,
    ) -> dict[str, str]:
        use_service_account = prefer_service_account and self.settings.service_account_token
        subject_id = (
            self.settings.service_account_subject
            if use_service_account or auth_context is None
            else auth_context.subject_id
        )
        roles = (
            self.settings.service_account_roles
            if use_service_account or auth_context is None
            else auth_context.roles
        )
        groups = () if use_service_account or auth_context is None else auth_context.groups
        headers = {
            "X-Request-ID": get_request_id(),
            "X-Correlation-ID": get_correlation_id(),
            "X-Service-Name": self.settings.service_name,
            "X-AKL-Subject": subject_id,
            "X-AKL-Roles": ",".join(roles),
        }
        if groups:
            headers["X-AKL-Groups"] = ",".join(groups)
        bearer_token = None if use_service_account else auth_context.bearer_token if auth_context else None
        if bearer_token:
            headers["Authorization"] = f"Bearer {bearer_token}"
        elif self.settings.service_account_token:
            headers["Authorization"] = f"Bearer {self.settings.service_account_token}"
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


def _optional_date(value: Any) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    return date.fromisoformat(value)


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item is not None]
