from __future__ import annotations

import difflib
from itertools import zip_longest

from app.evidence import citation_for_version, excerpt, source_for_version, unique_citations, unique_sources
from app.schemas import (
    ChangeImpact,
    ChangeItem,
    CompareVersionsResponse,
    Confidence,
    DocumentVersionContent,
)

MATERIAL_KEYWORDS = {
    "musi",
    "nesmi",
    "schvaluje",
    "schvaleni",
    "vyjimka",
    "vyjimku",
    "platnost",
    "ucinnost",
    "odpovednost",
    "opravneni",
    "klasifikace",
    "audit",
}


class DocumentDiffEngine:
    def compare(
        self,
        *,
        result_id: str,
        left: DocumentVersionContent,
        right: DocumentVersionContent,
        include_unchanged: bool,
    ) -> CompareVersionsResponse:
        left_paragraphs = _paragraphs(left.content)
        right_paragraphs = _paragraphs(right.content)
        matcher = difflib.SequenceMatcher(a=[_norm(item) for item in left_paragraphs], b=[_norm(item) for item in right_paragraphs])

        changes: list[ChangeItem] = []
        counts = {"added": 0, "removed": 0, "modified": 0, "unchanged": 0}
        change_index = 1

        for tag, left_start, left_end, right_start, right_end in matcher.get_opcodes():
            if tag == "equal":
                counts["unchanged"] += left_end - left_start
                if include_unchanged:
                    for left_offset, paragraph in enumerate(left_paragraphs[left_start:left_end], start=left_start + 1):
                        citation = citation_for_version(
                            right,
                            chunk_id=_paragraph_chunk_id(right.document_version_id, left_offset),
                            section_path=[f"paragraph:{left_offset}"],
                            source_excerpt=excerpt(paragraph),
                        )
                        changes.append(
                            ChangeItem(
                                change_id=f"chg_{change_index:03d}",
                                change_type="unchanged",
                                impact="none",
                                before_text=excerpt(paragraph, 1200),
                                after_text=excerpt(paragraph, 1200),
                                before_citation=citation,
                                after_citation=citation,
                                citations=[citation],
                                confidence="high",
                                rationale="Paragraph is unchanged between compared versions.",
                            )
                        )
                        change_index += 1
                continue

            if tag == "delete":
                for left_offset, paragraph in enumerate(left_paragraphs[left_start:left_end], start=left_start + 1):
                    citation = citation_for_version(
                        left,
                        chunk_id=_paragraph_chunk_id(left.document_version_id, left_offset),
                        section_path=[f"paragraph:{left_offset}"],
                        source_excerpt=excerpt(paragraph),
                    )
                    changes.append(
                        ChangeItem(
                            change_id=f"chg_{change_index:03d}",
                            change_type="removed",
                            impact=_impact(paragraph),
                            before_text=excerpt(paragraph, 1200),
                            after_text=None,
                            before_citation=citation,
                            after_citation=None,
                            citations=[citation],
                            confidence=_confidence_for_text(paragraph),
                            rationale="Paragraph exists only in the left version.",
                        )
                    )
                    counts["removed"] += 1
                    change_index += 1
                continue

            if tag == "insert":
                for right_offset, paragraph in enumerate(right_paragraphs[right_start:right_end], start=right_start + 1):
                    citation = citation_for_version(
                        right,
                        chunk_id=_paragraph_chunk_id(right.document_version_id, right_offset),
                        section_path=[f"paragraph:{right_offset}"],
                        source_excerpt=excerpt(paragraph),
                    )
                    changes.append(
                        ChangeItem(
                            change_id=f"chg_{change_index:03d}",
                            change_type="added",
                            impact=_impact(paragraph),
                            before_text=None,
                            after_text=excerpt(paragraph, 1200),
                            before_citation=None,
                            after_citation=citation,
                            citations=[citation],
                            confidence=_confidence_for_text(paragraph),
                            rationale="Paragraph exists only in the right version.",
                        )
                    )
                    counts["added"] += 1
                    change_index += 1
                continue

            for left_item, right_item in zip_longest(
                enumerate(left_paragraphs[left_start:left_end], start=left_start + 1),
                enumerate(right_paragraphs[right_start:right_end], start=right_start + 1),
            ):
                if left_item is None:
                    right_offset, right_paragraph = right_item  # type: ignore[misc]
                    citation = citation_for_version(
                        right,
                        chunk_id=_paragraph_chunk_id(right.document_version_id, right_offset),
                        section_path=[f"paragraph:{right_offset}"],
                        source_excerpt=excerpt(right_paragraph),
                    )
                    changes.append(
                        ChangeItem(
                            change_id=f"chg_{change_index:03d}",
                            change_type="added",
                            impact=_impact(right_paragraph),
                            before_text=None,
                            after_text=excerpt(right_paragraph, 1200),
                            before_citation=None,
                            after_citation=citation,
                            citations=[citation],
                            confidence=_confidence_for_text(right_paragraph),
                            rationale="Paragraph was added inside a replaced block.",
                        )
                    )
                    counts["added"] += 1
                elif right_item is None:
                    left_offset, left_paragraph = left_item
                    citation = citation_for_version(
                        left,
                        chunk_id=_paragraph_chunk_id(left.document_version_id, left_offset),
                        section_path=[f"paragraph:{left_offset}"],
                        source_excerpt=excerpt(left_paragraph),
                    )
                    changes.append(
                        ChangeItem(
                            change_id=f"chg_{change_index:03d}",
                            change_type="removed",
                            impact=_impact(left_paragraph),
                            before_text=excerpt(left_paragraph, 1200),
                            after_text=None,
                            before_citation=citation,
                            after_citation=None,
                            citations=[citation],
                            confidence=_confidence_for_text(left_paragraph),
                            rationale="Paragraph was removed inside a replaced block.",
                        )
                    )
                    counts["removed"] += 1
                else:
                    left_offset, left_paragraph = left_item
                    right_offset, right_paragraph = right_item
                    before_citation = citation_for_version(
                        left,
                        chunk_id=_paragraph_chunk_id(left.document_version_id, left_offset),
                        section_path=[f"paragraph:{left_offset}"],
                        source_excerpt=excerpt(left_paragraph),
                    )
                    after_citation = citation_for_version(
                        right,
                        chunk_id=_paragraph_chunk_id(right.document_version_id, right_offset),
                        section_path=[f"paragraph:{right_offset}"],
                        source_excerpt=excerpt(right_paragraph),
                    )
                    changes.append(
                        ChangeItem(
                            change_id=f"chg_{change_index:03d}",
                            change_type="modified",
                            impact=_combined_impact(left_paragraph, right_paragraph),
                            before_text=excerpt(left_paragraph, 1200),
                            after_text=excerpt(right_paragraph, 1200),
                            before_citation=before_citation,
                            after_citation=after_citation,
                            citations=[before_citation, after_citation],
                            confidence=_confidence_for_pair(left_paragraph, right_paragraph),
                            rationale="Paragraph text changed between compared versions.",
                        )
                    )
                    counts["modified"] += 1
                change_index += 1

        left_source_citation = citation_for_version(
            left,
            chunk_id=f"input:{left.document_version_id}",
            source_excerpt=excerpt(left.content),
        )
        right_source_citation = citation_for_version(
            right,
            chunk_id=f"input:{right.document_version_id}",
            source_excerpt=excerpt(right.content),
        )
        sources = unique_sources(
            [
                source_for_version(left, source_id=f"left:{left.document_version_id}", citation=left_source_citation),
                source_for_version(right, source_id=f"right:{right.document_version_id}", citation=right_source_citation),
            ]
        )
        citations = unique_citations(
            [citation for change in changes for citation in change.citations]
            or [left_source_citation, right_source_citation]
        )
        materiality_score = _materiality_score(changes)
        confidence = _overall_confidence(left_paragraphs, right_paragraphs, changes)

        return CompareVersionsResponse(
            result_id=result_id,
            document_id=right.document_id,
            left_version_id=left.document_version_id,
            right_version_id=right.document_version_id,
            summary=_summary(counts, materiality_score),
            change_counts=counts,
            materiality_score=materiality_score,
            changes=changes,
            citations=citations,
            sources=sources,
            confidence=confidence,
            warnings=[],
            missing_information=None if citations else "No comparable source paragraphs were found.",
        )


