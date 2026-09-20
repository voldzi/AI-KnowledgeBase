from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal

from app.schemas import AnswerMode, RetrievedChunk


RoutingMode = Literal["cost_optimized", "external_preferred", "local_only"]
ModelTier = Literal[
    "local_standard",
    "local_high_quality",
    "external_economy",
    "external_standard",
    "external_premium",
]


_COMPLEX_QUERY_RE = re.compile(
    r"\b(?:"
    r"analyz\w*|vyhodno\w*|porovn\w*|rozd[ií]l\w*|dopad\w*|rizik\w*|"
    r"v[yý]jimk\w*|rozpor\w*|konflikt\w*|souvislost\w*|"
    r"compare\w*|analys\w*|evaluat\w*|exception\w*|impact\w*|"
    r"risk\w*|conflict\w*|relationship\w*"
    r")\b",
    re.IGNORECASE,
)
_MULTI_FACET_RE = re.compile(
    r"(?:\?|;|\b(?:a\s+z[aá]rove[nň]|sou[cč]asn[eě]|v[cč]etn[eě]|and also|as well as)\b)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ModelRoute:
    model: str | None
    effective_model: str
    tier: ModelTier
    complexity_score: int
    reason_codes: tuple[str, ...]
    external_processing: bool

    def metadata(self, mode: RoutingMode) -> dict[str, object]:
        return {
            "mode": mode,
            "tier": self.tier,
            "complexity_score": self.complexity_score,
            "reason_codes": list(self.reason_codes),
            "external_processing": self.external_processing,
        }


def select_model_route(
    *,
    query: str,
    answer_mode: AnswerMode,
    selected_chunks: list[RetrievedChunk],
    truncated: bool,
    routing_mode: RoutingMode,
    external_processing_allowed: bool,
    local_model: str,
    local_high_quality_model: str | None,
    external_economy_model: str | None,
    external_model: str | None,
    external_premium_model: str | None,
    external_complexity_threshold: int,
    external_premium_complexity_threshold: int,
    high_quality_min_context_chunks: int,
) -> ModelRoute:
    """Choose an auditable model tier without asking any model to route itself.

    The decision uses only bounded request characteristics and already-authorized
    source metadata. Document text is never sent to a separate classifier.
    """
    score, reasons = _complexity(
        query=query,
        answer_mode=answer_mode,
        selected_chunks=selected_chunks,
        truncated=truncated,
        high_quality_min_context_chunks=high_quality_min_context_chunks,
        context_only_cap=max(0, external_complexity_threshold - 1),
    )

    external_allowed = (
        routing_mode != "local_only"
        and external_processing_allowed
        and bool(external_economy_model or external_model or external_premium_model)
    )
    external_requested = (
        routing_mode == "external_preferred"
        or score >= external_complexity_threshold
    )

    if external_allowed and external_requested:
        if (
            external_premium_model
            and score >= external_premium_complexity_threshold
        ):
            return ModelRoute(
                model=external_premium_model,
                effective_model=external_premium_model,
                tier="external_premium",
                complexity_score=score,
                reason_codes=(*reasons, "EXTERNAL_PREMIUM_THRESHOLD"),
                external_processing=True,
            )
        selected_external = external_model or external_premium_model or external_economy_model
        assert selected_external is not None
        selected_tier: ModelTier = (
            "external_economy"
            if selected_external == external_economy_model
            else "external_standard"
        )
        return ModelRoute(
            model=selected_external,
            effective_model=selected_external,
            tier=selected_tier,
            complexity_score=score,
            reason_codes=(
                *reasons,
                "EXTERNAL_ECONOMY_FALLBACK"
                if selected_tier == "external_economy"
                else "EXTERNAL_QUALITY_THRESHOLD",
            ),
            external_processing=True,
        )

    if external_allowed and external_economy_model:
        return ModelRoute(
            model=external_economy_model,
            effective_model=external_economy_model,
            tier="external_economy",
            complexity_score=score,
            reason_codes=(*reasons, "EXTERNAL_ECONOMY_ROUTE"),
            external_processing=True,
        )

    needs_high_quality = score >= external_complexity_threshold
    if needs_high_quality and local_high_quality_model:
        local_reason = (
            "EXTERNAL_POLICY_DENIED"
            if not external_processing_allowed
            else "LOCAL_ROUTING_REQUIRED"
            if routing_mode == "local_only"
            else "EXTERNAL_MODEL_UNAVAILABLE"
        )
        return ModelRoute(
            model=local_high_quality_model,
            effective_model=local_high_quality_model,
            tier="local_high_quality",
            complexity_score=score,
            reason_codes=(*reasons, local_reason),
            external_processing=False,
        )

    return ModelRoute(
        # Always bind the local model explicitly. The gateway default may be
        # an external provider, so omitting the model would silently defeat
        # both the cost route and the document processing policy.
        model=local_model,
        effective_model=local_model,
        tier="local_standard",
        complexity_score=score,
        reason_codes=(*reasons, "LOCAL_COST_OPTIMIZED"),
        external_processing=False,
    )


def _complexity(
    *,
    query: str,
    answer_mode: AnswerMode,
    selected_chunks: list[RetrievedChunk],
    truncated: bool,
    high_quality_min_context_chunks: int,
    context_only_cap: int,
) -> tuple[int, tuple[str, ...]]:
    request_score = 0
    context_score = 0
    reasons: list[str] = []

    if answer_mode in {
        "compare",
        "compare_documents",
        "summary",
        "extract_obligations",
        "extract_roles",
        "extract_deadlines",
        "extract_risks",
        "create_checklist",
        "create_faq",
        "create_kb_article",
        "find_conflicts",
        "find_missing_metadata",
        "explain_process",
        "manager_brief",
        "audit_question",
    }:
        request_score += 3
        reasons.append("COMPLEX_ANSWER_MODE")
    if truncated:
        context_score += 4
        reasons.append("TRUNCATED_CONTEXT")

    document_versions = {
        (chunk.citation.document_id, chunk.citation.document_version_id)
        for chunk in selected_chunks
    }
    if len(document_versions) > 1:
        context_score += 3
        reasons.append("MULTI_DOCUMENT_CONTEXT")
    if len(selected_chunks) >= high_quality_min_context_chunks:
        # Retrieval commonly returns eight chunks even for a simple lookup.
        # Cardinality alone must not turn an inexpensive lookup into an
        # external request; it becomes decisive only together with another
        # complexity signal.
        context_score += 1
        reasons.append("LARGE_CONTEXT_SET")
    if sum(len(chunk.text) for chunk in selected_chunks) > 6000:
        context_score += 1
        reasons.append("LARGE_CONTEXT_TEXT")
    if len(query) > 280:
        request_score += 1
        reasons.append("LONG_QUERY")
    if _COMPLEX_QUERY_RE.search(query):
        request_score += 3
        reasons.append("COMPLEX_DOMAIN_SIGNAL")
    if len(_MULTI_FACET_RE.findall(query)) > 1:
        request_score += 2
        reasons.append("MULTI_FACET_QUERY")

    if not reasons:
        reasons.append("SIMPLE_BOUNDED_QUERY")
    if request_score == 0 and context_score > context_only_cap:
        # Retrieval breadth describes the search result, not necessarily the
        # user's reasoning need. A simple factual question must stay on the
        # internal model even when retrieval finds several documents or trims
        # surplus candidates. Complex wording/modes still unlock the full
        # context contribution.
        context_score = context_only_cap
        reasons.append("CONTEXT_ONLY_COST_CAP")
    score = request_score + context_score
    return score, tuple(reasons)
