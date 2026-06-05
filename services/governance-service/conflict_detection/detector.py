from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.evidence import citation_for_version, excerpt, source_for_version, unique_citations, unique_sources
from app.schemas import (
    Citation,
    ConflictClaim,
    ConflictDetectionResponse,
    ConflictFinding,
    ConflictType,
    Confidence,
    FindingSeverity,
    GovernanceSourceDocument,
    SourceReference,
)

STOPWORDS = {
    "ktery",
    "ktera",
    "ktere",
    "musi",
    "nesmi",
    "podle",
    "tento",
    "tato",
    "toto",
    "dokument",
    "smernice",
    "metodika",
    "postup",
}


@dataclass(frozen=True)
class AnalyzedSentence:
    document: GovernanceSourceDocument
    sentence: str
    normalized: str
    citation: Citation
    source: SourceReference
    tokens: set[str]


class ConflictDetector:
    def detect(
        self,
        *,
        result_id: str,
        documents: list[GovernanceSourceDocument],
        topic: str | None,
        warnings: list[str] | None = None,
    ) -> ConflictDetectionResponse:
        analyzed = [sentence for document in documents for sentence in _sentences(document)]
        topic_tokens = _tokens(_norm(topic or "")) if topic else set()
        conflicts: list[ConflictFinding] = []
        seen: set[tuple[str, str, ConflictType]] = set()

        for index, left in enumerate(analyzed):
            for right in analyzed[index + 1 :]:
                if left.document.document_id == right.document.document_id:
                    continue
                if topic_tokens and not ((left.tokens | right.tokens) & topic_tokens):
                    continue

                conflict_type = _classify_conflict(left, right)
                if conflict_type is None:
                    continue
                key = (left.citation.chunk_id, right.citation.chunk_id, conflict_type)
                if key in seen:
                    continue
                seen.add(key)
                conflicts.append(_conflict(len(conflicts) + 1, conflict_type, left, right))
                if len(conflicts) >= 25:
                    break
            if len(conflicts) >= 25:
                break

        citations = unique_citations([claim.citation for conflict in conflicts for claim in conflict.claims])
        sources = unique_sources([source_for_version(document) for document in documents])
        sources = unique_sources([*sources, *[claim.source for conflict in conflicts for claim in conflict.claims]])
        confidence = _overall_confidence(conflicts, analyzed)
        response_warnings = list(warnings or [])
        if len(conflicts) >= 25:
            response_warnings.append("CONFLICT_RESULT_TRUNCATED")

        return ConflictDetectionResponse(
            result_id=result_id,
            summary=_summary(conflicts, analyzed),
            conflicts=conflicts,
            citations=citations,
            sources=sources,
            confidence=confidence,
            warnings=response_warnings,
            missing_information=None if analyzed else "No source sentences were available for conflict detection.",
        )


def _sentences(document: GovernanceSourceDocument) -> list[AnalyzedSentence]:
    raw_sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+|\n+", document.content)
        if sentence.strip()
    ]
    analyzed: list[AnalyzedSentence] = []
    for index, sentence in enumerate(raw_sentences, start=1):
        citation = citation_for_version(
            document,
            chunk_id=f"input:{document.document_version_id}:s{index}",
            section_path=[f"sentence:{index}"],
            source_excerpt=excerpt(sentence),
        )
        analyzed.append(
            AnalyzedSentence(
                document=document,
                sentence=sentence,
                normalized=_norm(sentence),
                citation=citation,
                source=source_for_version(document, source_id=f"{document.document_version_id}:s{index}", citation=citation),
                tokens=_tokens(_norm(sentence)),
            )
        )
    return analyzed


def _classify_conflict(left: AnalyzedSentence, right: AnalyzedSentence) -> ConflictType | None:
    overlap = left.tokens & right.tokens
    if len(overlap) < 2:
        return None

    left_approver = _approval_target(left.normalized)
    right_approver = _approval_target(right.normalized)
    if left_approver and right_approver and left_approver != right_approver:
        return "approval_owner_mismatch"

    left_days = _deadline_days(left.normalized)
    right_days = _deadline_days(right.normalized)
    if left_days is not None and right_days is not None and left_days != right_days:
        return "deadline_mismatch"

    if _is_negative(left.normalized) and _is_positive(right.normalized):
        return "normative_polarity"
    if _is_negative(right.normalized) and _is_positive(left.normalized):
        return "normative_polarity"

    return None


def _conflict(
    index: int,
    conflict_type: ConflictType,
    left: AnalyzedSentence,
    right: AnalyzedSentence,
) -> ConflictFinding:
    severity, confidence = _severity_and_confidence(conflict_type)
    return ConflictFinding(
        conflict_id=f"con_{index:03d}",
        conflict_type=conflict_type,
        severity=severity,
        summary=_conflict_summary(conflict_type, left, right),
        claims=[
            ConflictClaim(statement=left.sentence, citation=left.citation, source=left.source),
            ConflictClaim(statement=right.sentence, citation=right.citation, source=right.source),
        ],
        recommendation="Route both cited sources to document owner or gestor review before relying on either rule.",
        confidence=confidence,
    )


def _approval_target(text: str) -> str | None:
    match = re.search(r"\bschvaluje\s+([a-z0-9_ -]{3,80})", text)
    if not match:
        return None
    target = match.group(1)
    target = re.split(r"[.;,]| po | pokud | kdyz | a ", target)[0]
    return " ".join(target.split()[:4]).strip() or None


def _deadline_days(text: str) -> int | None:
    match = re.search(r"\b(\d{1,3})\s*(dni|dnu|dny|days|day)\b", text)
    if not match:
        return None
    return int(match.group(1))


def _is_negative(text: str) -> bool:
    return any(token in text for token in ["nesmi", "zakazano", "zakazuje", "neni povoleno"])


def _is_positive(text: str) -> bool:
    return any(token in text for token in ["musi", "povoleno", "povoluje", "je povoleno", "vyzaduje"])


def _severity_and_confidence(conflict_type: ConflictType) -> tuple[FindingSeverity, Confidence]:
    if conflict_type == "normative_polarity":
        return "critical", "high"
    if conflict_type == "approval_owner_mismatch":
        return "error", "medium"
    if conflict_type == "deadline_mismatch":
        return "warning", "medium"
    return "warning", "low"


def _conflict_summary(conflict_type: ConflictType, left: AnalyzedSentence, right: AnalyzedSentence) -> str:
    if conflict_type == "approval_owner_mismatch":
        return "Sources name different approving roles for a similar topic."
    if conflict_type == "deadline_mismatch":
        return "Sources state different deadlines for a similar topic."
    if conflict_type == "normative_polarity":
        return "Sources contain opposing normative statements for a similar topic."
    return "Sources overlap on topic but may not be mutually consistent."


def _norm(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    without_accents = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_accents.lower()).strip()


def _tokens(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9_]{4,}", text) if token not in STOPWORDS}


def _overall_confidence(conflicts: list[ConflictFinding], analyzed: list[AnalyzedSentence]) -> Confidence:
    if not analyzed:
        return "insufficient_source"
    if any(conflict.confidence == "high" for conflict in conflicts):
        return "conflicting_sources"
    if conflicts:
        return "conflicting_sources"
    return "medium"


def _summary(conflicts: list[ConflictFinding], analyzed: list[AnalyzedSentence]) -> str:
    if not analyzed:
        return "No source text was available for conflict detection."
    if not conflicts:
        return f"No direct conflicts detected across {len(analyzed)} analyzed sentence(s)."
    return f"Detected {len(conflicts)} potential conflict(s) across {len(analyzed)} analyzed sentence(s)."