def _paragraphs(text: str) -> list[str]:
    blocks = [block.strip() for block in text.replace("\r\n", "\n").split("\n\n") if block.strip()]
    if len(blocks) <= 1:
        blocks = [line.strip() for line in text.replace("\r\n", "\n").splitlines() if line.strip()]
    return blocks


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def _paragraph_chunk_id(version_id: str, paragraph_index: int) -> str:
    return f"input:{version_id}:p{paragraph_index}"


def _impact(text: str) -> ChangeImpact:
    lowered = _norm(text)
    hits = sum(1 for keyword in MATERIAL_KEYWORDS if keyword in lowered)
    if hits >= 3 or ("nesmi" in lowered and "musi" in lowered):
        return "critical"
    if hits >= 1 or len(text) > 600:
        return "material"
    if len(text) > 120:
        return "minor"
    return "minor"


def _combined_impact(left: str, right: str) -> ChangeImpact:
    impacts = [_impact(left), _impact(right)]
    if "critical" in impacts:
        return "critical"
    if "material" in impacts:
        return "material"
    if _similarity(left, right) < 0.6:
        return "material"
    return "minor"


def _confidence_for_text(text: str) -> Confidence:
    return "high" if len(text.strip()) >= 40 else "medium"


def _confidence_for_pair(left: str, right: str) -> Confidence:
    if len(left.strip()) < 20 or len(right.strip()) < 20:
        return "medium"
    return "high" if _similarity(left, right) >= 0.25 else "medium"


def _similarity(left: str, right: str) -> float:
    return difflib.SequenceMatcher(a=_norm(left), b=_norm(right)).ratio()


def _materiality_score(changes: list[ChangeItem]) -> float:
    if not changes:
        return 0.0
    weights = {"none": 0.0, "minor": 0.25, "material": 0.7, "critical": 1.0}
    score = sum(weights[change.impact] for change in changes) / len(changes)
    return round(min(score, 1.0), 4)


def _overall_confidence(left_paragraphs: list[str], right_paragraphs: list[str], changes: list[ChangeItem]) -> Confidence:
    if not left_paragraphs or not right_paragraphs:
        return "insufficient_source"
    if not changes:
        return "medium"
    if all(change.confidence == "high" for change in changes):
        return "high"
    return "medium"


def _summary(counts: dict[str, int], materiality_score: float) -> str:
    changed = counts["added"] + counts["removed"] + counts["modified"]
    if changed == 0:
        return "Compared versions do not contain detected paragraph-level changes."
    return (
        f"Detected {changed} paragraph-level change(s): {counts['added']} added, "
        f"{counts['removed']} removed, {counts['modified']} modified. "
        f"Materiality score is {materiality_score:.2f}."
    )
