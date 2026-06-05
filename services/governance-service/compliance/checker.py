from __future__ import annotations

import re
import unicodedata

from app.config import Settings
from app.evidence import citation_from_chunk, excerpt, source_from_chunk, unique_citations, unique_sources
from app.schemas import (
    Citation,
    ComplianceCheckResponse,
    ComplianceFinding,
    ComplianceStatus,
    Confidence,
    DraftDocumentInput,
    FindingSeverity,
    RetrievedChunk,
    RuleStatus,
    SourceReference,
)


class ComplianceChecker:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def check(
        self,
        *,
        result_id: str,
        draft: DraftDocumentInput,
        control_sources: list[RetrievedChunk],
    ) -> ComplianceCheckResponse:
        draft_citation = _draft_citation(draft)
        draft_source = SourceReference(
            source_id=draft.document_version_id or "draft_version",
            source_type="input_document",
            document_id=draft.document_id or "draft_document",
            document_version_id=draft.document_version_id or "draft_version",
            title=draft.title,
            uri=None,
            citation=draft_citation,
        )
        control_citations = [citation_from_chunk(chunk) for chunk in control_sources]
        control_refs = [source_from_chunk(chunk) for chunk in control_sources]
        all_sources = unique_sources([draft_source, *control_refs])

        if not control_sources:
            finding = ComplianceFinding(
                finding_id="cmp_001",
                rule_id="governance.control_sources.required",
                rule_name="Control sources must be available",
                status="failed",
                severity="critical",
                message="Compliance check cannot be grounded because no control source was provided or retrieved.",
                recommendation="Retrieve valid directives, policies, or methodologies and repeat the check.",
                evidence_citations=[draft_citation],
                sources=[draft_source],
                confidence="insufficient_source",
            )
            return ComplianceCheckResponse(
                result_id=result_id,
                status="insufficient_source",
                summary="Compliance status cannot be established without cited control sources.",
                findings=[finding],
                citations=[draft_citation],
                sources=[draft_source],
                confidence="insufficient_source",
                warnings=["CONTROL_SOURCES_MISSING"],
                missing_information="Valid cited control documentation is required.",
            )

        findings = [
            _finding(
                index=1,
                rule_id="governance.control_sources.available",
                rule_name="Cited control sources",
                status="passed",
                severity="info",
                message=f"Compliance check used {len(control_sources)} cited control source(s).",
                recommendation="Keep cited source references with the review record.",
                citations=control_citations,
                sources=control_refs,
                confidence=_source_confidence(control_sources, self._settings),
            ),
            self._owner_finding(2, draft, draft_citation, draft_source, control_citations, control_refs),
            self._validity_finding(3, draft, draft_citation, draft_source, control_citations, control_refs),
            self._exception_finding(4, draft, draft_citation, draft_source, control_citations, control_refs),
            self._draft_citation_finding(5, draft, draft_citation, draft_source, control_citations, control_refs),
        ]

        status = _overall_status(findings)
        citations = unique_citations([citation for finding in findings for citation in finding.evidence_citations])
        confidence = _response_confidence(findings, control_sources, self._settings)
        warnings = _warnings(findings)

        return ComplianceCheckResponse(
            result_id=result_id,
            status=status,
            summary=_summary(status, findings),
            findings=findings,
            citations=citations,
            sources=all_sources,
            confidence=confidence,
            warnings=warnings,
            missing_information=None if status != "insufficient_source" else "Insufficient source support.",
        )

    def _owner_finding(
        self,
        index: int,
        draft: DraftDocumentInput,
        draft_citation: Citation,
        draft_source: SourceReference,
        control_citations: list[Citation],
        control_refs: list[SourceReference],
    ) -> ComplianceFinding:
        text = _norm(draft.content)
        has_owner = bool(draft.owner_id or draft.gestor_unit) or _contains_any(
            text,
            ["gestor", "vlastnik", "owner", "odpovedna osoba", "odpovednost"],
        )
        if has_owner:
            return _finding(
                index=index,
                rule_id="governance.owner_or_gestor.required",
                rule_name="Owner or gestor traceability",
                status="passed",
                severity="info",
                message="Draft identifies an owner, gestor, or responsible role.",
                recommendation="Verify the value against Registry metadata before publication.",
                citations=[draft_citation, *control_citations[:1]],
                sources=[draft_source, *control_refs[:1]],
                confidence="high",
            )
        return _finding(
            index=index,
            rule_id="governance.owner_or_gestor.required",
            rule_name="Owner or gestor traceability",
            status="failed",
            severity="error",
            message="Draft does not clearly identify the owner, gestor, or responsible role.",
            recommendation="Add explicit owner/gestor metadata or a responsibility section before review.",
            citations=[draft_citation, *control_citations[:1]],
            sources=[draft_source, *control_refs[:1]],
            confidence="medium",
        )

    def _validity_finding(
        self,
        index: int,
        draft: DraftDocumentInput,
        draft_citation: Citation,
        draft_source: SourceReference,
        control_citations: list[Citation],
        control_refs: list[SourceReference],
    ) -> ComplianceFinding:
        text = _norm(draft.content)
        has_validity = bool(draft.valid_from or draft.valid_to) or _contains_any(
            text,
            ["platnost", "ucinnost", "valid from", "valid to", "datum ucinnosti"],
        )
        if has_validity:
            return _finding(
                index=index,
                rule_id="governance.validity_window.required",
                rule_name="Validity window",
                status="passed",
                severity="info",
                message="Draft contains validity or effectiveness information.",
                recommendation="Confirm valid_from and valid_to in Registry workflow.",
                citations=[draft_citation, *control_citations[:1]],
                sources=[draft_source, *control_refs[:1]],
                confidence="high",
            )
        return _finding(
            index=index,
            rule_id="governance.validity_window.required",
            rule_name="Validity window",
            status="warning",
            severity="warning",
            message="Draft does not clearly define validity or effectiveness dates.",
            recommendation="Add valid_from and, when applicable, valid_to before publication workflow.",
            citations=[draft_citation, *control_citations[:1]],
            sources=[draft_source, *control_refs[:1]],
            confidence="medium",
        )

    def _exception_finding(
        self,
        index: int,
        draft: DraftDocumentInput,
        draft_citation: Citation,
        draft_source: SourceReference,
        control_citations: list[Citation],
        control_refs: list[SourceReference],
    ) -> ComplianceFinding:
        text = _norm(draft.content)
        mentions_exception = _contains_any(text, ["vyjimka", "vyjimku", "exception"])
        if not mentions_exception:
            return _finding(
                index=index,
                rule_id="governance.exception_approval.required",
                rule_name="Exception approval path",
                status="passed",
                severity="info",
                message="Draft does not introduce an exception workflow.",
                recommendation="No exception-specific approval path is required unless exceptions are added.",
                citations=[draft_citation, *control_citations[:1]],
                sources=[draft_source, *control_refs[:1]],
                confidence="medium",
            )

        has_approval = _contains_any(text, ["schvaluje", "schvaleni", "schvalit", "gestor", "approver"])
        if has_approval:
            return _finding(
                index=index,
                rule_id="governance.exception_approval.required",
                rule_name="Exception approval path",
                status="passed",
                severity="info",
                message="Draft mentions exceptions and includes an approval path.",
                recommendation="Verify that the approving role matches current valid directives.",
                citations=[draft_citation, *control_citations[:2]],
                sources=[draft_source, *control_refs[:2]],
                confidence="high",
            )
        return _finding(
            index=index,
            rule_id="governance.exception_approval.required",
            rule_name="Exception approval path",
            status="failed",
            severity="error",
            message="Draft mentions exceptions but does not state who approves them.",
            recommendation="Add an explicit approver and required request content for exceptions.",
            citations=[draft_citation, *control_citations[:2]],
            sources=[draft_source, *control_refs[:2]],
            confidence="medium",
        )

    def _draft_citation_finding(
        self,
        index: int,
        draft: DraftDocumentInput,
        draft_citation: Citation,
        draft_source: SourceReference,
        control_citations: list[Citation],
        control_refs: list[SourceReference],
    ) -> ComplianceFinding:
        if draft.citations:
            return _finding(
                index=index,
                rule_id="governance.draft_traceability.recommended",
                rule_name="Draft source traceability",
                status="passed",
                severity="info",
                message="Draft includes source citations from the caller.",
                recommendation="Keep citations attached to the Registry review packet.",
                citations=[*draft.citations, *control_citations[:1]],
                sources=[draft_source, *control_refs[:1]],
                confidence="high",
            )
        return _finding(
            index=index,
            rule_id="governance.draft_traceability.recommended",
            rule_name="Draft source traceability",
            status="manual_review",
            severity="warning",
            message="Draft was provided without caller-supplied source citations.",
            recommendation="Attach original source references before treating this as a controlled-document review.",
            citations=[draft_citation, *control_citations[:1]],
            sources=[draft_source, *control_refs[:1]],
            confidence="medium",
        )


