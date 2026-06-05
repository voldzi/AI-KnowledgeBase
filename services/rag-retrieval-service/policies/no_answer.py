from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings
from app.schemas import Confidence, RagAnswer, RetrievedChunk

NO_ANSWER_TEXT = "K dotazu nebyl nalezen dostatecne oporyhodny zdroj v povolenych dokumentech."


@dataclass(frozen=True)
class PolicyDecision:
    can_answer: bool
    confidence: Confidence
    warnings: list[str]
    missing_information: str | None


class NoAnswerPolicy:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def evaluate(
        self,
        *,
        chunks: list[RetrievedChunk],
        had_candidates: bool,
        denied_document_ids: set[str],
    ) -> PolicyDecision:
        if not chunks:
            warnings = ["NO_AUTHORIZED_SOURCE" if had_candidates else "NO_RETRIEVAL_MATCH"]
            if self._authz_filtered(denied_document_ids):
                warnings.append("AUTHZ_FILTERED_SOURCES")
            return PolicyDecision(
                can_answer=False,
                confidence="insufficient_source",
                warnings=warnings,
                missing_information="Chybi citovatelny chunk v povolenych dokumentech.",
            )

        missing_citation = [chunk.chunk_id for chunk in chunks if not chunk.citation.document_id]
        if missing_citation:
            return PolicyDecision(
                can_answer=False,
                confidence="insufficient_source",
                warnings=["MISSING_CITATION"],
                missing_information="Nalezeny chunk nema dostatecna citacni metadata.",
            )

        top_score = chunks[0].score
        if top_score < self._settings.no_answer_min_score:
            warnings = ["LOW_RELEVANCE"]
            if self._authz_filtered(denied_document_ids):
                warnings.append("AUTHZ_FILTERED_SOURCES")
            return PolicyDecision(
                can_answer=False,
                confidence="insufficient_source",
                warnings=warnings,
                missing_information="Nejlepsi nalezeny zdroj nema dostatecnou relevanci.",
            )

        warnings = (
            ["AUTHZ_FILTERED_SOURCES"]
            if self._authz_filtered(denied_document_ids)
            else []
        )
        if top_score >= self._settings.confidence_high_threshold:
            confidence: Confidence = "high"
        elif top_score >= self._settings.confidence_medium_threshold:
            confidence = "medium"
        else:
            confidence = "low"

        return PolicyDecision(
            can_answer=True,
            confidence=confidence,
            warnings=warnings,
            missing_information=None,
        )

    def no_answer(self, *, query_id: str, decision: PolicyDecision) -> RagAnswer:
        return RagAnswer(
            query_id=query_id,
            answer=NO_ANSWER_TEXT,
            confidence=decision.confidence,
            citations=[],
            warnings=decision.warnings,
            used_chunks=[],
            missing_information=decision.missing_information,
        )

    def _authz_filtered(self, denied_document_ids: set[str]) -> bool:
        return self._settings.authz_mode == "registry" and bool(denied_document_ids)
