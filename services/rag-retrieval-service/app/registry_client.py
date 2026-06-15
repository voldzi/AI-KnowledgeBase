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

    async def append_conversation_messages(
        self,
        *,
        conversation_id: str,
        user_id: str,
        messages: list[dict[str, object]],
        auth_context: AuthContext | None = None,
    ) -> None:
        ...

    async def fetch_conversation(
        self,
        *,
        conversation_id: str,
        auth_context: AuthContext | None = None,
    ) -> dict[str, object] | None:
        ...

    async def store_document_extraction(
        self,
        *,
        payload: dict[str, object],
        auth_context: AuthContext | None = None,
    ) -> dict[str, object]:
        ...

    async def fetch_document_extraction(
        self,
        *,
        extraction_id: str,
        auth_context: AuthContext | None = None,
    ) -> dict[str, object] | None:
        ...

    async def record_document_extraction_feedback(
        self,
        *,
        extraction_id: str,
        payload: dict[str, object],
        auth_context: AuthContext | None = None,
    ) -> dict[str, object]:
        ...

    async def readiness(self) -> str:
        ...


class MockRegistryClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._conversations: dict[str, dict[str, object]] = {}
        self._extractions: dict[str, dict[str, object]] = {}
        self._extraction_identity: dict[tuple[object, ...], str] = {}
        self._feedback: dict[str, dict[str, object]] = {}

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

    async def append_conversation_messages(
        self,
        *,
        conversation_id: str,
        user_id: str,
        messages: list[dict[str, object]],
        auth_context: AuthContext | None = None,
    ) -> None:
        conversation = self._conversations.setdefault(
            conversation_id,
            {"conversation_id": conversation_id, "user_id": user_id, "status": "active", "messages": []},
        )
        conversation["messages"] = [*conversation["messages"], *messages]  # type: ignore[misc]

    async def fetch_conversation(
        self,
        *,
        conversation_id: str,
        auth_context: AuthContext | None = None,
    ) -> dict[str, object] | None:
        return self._conversations.get(conversation_id)

    async def store_document_extraction(
        self,
        *,
        payload: dict[str, object],
        auth_context: AuthContext | None = None,
    ) -> dict[str, object]:
        from datetime import datetime, timezone
        from uuid import uuid4

        identity = (
            payload.get("tenant_id"),
            payload.get("external_system"),
            payload.get("external_ref"),
            payload.get("document_id"),
            payload.get("document_version_id"),
            payload.get("profile"),
            payload.get("profile_version"),
        )
        existing_id = self._extraction_identity.get(identity)
        if existing_id:
            return {"extraction": self._extractions[existing_id], "created": False}

        for extraction in self._extractions.values():
            if (
                extraction.get("tenant_id") == payload.get("tenant_id")
                and extraction.get("external_system") == payload.get("external_system")
                and extraction.get("external_ref") == payload.get("external_ref")
                and extraction.get("document_id") == payload.get("document_id")
                and extraction.get("document_version_id") != payload.get("document_version_id")
                and extraction.get("profile") == payload.get("profile")
                and extraction.get("profile_version") == payload.get("profile_version")
                and extraction.get("status") in {"PENDING", "RUNNING", "PROPOSED", "PARTIAL", "FAILED"}
            ):
                extraction["status"] = "SUPERSEDED"
                extraction["updated_at"] = datetime.now(timezone.utc).isoformat()

        extraction_id = f"extract_{uuid4().hex}"
        now = datetime.now(timezone.utc).isoformat()
        extraction = {
            "extraction_id": extraction_id,
            "created_at": now,
            "updated_at": now,
            **payload,
        }
        self._extractions[extraction_id] = extraction
        self._extraction_identity[identity] = extraction_id
        return {"extraction": extraction, "created": True}

    async def fetch_document_extraction(
        self,
        *,
        extraction_id: str,
        auth_context: AuthContext | None = None,
    ) -> dict[str, object] | None:
        return self._extractions.get(extraction_id)

    async def record_document_extraction_feedback(
        self,
        *,
        extraction_id: str,
        payload: dict[str, object],
        auth_context: AuthContext | None = None,
    ) -> dict[str, object]:
        from datetime import datetime, timezone
        from uuid import uuid4

        extraction = self._extractions.get(extraction_id)
        if extraction is None:
            return {}
        decision = payload.get("decision")
        if decision in {"accepted", "edited"}:
            extraction["status"] = "ACCEPTED_IN_SOURCE_APP"
        elif decision == "rejected":
            extraction["status"] = "REJECTED_IN_SOURCE_APP"
        extraction["updated_at"] = datetime.now(timezone.utc).isoformat()

        feedback_id = f"extfb_{uuid4().hex}"
        feedback = {
            "feedback_id": feedback_id,
            "extraction_id": extraction_id,
            "tenant_id": extraction.get("tenant_id"),
            "actor_id": payload.get("actor"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        self._feedback[feedback_id] = feedback
        return {"feedback": feedback, "extraction": extraction}

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

    async def append_conversation_messages(
        self,
        *,
        conversation_id: str,
        user_id: str,
        messages: list[dict[str, object]],
        auth_context: AuthContext | None = None,
    ) -> None:
        await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/assistant/conversations/{conversation_id}/messages",
            json_body={"user_id": user_id, "messages": messages},
            auth_context=auth_context,
            prefer_upstream_token=True,
        )

    async def fetch_conversation(
        self,
        *,
        conversation_id: str,
        auth_context: AuthContext | None = None,
    ) -> dict[str, object] | None:
        from app.errors import RetrievalError

        try:
            return await request_json_with_retry(
                dependency="registry-api",
                settings=self._settings,
                method="GET",
                url=f"{self._settings.registry_base_url}/assistant/conversations/{conversation_id}",
                auth_context=auth_context,
                prefer_upstream_token=True,
            )
        except RetrievalError as exc:
            if exc.status_code == 404 or (exc.details or {}).get("status_code") == 404:
                return None
            raise

    async def store_document_extraction(
        self,
        *,
        payload: dict[str, object],
        auth_context: AuthContext | None = None,
    ) -> dict[str, object]:
        return await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/document-extractions",
            json_body=payload,
            auth_context=auth_context,
            prefer_upstream_token=True,
        )

    async def fetch_document_extraction(
        self,
        *,
        extraction_id: str,
        auth_context: AuthContext | None = None,
    ) -> dict[str, object] | None:
        from app.errors import RetrievalError

        try:
            return await request_json_with_retry(
                dependency="registry-api",
                settings=self._settings,
                method="GET",
                url=f"{self._settings.registry_base_url}/document-extractions/{extraction_id}",
                auth_context=auth_context,
                prefer_upstream_token=True,
            )
        except RetrievalError as exc:
            if exc.status_code == 404 or (exc.details or {}).get("status_code") == 404:
                return None
            raise

    async def record_document_extraction_feedback(
        self,
        *,
        extraction_id: str,
        payload: dict[str, object],
        auth_context: AuthContext | None = None,
    ) -> dict[str, object]:
        return await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/document-extractions/{extraction_id}/feedback",
            json_body=payload,
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

    async def append_conversation_messages(
        self,
        *,
        conversation_id: str,
        user_id: str,
        messages: list[dict[str, object]],
        auth_context: AuthContext | None = None,
    ) -> None:
        await self._audit_client.append_conversation_messages(
            conversation_id=conversation_id,
            user_id=user_id,
            messages=messages,
            auth_context=auth_context,
        )

    async def fetch_conversation(
        self,
        *,
        conversation_id: str,
        auth_context: AuthContext | None = None,
    ) -> dict[str, object] | None:
        return await self._audit_client.fetch_conversation(
            conversation_id=conversation_id,
            auth_context=auth_context,
        )

    async def store_document_extraction(
        self,
        *,
        payload: dict[str, object],
        auth_context: AuthContext | None = None,
    ) -> dict[str, object]:
        return await self._audit_client.store_document_extraction(
            payload=payload,
            auth_context=auth_context,
        )

    async def fetch_document_extraction(
        self,
        *,
        extraction_id: str,
        auth_context: AuthContext | None = None,
    ) -> dict[str, object] | None:
        return await self._audit_client.fetch_document_extraction(
            extraction_id=extraction_id,
            auth_context=auth_context,
        )

    async def record_document_extraction_feedback(
        self,
        *,
        extraction_id: str,
        payload: dict[str, object],
        auth_context: AuthContext | None = None,
    ) -> dict[str, object]:
        return await self._audit_client.record_document_extraction_feedback(
            extraction_id=extraction_id,
            payload=payload,
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