def _finding(
    *,
    index: int,
    rule_id: str,
    rule_name: str,
    status: RuleStatus,
    severity: FindingSeverity,
    message: str,
    recommendation: str,
    citations: list[Citation],
    sources: list[SourceReference],
    confidence: Confidence,
) -> ComplianceFinding:
    return ComplianceFinding(
        finding_id=f"cmp_{index:03d}",
        rule_id=rule_id,
        rule_name=rule_name,
        status=status,
        severity=severity,
        message=message,
        recommendation=recommendation,
        evidence_citations=citations,
        sources=sources,
        confidence=confidence,
    )


def _draft_citation(draft: DraftDocumentInput) -> Citation:
    if draft.citations:
        return draft.citations[0]
    return Citation(
        document_id=draft.document_id or "draft_document",
        document_version_id=draft.document_version_id or "draft_version",
        document_title=draft.title,
        version_label="draft",
        section_path=["draft"],
        page_number=None,
        chunk_id="input:draft",
        source_excerpt=excerpt(draft.content),
    )


def _norm(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    without_accents = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_accents.lower()).strip()


def _contains_any(text: str, needles: list[str]) -> bool:
    return any(needle in text for needle in needles)


def _source_confidence(chunks: list[RetrievedChunk], settings: Settings) -> Confidence:
    if not chunks:
        return "insufficient_source"
    average_score = sum(chunk.score for chunk in chunks) / len(chunks)
    if average_score >= settings.confidence_high_threshold:
        return "high"
    if average_score >= settings.confidence_medium_threshold:
        return "medium"
    return "low"


