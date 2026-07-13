from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import Settings
from app.context import get_correlation_id
from app.errors import RetrievalError
from app.http_utils import request_json_with_retry
from app.security import AuthContext


@dataclass(frozen=True)
class AuthzFilterResult:
    allowed_document_ids: set[str]
    denied_document_ids: set[str]


@dataclass(frozen=True)
class IdempotencyReservation:
    state: str
    record_id: str
    response_status: int | None = None
    response_body: dict[str, object] | None = None
    audit_event_id: str | None = None


class RegistryClient(Protocol):
    async def filter_allowed_documents(
        self,
        *,
        subject_id: str,
        candidate_document_ids: list[str],
        auth_context: AuthContext | None = None,
        candidate_policy_hashes: dict[str, list[str]] | None = None,
        candidate_document_versions: dict[str, list[str]] | None = None,
        action: str = "rag.query",
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
    ) -> str | None:
        ...

    async def reserve_idempotency(
        self,
        *,
        client_id: str,
        operation: str,
        idempotency_key: str,
        input_hash: str,
        auth_context: AuthContext | None = None,
    ) -> IdempotencyReservation:
        ...

    async def complete_idempotency(
        self,
        *,
        record_id: str,
        response_status: int,
        response_body: dict[str, object],
        audit_event_id: str | None,
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
        self._idempotency: dict[tuple[str, str, str], dict[str, object]] = {}

    async def filter_allowed_documents(
        self,
        *,
        subject_id: str,
        candidate_document_ids: list[str],
        auth_context: AuthContext | None = None,
        candidate_policy_hashes: dict[str, list[str]] | None = None,
        candidate_document_versions: dict[str, list[str]] | None = None,
        action: str = "rag.query",
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
    ) -> str | None:
        from uuid import uuid4

        return f"audit_{uuid4().hex}"

    async def reserve_idempotency(
        self,
        *,
        client_id: str,
        operation: str,
        idempotency_key: str,
        input_hash: str,
        auth_context: AuthContext | None = None,
    ) -> IdempotencyReservation:
        from uuid import uuid4

        identity = (client_id, operation, idempotency_key)
        record = self._idempotency.get(identity)
        if record is None:
            record = {"record_id": f"idem_{uuid4().hex}", "input_hash": input_hash, "status": "processing"}
            self._idempotency[identity] = record
            state = "reserved"
        elif record["input_hash"] != input_hash:
            state = "conflict"
        elif record["status"] == "completed":
            state = "replay"
        else:
            state = "processing"
        return IdempotencyReservation(
            state=state,
            record_id=str(record["record_id"]),
            response_status=record.get("response_status") if isinstance(record.get("response_status"), int) else None,
            response_body=record.get("response_body") if isinstance(record.get("response_body"), dict) else None,
            audit_event_id=record.get("audit_event_id") if isinstance(record.get("audit_event_id"), str) else None,
        )

    async def complete_idempotency(
        self,
        *,
        record_id: str,
        response_status: int,
        response_body: dict[str, object],
        audit_event_id: str | None,
        auth_context: AuthContext | None = None,
    ) -> None:
        for record in self._idempotency.values():
            if record.get("record_id") == record_id:
                record.update(
                    status="completed",
                    response_status=response_status,
                    response_body=response_body,
                    audit_event_id=audit_event_id,
                )
                return

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
        self._service_token_value: str | None = None
        self._service_token_expires_at = 0.0
        self._service_token_lock = asyncio.Lock()

    async def _service_token(self) -> str | None:
        settings = self._settings
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
                async with httpx.AsyncClient(timeout=self._settings.request_timeout_seconds) as client:
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
                raise RetrievalError(
                    "REGISTRY_SERVICE_AUTH_UNAVAILABLE",
                    "RAG service identity could not be obtained.",
                    status_code=503,
                ) from exc
            access_token = payload.get("access_token")
            if not isinstance(access_token, str) or not access_token:
                raise RetrievalError(
                    "REGISTRY_SERVICE_AUTH_INVALID",
                    "RAG service identity response did not contain an access token.",
                    status_code=503,
                )
            expires_in = payload.get("expires_in")
            lifetime = int(expires_in) if isinstance(expires_in, (int, float)) else 60
            self._service_token_value = access_token
            self._service_token_expires_at = now + max(5, lifetime - 30)
            return access_token

    async def filter_allowed_documents(
        self,
        *,
        subject_id: str,
        candidate_document_ids: list[str],
        auth_context: AuthContext | None = None,
        candidate_policy_hashes: dict[str, list[str]] | None = None,
        candidate_document_versions: dict[str, list[str]] | None = None,
        action: str = "rag.query",
    ) -> AuthzFilterResult:
        if not candidate_document_ids:
            return AuthzFilterResult(allowed_document_ids=set(), denied_document_ids=set())

        body = {
            "subject_id": subject_id,
            "action": action,
            "candidate_document_ids": candidate_document_ids,
            "candidate_policy_hashes": candidate_policy_hashes or {},
            "candidate_document_versions": candidate_document_versions or {},
        }
        if self._settings.auth_mode in {"disabled", "mock"}:
            body.update(
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
        service_token = await self._service_token() if auth_context and auth_context.service_identity else None
        payload = await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/authz/filter-documents",
            json_body=body,
            auth_context=auth_context,
            bearer_token_override=service_token,
            service_identity=service_token is not None,
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
    ) -> str | None:
        body = {
            "actor_id": actor_id,
            "event_type": event_type,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "severity": "info",
            "correlation_id": get_correlation_id(),
            "metadata": {"service": self._settings.service_name, **metadata},
        }
        service_token = await self._service_token()
        payload = await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/audit/events",
            json_body=body,
            auth_context=auth_context,
            prefer_upstream_token=service_token is None,
            bearer_token_override=service_token,
            service_identity=service_token is not None,
        )
        value = payload.get("audit_event_id")
        return value if isinstance(value, str) else None

    async def reserve_idempotency(
        self,
        *,
        client_id: str,
        operation: str,
        idempotency_key: str,
        input_hash: str,
        auth_context: AuthContext | None = None,
    ) -> IdempotencyReservation:
        service_token = await self._service_token()
        payload = await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/integrations/idempotency/reserve",
            json_body={
                "client_id": client_id,
                "operation": operation,
                "idempotency_key": idempotency_key,
                "input_hash": input_hash,
                "retention_seconds": 86400,
            },
            auth_context=auth_context,
            prefer_upstream_token=service_token is None,
            bearer_token_override=service_token,
            service_identity=service_token is not None,
        )
        return IdempotencyReservation(
            state=str(payload.get("state") or "processing"),
            record_id=str(payload.get("record_id") or ""),
            response_status=payload.get("response_status") if isinstance(payload.get("response_status"), int) else None,
            response_body=payload.get("response_body") if isinstance(payload.get("response_body"), dict) else None,
            audit_event_id=payload.get("audit_event_id") if isinstance(payload.get("audit_event_id"), str) else None,
        )

    async def complete_idempotency(
        self,
        *,
        record_id: str,
        response_status: int,
        response_body: dict[str, object],
        audit_event_id: str | None,
        auth_context: AuthContext | None = None,
    ) -> None:
        service_token = await self._service_token()
        await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/integrations/idempotency/{record_id}/complete",
            json_body={
                "response_status": response_status,
                "response_body": response_body,
                "audit_event_id": audit_event_id,
            },
            auth_context=auth_context,
            prefer_upstream_token=service_token is None,
            bearer_token_override=service_token,
            service_identity=service_token is not None,
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
        candidate_policy_hashes: dict[str, list[str]] | None = None,
        candidate_document_versions: dict[str, list[str]] | None = None,
        action: str = "rag.query",
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
    ) -> str | None:
        return await self._audit_client.write_audit_event(
            actor_id=actor_id,
            event_type=event_type,
            resource_id=resource_id,
            metadata=metadata,
            resource_type=resource_type,
            auth_context=auth_context,
        )

    async def reserve_idempotency(
        self,
        *,
        client_id: str,
        operation: str,
        idempotency_key: str,
        input_hash: str,
        auth_context: AuthContext | None = None,
    ) -> IdempotencyReservation:
        return await self._audit_client.reserve_idempotency(
            client_id=client_id,
            operation=operation,
            idempotency_key=idempotency_key,
            input_hash=input_hash,
            auth_context=auth_context,
        )

    async def complete_idempotency(
        self,
        *,
        record_id: str,
        response_status: int,
        response_body: dict[str, object],
        audit_event_id: str | None,
        auth_context: AuthContext | None = None,
    ) -> None:
        await self._audit_client.complete_idempotency(
            record_id=record_id,
            response_status=response_status,
            response_body=response_body,
            audit_event_id=audit_event_id,
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
