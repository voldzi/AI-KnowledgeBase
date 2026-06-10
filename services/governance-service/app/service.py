from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import date

from app.config import Settings
from app.errors import GovernanceError
from app.evidence import unique_citations, unique_sources
from app.registry_client import RegistryClient, ValidityCandidate
from app.rag_client import RagClient
from app.schemas import (
    Citation,
    CompareVersionsRequest,
    CompareVersionsResponse,
    ComplianceCheckRequest,
    ComplianceCheckResponse,
    ConflictDetectionRequest,
    ConflictDetectionResponse,
    GenerateKbArticleRequest,
    GenerateKbArticleResponse,
    RetrievedChunk,
    SourceReference,
    ValidityAlert,
    ValidityAlertsResponse,
)
from compliance.checker import ComplianceChecker
from conflict_detection.detector import ConflictDetector
from document_diff.diff_engine import DocumentDiffEngine
from kb_generation.generator import KbArticleGenerator

logger = logging.getLogger(__name__)


class GovernanceService:
    def __init__(
        self,
        *,
        settings: Settings,
        registry_client: RegistryClient,
        rag_client: RagClient,
        diff_engine: DocumentDiffEngine,
        compliance_checker: ComplianceChecker,
        conflict_detector: ConflictDetector,
        kb_generator: KbArticleGenerator,
    ) -> None:
        self._settings = settings
        self._registry_client = registry_client
        self._rag_client = rag_client
        self._diff_engine = diff_engine
        self._compliance_checker = compliance_checker
        self._conflict_detector = conflict_detector
        self._kb_generator = kb_generator

    async def compare_versions(self, payload: CompareVersionsRequest) -> CompareVersionsResponse:
        _validate_content_size(self._settings, payload.left_version.content, payload.right_version.content)
        await self._require_documents_allowed(
            subject_id=payload.subject_id,
            document_ids=[payload.left_version.document_id, payload.right_version.document_id],
        )
        result_id = _result_id()
        response = self._diff_engine.compare(
            result_id=result_id,
            left=payload.left_version,
            right=payload.right_version,
            include_unchanged=payload.include_unchanged,
        )
        await self._audit_result(
            actor_id=payload.subject_id,
            event_type="governance.compare_versions.executed",
            resource_id=result_id,
            response=response,
            metadata={
                "left_version_id": payload.left_version.document_version_id,
                "right_version_id": payload.right_version.document_version_id,
                "change_count": sum(
                    response.change_counts.get(key, 0) for key in ("added", "removed", "modified")
                ),
            },
        )
        logger.info(
            "governance_compare_completed result_id=%s confidence=%s change_count=%s",
            result_id,
            response.confidence,
            len(response.changes),
        )
        return response

    async def check_compliance(self, payload: ComplianceCheckRequest) -> ComplianceCheckResponse:
        _validate_content_size(self._settings, payload.draft.content)
        if payload.draft.document_id:
            await self._require_documents_allowed(
                subject_id=payload.subject_id,
                document_ids=[payload.draft.document_id],
            )

        control_sources = payload.control_sources
        if not control_sources:
            control_sources = await self._rag_client.retrieve(
                subject_id=payload.subject_id,
                query=payload.control_query,
                filters=payload.filters,
                max_chunks=min(payload.max_control_chunks, self._settings.max_control_chunks),
            )

        control_sources, warnings = await self._filter_chunks_allowed(
            subject_id=payload.subject_id,
            chunks=control_sources[: self._settings.max_control_chunks],
        )
        result_id = _result_id()
        response = self._compliance_checker.check(
            result_id=result_id,
            draft=payload.draft,
            control_sources=control_sources,
        )
        response.warnings.extend(warning for warning in warnings if warning not in response.warnings)
        await self._audit_result(
            actor_id=payload.subject_id,
            event_type="governance.check_compliance.executed",
            resource_id=result_id,
            response=response,
            severity="warning" if response.status == "non_compliant" else "info",
            metadata={
                "status": response.status,
                "finding_count": len(response.findings),
                "control_chunk_count": len(control_sources),
                "document_id": payload.draft.document_id,
            },
        )
        logger.info(
            "governance_compliance_completed result_id=%s status=%s confidence=%s finding_count=%s",
            result_id,
            response.status,
            response.confidence,
            len(response.findings),
        )
        return response

    async def detect_conflicts(self, payload: ConflictDetectionRequest) -> ConflictDetectionResponse:
        _validate_content_size(self._settings, *(document.content for document in payload.documents))
        allowed_documents, warnings = await self._filter_documents_allowed(
            subject_id=payload.subject_id,
            documents=payload.documents,
        )
        result_id = _result_id()
        if len(allowed_documents) < 2:
            response = ConflictDetectionResponse(
                result_id=result_id,
                summary="Conflict detection needs at least two authorized source documents.",
                conflicts=[],
                citations=[],
                sources=[],
                confidence="insufficient_source",
                warnings=[*warnings, "AUTHORIZED_SOURCE_COUNT_TOO_LOW"],
                missing_information="At least two authorized source documents are required.",
            )
        else:
            response = self._conflict_detector.detect(
                result_id=result_id,
                documents=allowed_documents,
                topic=payload.topic,
                warnings=warnings,
            )
        await self._audit_result(
            actor_id=payload.subject_id,
            event_type="governance.detect_conflicts.executed",
            resource_id=result_id,
            response=response,
            severity="warning" if response.conflicts else "info",
            metadata={
                "conflict_count": len(response.conflicts),
                "authorized_document_count": len(allowed_documents),
                "document_id": allowed_documents[0].document_id if allowed_documents else None,
            },
        )
        logger.info(
            "governance_conflict_detection_completed result_id=%s confidence=%s conflict_count=%s",
            result_id,
            response.confidence,
            len(response.conflicts),
        )
        return response

    async def generate_kb_article(self, payload: GenerateKbArticleRequest) -> GenerateKbArticleResponse:
        _validate_content_size(self._settings, payload.source_document.content)
        await self._require_documents_allowed(
            subject_id=payload.subject_id,
            document_ids=[payload.source_document.document_id],
        )
        result_id = _result_id()
        response = self._kb_generator.generate(
            result_id=result_id,
            source_document=payload.source_document,
            audience=payload.audience,
            max_sections=payload.max_sections,
        )
        await self._audit_result(
            actor_id=payload.subject_id,
            event_type="governance.generate_kb_article.executed",
            resource_id=result_id,
            response=response,
            metadata={
                "source_document_id": payload.source_document.document_id,
                "section_count": len(response.article.sections),
                "publication_status": response.article.publication_status,
            },
        )
        logger.info(
            "governance_kb_generation_completed result_id=%s confidence=%s section_count=%s",
            result_id,
            response.confidence,
            len(response.article.sections),
        )
        return response

    async def validity_alerts(self, *, subject_id: str, days_before_expiry: int) -> ValidityAlertsResponse:
        if days_before_expiry <= 0 or days_before_expiry > 730:
            raise GovernanceError(
                "INVALID_VALIDITY_WINDOW",
                "days_before_expiry must be between 1 and 730",
                status_code=422,
            )
        result_id = _result_id()
        candidates = await self._registry_client.list_validity_candidates(
            subject_id=subject_id,
            days_before_expiry=days_before_expiry,
        )
        alerts = [_validity_alert(candidate) for candidate in candidates]
        citations = unique_citations([alert.citation for alert in alerts])
        sources = unique_sources([alert.source for alert in alerts])
        response = ValidityAlertsResponse(
            result_id=result_id,
            as_of=date.today(),
            days_before_expiry=days_before_expiry,
            alerts=alerts,
            citations=citations,
            sources=sources,
            confidence="high" if alerts else "medium",
            warnings=[],
            missing_information=None,
        )
        await self._audit_result(
            actor_id=subject_id,
            event_type="governance.validity_alerts.viewed",
            resource_id=result_id,
            response=response,
            metadata={"alert_count": len(alerts), "days_before_expiry": days_before_expiry},
        )
        return response

    async def readiness(self) -> dict[str, str]:
        return {
            "registry-api": await self._registry_client.readiness(),
            "rag-retrieval-service": await self._rag_client.readiness(),
        }

    async def _require_documents_allowed(self, *, subject_id: str, document_ids: list[str]) -> None:
        authz = await self._registry_client.filter_allowed_documents(
            subject_id=subject_id,
            candidate_document_ids=sorted(set(document_ids)),
        )
        if authz.denied_document_ids:
            raise GovernanceError(
                "AUTHZ_FORBIDDEN",
                "Subject is not authorized for at least one requested document.",
                status_code=403,
                details={"denied_document_count": len(authz.denied_document_ids)},
            )

    async def _filter_chunks_allowed(
        self,
        *,
        subject_id: str,
        chunks: list[RetrievedChunk],
    ) -> tuple[list[RetrievedChunk], list[str]]:
        candidate_ids = sorted({chunk.citation.document_id for chunk in chunks})
        authz = await self._registry_client.filter_allowed_documents(
            subject_id=subject_id,
            candidate_document_ids=candidate_ids,
        )
        allowed = [chunk for chunk in chunks if chunk.citation.document_id in authz.allowed_document_ids]
        warnings = ["AUTHZ_FILTERED_SOURCES"] if authz.denied_document_ids else []
        return allowed, warnings

    async def _filter_documents_allowed(
        self,
        *,
        subject_id: str,
        documents: list,
    ) -> tuple[list, list[str]]:
        candidate_ids = sorted({document.document_id for document in documents})
        authz = await self._registry_client.filter_allowed_documents(
            subject_id=subject_id,
            candidate_document_ids=candidate_ids,
        )
        allowed = [document for document in documents if document.document_id in authz.allowed_document_ids]
        warnings = ["AUTHZ_FILTERED_SOURCES"] if authz.denied_document_ids else []
        return allowed, warnings

    async def _audit_result(
        self,
        *,
        actor_id: str,
        event_type: str,
        resource_id: str,
        response: object,
        metadata: dict[str, object],
        severity: str = "info",
    ) -> None:
        citations = getattr(response, "citations", [])
        warnings = getattr(response, "warnings", [])
        confidence = getattr(response, "confidence", None)
        result_json = response.model_dump_json() if hasattr(response, "model_dump_json") else repr(response)
        await self._registry_client.write_audit_event(
            actor_id=actor_id,
            event_type=event_type,
            resource_id=resource_id,
            severity=severity,
            metadata={
                **metadata,
                "confidence": confidence,
                "warning_count": len(warnings),
                "cited_document_ids": sorted({citation.document_id for citation in citations}),
                "citation_count": len(citations),
                "result_sha256": hashlib.sha256(result_json.encode("utf-8")).hexdigest(),
            },
        )