def _response_confidence(
    findings: list[ComplianceFinding],
    chunks: list[RetrievedChunk],
    settings: Settings,
) -> Confidence:
    if not chunks:
        return "insufficient_source"
    if any(finding.confidence == "low" for finding in findings):
        return "low"
    return _source_confidence(chunks, settings)


def _overall_status(findings: list[ComplianceFinding]) -> ComplianceStatus:
    if any(finding.status == "failed" for finding in findings):
        return "non_compliant"
    if any(finding.status in {"warning", "manual_review"} for finding in findings):
        return "needs_review"
    return "compliant"


def _warnings(findings: list[ComplianceFinding]) -> list[str]:
    warnings: list[str] = []
    for finding in findings:
        if finding.status == "failed":
            warnings.append(f"FAILED:{finding.rule_id}")
        elif finding.status in {"warning", "manual_review"}:
            warnings.append(f"REVIEW:{finding.rule_id}")
    return warnings


def _summary(status: ComplianceStatus, findings: list[ComplianceFinding]) -> str:
    failed = sum(1 for finding in findings if finding.status == "failed")
    review = sum(1 for finding in findings if finding.status in {"warning", "manual_review"})
    passed = sum(1 for finding in findings if finding.status == "passed")
    return f"Compliance result is {status}: {passed} passed, {review} need review, {failed} failed."
