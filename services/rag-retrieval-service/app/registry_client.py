from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.config import Settings
from app.context import get_correlation_id
from app.http_utils import request_json_with_retry
from app.security import AuthContext


@dataclass(frozen=True)
class AuthzFilterResult:
    allowed_document_ids: set[str]
    denied_document_ids: set[str]


class RegistryClient(Protocol):
    async def filter_allowed_documents(
        self,
        *,
        subject_id: str,
        candidate_document_ids: list[str],
        auth_context: AuthContext | None = None,
    ) -> AuthzFilterResult:
        ...

    async def write_audit_event(
        self,
        *,
        actor_id: str,
        event_type: str,
        resource_id: str,
        metadata: dict[str, object],
        resource_type: str = "rag_query",
        auth_context: AuthContext | None = None,
    ) -> None:
        ...

    async def readiness(self) -> str:
        ...


class MockRegistryClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def filter_allowed_documents(
        self,
        *,
        subject_id: str,
        candidate_document_ids: list[str],
        auth_context: AuthContext | None = None,
    ) -> AuthzFilterResult:
        denied = {
            document_id
            for document_id in candidate_document_ids
            if document_id in self._settings.mock_registry_denied_document_ids
        }
        allowed = set(candidate_document_ids) - denied
        return AuthzFilterResult(allowed_document_ids=allowed, denied_document_ids=denied)

    async def write_audit_event(
        self,
        *,
        actor_id: str,
        event_type: str,
        resource_id: str,
        metadata: dict[str, object],
        resource_type: str = "rag_query",
        auth_context: AuthContext | None = None,
    ) -> None:
        return None

    async def readiness(self) -> str:
        return "ready"


class HttpRegistryClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def filter_allowed_documents(
        self,
        *,
        subject_id: str,
        candidate_document_ids: list[str],
        auth_context: AuthContext | None = None,
    ) -> AuthzFilterResult:
        if not candidate_document_ids:
            return AuthzFilterResult(allowed_document_ids=set(), denied_document_ids=set())

        body = {
            "subject_id": subject_id,
            "action": "rag.query",
            "candidate_document_ids": candidate_document_ids,
            "roles": list(auth_context.roles) if auth_context else [],
            "groups": list(auth_context.groups) if auth_context else [],
        }
        payload = await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/authz/filter-documents",
            json_body=body,
            auth_context=auth_context,
        )
        return AuthzFilterResult(
            allowed_document_ids=set(payload.get("allowed_document_ids", [])),
            denied_document_ids=set(payload.get("denied_document_ids", [])),
        )

    async def write_audit_event(
        self,
        *,
        actor_id: str,
        event_type: str,
        resource_id: str,
        metadata: dict[str, object],
        resource_type: str = "rag_query",
        auth_context: AuthContext | None = None,
    ) -> None:
        body = {
            "actor_id": actor_id,
            "event_type": event_type,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "severity": "info",
            "correlation_id": get_correlation_id(),
            "metadata": {"service": self._settings.service_name, **metadata},
        }
        await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/audit/events",
            json_body=body,
            auth_context=auth_context,
            prefer_upstream_token=True,
        )

    async def readiness(self) -> str:
        try:
            await request_json_with_retry(
                dependency="registry-api",
                settings=self._settings,
                method="GET",
                url=f"{self._settings.registry_base_url.removesuffix('/api/v1')}/ready",
            )
        except Exception:
            return "not_ready"
        return "ready"


class DevAuthzRegistryClient:
    def __init__(self, audit_client: RegistryClient) -> None:
        self._audit_client = audit_client

    async def filter_allowed_documents(
        self,
        *,
        subject_id: str,
        candidate_document_ids: list[str],
        auth_context: AuthContext | None = None,
    ) -> AuthzFilterResult:
        return AuthzFilterResult(
            allowed_document_ids=set(candidate_document_ids),
            denied_document_ids=set(),
        )

    async def write_audit_event(
        self,
        *,
        actor_id: str,
        event_type: str,
        resource_id: str,
        metadata: dict[str, object],
        resource_type: str = "rag_query",
        auth_context: AuthContext | None = None,
    ) -> None:
        await self._audit_client.write_audit_event(
            actor_id=actor_id,
            event_type=event_type,
            resource_id=resource_id,
            metadata=metadata,
            resource_type=resource_type,
            auth_context=auth_context,
        )

    async def readiness(self) -> str:
        return await self._audit_client.readiness()


def create_registry_client(settings: Settings) -> RegistryClient:
    registry_client: RegistryClient
    if settings.registry_client_mode == "mock":
        registry_client = MockRegistryClient(settings)
    else:
        registry_client = HttpRegistryClient(settings)

    if settings.authz_mode == "dev":
        return DevAuthzRegistryClient(registry_client)

    return registry_client