def _validate_content_size(settings: Settings, *contents: str) -> None:
    too_large = [len(content) for content in contents if len(content) > settings.max_document_chars]
    if too_large:
        raise GovernanceError(
            "DOCUMENT_TOO_LARGE",
            "Document content exceeds AKL_GOVERNANCE_MAX_DOCUMENT_CHARS",
            status_code=413,
            details={"max_document_chars": settings.max_document_chars},
        )


def _validity_alert(candidate: ValidityCandidate) -> ValidityAlert:
    today = date.today()
    days_remaining = (candidate.valid_to - today).days
    if days_remaining <= 7:
        severity = "critical"
    elif days_remaining <= 30:
        severity = "warning"
    else:
        severity = "info"
    citation = Citation(
        document_id=candidate.document_id,
        document_version_id=candidate.document_version_id,
        document_title=candidate.document_title,
        version_label=candidate.version_label,
        section_path=["registry.validity"],
        page_number=None,
        chunk_id=f"registry:{candidate.document_version_id}:valid_to",
        source_excerpt=f"valid_to={candidate.valid_to.isoformat()}",
    )
    source = SourceReference(
        source_id=f"registry:{candidate.document_version_id}",
        source_type="registry_metadata",
        document_id=candidate.document_id,
        document_version_id=candidate.document_version_id,
        title=f"{candidate.document_title} {candidate.version_label}",
        uri=candidate.source_uri,
        citation=citation,
    )
    return ValidityAlert(
        alert_id=f"val_{uuid.uuid4().hex[:12]}",
        document_id=candidate.document_id,
        document_version_id=candidate.document_version_id,
        document_title=candidate.document_title,
        version_label=candidate.version_label,
        valid_to=candidate.valid_to,
        days_remaining=days_remaining,
        severity=severity,
        recommendation="Start Registry review or archival workflow before validity expires.",
        citation=citation,
        source=source,
        confidence="high",
    )


def _result_id() -> str:
    return f"gov_{uuid.uuid4().hex[:12]}"
