from __future__ import annotations

from typing import Any, Protocol

from app.config import Settings
from app.context import get_correlation_id
from app.http_utils import request_json_with_retry


class RegistryClient(Protocol):
    async def write_audit_event(
        self,
        *,
        event_type: str,
        resource_id: str,
        metadata: dict[str, Any],
    ) -> None:
        ...

    async def readiness(self) -> str:
        ...


class MockRegistryClient:
    async def write_audit_event(
        self,
        *,
        event_type: str,
        resource_id: str,
        metadata: dict[str, Any],
    ) -> None:
        return None

    async def readiness(self) -> str:
        return "ready"


class HttpRegistryClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def write_audit_event(
        self,
        *,
        event_type: str,
        resource_id: str,
        metadata: dict[str, Any],
    ) -> None:
        body = {
            "actor_id": self._settings.service_actor_id,
            "event_type": event_type,
            "resource_type": "evaluation_run",
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


def create_registry_client(settings: Settings) -> RegistryClient:
    if settings.registry_client_mode == "mock":
        return MockRegistryClient()
    return HttpRegistryClient(settings)
