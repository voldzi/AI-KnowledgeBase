from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Protocol

from app.config import Settings
from app.context import get_correlation_id
from app.http_utils import request_json_with_retry


@dataclass(frozen=True)
class AuthzFilterResult:
    allowed_document_ids: set[str]
    denied_document_ids: set[str]


@dataclass(frozen=True)
class ValidityCandidate:
    document_id: str
    document_version_id: str
    document_title: str
    version_label: str
    valid_to: date
    source_uri: str | None


class RegistryClient(Protocol):
    async def filter_allowed_documents(
        self,
        *,
        subject_id: str,
        candidate_document_ids: list[str],
    ) -> AuthzFilterResult:
        ...

    async def write_audit_event(
        self,
        *,
        actor_id: str,
        event_type: str,
        resource_id: str,
        metadata: dict[str, object],
        severity: str = "info",
    ) -> None:
        ...

    async def list_validity_candidates(
        self,
        *,
        subject_id: str,
        days_before_expiry: int,
    ) -> list[ValidityCandidate]:
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
        severity: str = "info",
    ) -> None:
        return None

    async def list_validity_candidates(
        self,
        *,
        subject_id: str,
        days_before_expiry: int,
    ) -> list[ValidityCandidate]:
        today = date.today()
        candidates = [
            ValidityCandidate(
                document_id="doc_124",
                document_version_id="ver_457",
                document_title="Metodika rizeni platnosti dokumentu",
                version_label="2.1",
                valid_to=today + timedelta(days=min(days_before_expiry, 30)),
                source_uri="s3://akl-documents/doc_124/ver_457/file.pdf",
            ),
            ValidityCandidate(
                document_id="doc_denied",
                document_version_id="ver_denied",
                document_title="Omezeny bezpecnostni postup",
                version_label="1.0",
                valid_to=today + timedelta(days=7),
                source_uri="s3://akl-documents/doc_denied/ver_denied/file.pdf",
            ),
        ]
        authz = await self.filter_allowed_documents(
            subject_id=subject_id,
            candidate_document_ids=[candidate.document_id for candidate in candidates],
        )
        return [candidate for candidate in candidates if candidate.document_id in authz.allowed_document_ids]

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
    ) -> AuthzFilterResult:
        if not candidate_document_ids:
            return AuthzFilterResult(allowed_document_ids=set(), denied_document_ids=set())

        payload = await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/authz/filter-documents",
            json_body={
                "subject_id": subject_id,
                "action": "document.read",
                "candidate_document_ids": candidate_document_ids,
            },
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
        severity: str = "info",
    ) -> None:
        await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.registry_base_url}/audit/events",
            json_body={
                "actor_id": actor_id,
                "event_type": event_type,
                "resource_type": "governance_result",
                "resource_id": resource_id,
                "severity": severity,
                "correlation_id": get_correlation_id(),
                "metadata": {"service": self._settings.service_name, **metadata},
            },
        )

    async def list_validity_candidates(
        self,
        *,
        subject_id: str,
        days_before_expiry: int,
    ) -> list[ValidityCandidate]:
        documents_payload = await request_json_with_retry(
            dependency="registry-api",
            settings=self._settings,
            method="GET",
            url=f"{self._settings.registry_base_url}/documents?limit=200&offset=0",
        )
        documents = documents_payload.get("items", [])
        candidate_ids = [document["document_id"] for document in documents if document.get("document_id")]
        authz = await self.filter_allowed_documents(subject_id=subject_id, candidate_document_ids=candidate_ids)
        title_by_id = {document["document_id"]: document.get("title", document["document_id"]) for document in documents}

        today = date.today()
        latest = today + timedelta(days=days_before_expiry)
        candidates: list[ValidityCandidate] = []
        for document_id in sorted(authz.allowed_document_ids):
            versions_payload = await request_json_with_retry(
                dependency="registry-api",
                settings=self._settings,
                method="GET",
                url=f"{self._settings.registry_base_url}/documents/{document_id}/versions?limit=200&offset=0",
            )
            for version in versions_payload.get("items", []):
                valid_to_raw = version.get("valid_to")
                if not valid_to_raw:
                    continue
                valid_to = _parse_date(valid_to_raw)
                if today <= valid_to <= latest:
                    candidates.append(
                        ValidityCandidate(
                            document_id=document_id,
                            document_version_id=version["document_version_id"],
                            document_title=title_by_id.get(document_id, document_id),
                            version_label=version.get("version_label", version["document_version_id"]),
                            valid_to=valid_to,
                            source_uri=version.get("source_file_uri"),
                        )
                    )
        return sorted(candidates, key=lambda item: item.valid_to)

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
        return MockRegistryClient(settings)
    return HttpRegistryClient(settings)


def _parse_date(value: str) -> date:
    if "T" in value:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    return date.fromisoformat(value)
