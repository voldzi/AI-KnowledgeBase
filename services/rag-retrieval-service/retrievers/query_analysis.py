from __future__ import annotations

from dataclasses import dataclass
import re

from app.schemas import RagQueryFilters


@dataclass(frozen=True)
class RetrievalPlan:
    profile: str
    candidate_limit: int
    dense_weight: float
    max_documents: int
    require_multiple_documents: bool = False


_DATE_RE = re.compile(r"\b(?:19|20)\d{2}(?:[-/.]\d{1,2}(?:[-/.]\d{1,2})?)?\b")
_IDENTIFIER_RE = re.compile(r"\b(?:[A-Z]{2,}[A-Z0-9_-]*[-/]\d{2,}|doc_[a-z0-9]+|ver_[a-z0-9]+)\b", re.I)
_COMPARE_RE = re.compile(r"\b(porovnej|porovnání|rozdíl|oproti|compare|difference|konflikt|rozpor)\b", re.I)
_LIVE_RE = re.compile(r"\b(aktuální rozpočet|čerpání|stav projektu|milník|úkol|live data|dnes)\b", re.I)


def analyze_query(
    query: str,
    filters: RagQueryFilters,
    *,
    default_candidate_limit: int,
    default_dense_weight: float,
) -> RetrievalPlan:
    explicit_documents = bool(filters.document_ids or filters.document_version_ids)
    has_identifier = bool(_IDENTIFIER_RE.search(query))
    has_date = bool(_DATE_RE.search(query))
    is_comparison = bool(_COMPARE_RE.search(query))

    if _LIVE_RE.search(query):
        return RetrievalPlan("copilot_live_data", 50, 0.25, 6)
    if is_comparison:
        return RetrievalPlan("cross_document", 100, 0.45, 12, require_multiple_documents=True)
    if explicit_documents:
        return RetrievalPlan("document_scoped", 64, 0.45, max(1, len(filters.document_ids) or 2))
    if has_identifier:
        return RetrievalPlan("exact", 50, 0.15, 6)
    if has_date:
        return RetrievalPlan("temporal", 80, 0.35, 8)
    return RetrievalPlan(
        "semantic",
        max(64, min(100, default_candidate_limit)),
        default_dense_weight,
        10,
    )
