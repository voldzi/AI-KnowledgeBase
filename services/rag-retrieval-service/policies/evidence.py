from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import re

from app.config import Settings
from app.llm_client import LLMGatewayClient
from app.schemas import RagAnswer, RetrievedChunk
from app.security import AuthContext
from policies.no_answer import NO_ANSWER_TEXT
from retrievers.scoring import normalize_text

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EvidenceAssessment:
    claims: list[dict[str, object]]
    status: str
    unsupported_main_claim: bool


class EvidenceGate:
    def __init__(self, settings: Settings, llm_client: LLMGatewayClient | None = None) -> None:
        self._settings = settings
        self._llm_client = llm_client

    def verify(self, answer: RagAnswer, chunks: list[RetrievedChunk]) -> RagAnswer:
        if self._settings.evidence_gate_mode == "off" or not answer.answer:
            return answer
        assessment = self._assess(answer.answer, chunks)
        return self._apply(answer, assessment, verifier="deterministic-token-support-v1")

    async def verify_async(
        self,
        answer: RagAnswer,
        chunks: list[RetrievedChunk],
        *,
        auth_context: AuthContext | None = None,
    ) -> RagAnswer:
        if self._settings.evidence_gate_mode == "off" or not answer.answer:
            return answer
        model = self._settings.evidence_verifier_model
        if not model or self._llm_client is None:
            return self.verify(answer, chunks)
        try:
            raw = await self._llm_client.chat_completion(
                messages=_verification_messages(answer.answer, chunks),
                metadata={
                    "purpose": "rag_claim_evidence_verification",
                    "used_chunk_ids": [chunk.chunk_id for chunk in chunks],
                    "content_logged": False,
                },
                model=model,
                auth_context=auth_context,
            )
            assessment = _model_assessment(
                raw,
                chunks,
                answer=answer.answer,
                min_overlap=self._settings.evidence_min_overlap,
            )
            return self._apply(answer, assessment, verifier=model)
        except Exception as exc:
            logger.warning(
                "evidence_verifier_failed mode=%s reason=%s content_logged=false",
                self._settings.evidence_gate_mode,
                exc.__class__.__name__,
            )
            if self._settings.evidence_gate_mode == "enforce":
                return self._verification_failure(answer, model)
            fallback = self.verify(answer, chunks)
            return fallback.model_copy(
                update={
                    "warnings": list(
                        dict.fromkeys([*fallback.warnings, "EVIDENCE_VERIFIER_FALLBACK"])
                    )
                }
            )

    def _apply(
        self,
        answer: RagAnswer,
        assessment: EvidenceAssessment,
        *,
        verifier: str,
    ) -> RagAnswer:
        update = {
            "claims": assessment.claims,
            "evidence_status": assessment.status,
            "verification_model": verifier,
        }
        warnings = list(answer.warnings)
        if assessment.status != "supported":
            warnings.append("EVIDENCE_GATE_UNSUPPORTED_CLAIMS")
        if self._settings.evidence_gate_mode == "enforce" and assessment.unsupported_main_claim:
            return answer.model_copy(
                update={
                    **update,
                    "answer": NO_ANSWER_TEXT,
                    "confidence": "insufficient_source",
                    "citations": [],
                    "used_chunks": [],
                    "warnings": warnings,
                    "missing_information": "Hlavní tvrzení nebylo dostatečně podloženo autorizovanými zdroji.",
                }
            )
        if self._settings.evidence_gate_mode == "enforce" and assessment.status == "partial":
            supported_claims = [
                str(item["claim"])
                for item in assessment.claims
                if bool(item["supported"])
            ]
            supported_chunk_ids = {
                str(chunk_id)
                for item in assessment.claims
                if bool(item["supported"])
                for chunk_id in item["chunk_ids"]
            }
            return answer.model_copy(
                update={
                    **update,
                    "answer": " ".join(supported_claims),
                    "citations": [
                        citation
                        for citation in answer.citations
                        if citation.chunk_id in supported_chunk_ids
                    ],
                    "used_chunks": [
                        chunk_id for chunk_id in answer.used_chunks if chunk_id in supported_chunk_ids
                    ],
                    "warnings": [*warnings, "UNSUPPORTED_SECONDARY_CLAIMS_REMOVED"],
                }
            )
        return answer.model_copy(update={**update, "warnings": warnings})

    def _verification_failure(self, answer: RagAnswer, verifier: str) -> RagAnswer:
        return answer.model_copy(
            update={
                "answer": NO_ANSWER_TEXT,
                "confidence": "insufficient_source",
                "citations": [],
                "used_chunks": [],
                "claims": [],
                "evidence_status": "unsupported",
                "verification_model": verifier,
                "warnings": list(
                    dict.fromkeys([*answer.warnings, "EVIDENCE_VERIFIER_UNAVAILABLE"])
                ),
                "missing_information": "Ověření podpory tvrzení nebylo dostupné.",
            }
        )

    def _assess(self, text: str, chunks: list[RetrievedChunk]) -> EvidenceAssessment:
        sentences = [item.strip() for item in re.split(r"(?<=[.!?])\s+|\n+", text) if len(item.strip()) >= 12]
        claims: list[dict[str, object]] = []
        unsupported_main = False
        for index, sentence in enumerate(sentences):
            sentence_tokens = _tokens(sentence)
            best_chunk: RetrievedChunk | None = None
            best_overlap = 0.0
            for chunk in chunks:
                overlap = _overlap(sentence_tokens, _evidence_tokens(chunk))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_chunk = chunk
            supported = best_chunk is not None and best_overlap >= self._settings.evidence_min_overlap
            if index == 0 and not supported:
                unsupported_main = True
            claims.append(
                {
                    "claim": sentence,
                    "claim_type": "main" if index == 0 else "supporting",
                    "chunk_ids": [best_chunk.chunk_id] if supported and best_chunk else [],
                    "quoted_support": best_chunk.text[:280] if supported and best_chunk else None,
                    "supported": supported,
                    "support_score": round(best_overlap, 4),
                }
            )
        status = "supported" if claims and all(bool(item["supported"]) for item in claims) else "partial"
        if not claims or all(not bool(item["supported"]) for item in claims):
            status = "unsupported"
            unsupported_main = True
        return EvidenceAssessment(claims, status, unsupported_main)


def _tokens(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]{3,}", normalize_text(value))
        if token not in {"který", "která", "které", "tento", "tato", "jsou", "bude", "with", "that", "this"}
    }


def _overlap(claim: set[str], evidence: set[str]) -> float:
    if not claim:
        return 0.0
    return len(claim & evidence) / len(claim)


def _evidence_text(chunk: RetrievedChunk) -> str:
    citation = chunk.citation
    return "\n".join(
        value
        for value in (
            citation.document_title,
            " > ".join(citation.section_path),
            chunk.text,
        )
        if value
    )


def _evidence_tokens(chunk: RetrievedChunk) -> set[str]:
    return _tokens(_evidence_text(chunk))


def _verification_messages(answer: str, chunks: list[RetrievedChunk]) -> list[dict[str, str]]:
    context = [
        {
            "chunk_id": chunk.chunk_id,
            "document_title": chunk.citation.document_title,
            "section_path": chunk.citation.section_path,
            "text": chunk.text,
        }
        for chunk in chunks
    ]
    return [
        {
            "role": "system",
            "content": (
                "Return JSON only. Decompose the answer into factual claims. For each claim return "
                "claim, claim_type (main or supporting), chunk_ids, and quoted_support. Use only "
                "the supplied chunk ids and copy quoted_support verbatim from one supplied chunk."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {"answer": answer, "authorized_context": context},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        },
    ]


def _model_assessment(
    raw: str,
    chunks: list[RetrievedChunk],
    *,
    answer: str,
    min_overlap: float = 0.18,
) -> EvidenceAssessment:
    stripped = raw.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", stripped, flags=re.I)
    parsed = json.loads(stripped)
    items = parsed.get("claims") if isinstance(parsed, dict) else parsed
    if not isinstance(items, list) or not items or len(items) > 100:
        raise ValueError("verifier returned no claims")
    by_id = {chunk.chunk_id: chunk for chunk in chunks}
    claims: list[dict[str, object]] = []
    unsupported_main = False
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError("verifier claim is invalid")
        claim = item.get("claim")
        quote = item.get("quoted_support")
        chunk_ids = item.get("chunk_ids")
        claim_type = "main" if index == 0 else "supporting"
        if item.get("claim_type") in {"main", "supporting"}:
            claim_type = item["claim_type"]
        if not isinstance(claim, str) or not claim.strip():
            raise ValueError("verifier claim text is invalid")
        valid_ids = [
            chunk_id
            for chunk_id in chunk_ids
            if isinstance(chunk_id, str) and chunk_id in by_id
        ] if isinstance(chunk_ids, list) else []
        supported = (
            isinstance(quote, str)
            and bool(quote.strip())
            and any(quote.strip() in _evidence_text(by_id[chunk_id]) for chunk_id in valid_ids)
            and _overlap(_tokens(claim), _tokens(quote)) >= min_overlap
        )
        if claim_type == "main" and not supported:
            unsupported_main = True
        claims.append(
            {
                "claim": claim.strip(),
                "claim_type": claim_type,
                "chunk_ids": valid_ids if supported else [],
                "quoted_support": quote.strip() if supported else None,
                "supported": supported,
                "support_score": 1.0 if supported else 0.0,
            }
        )
    if claims[0]["claim_type"] != "main":
        claims[0]["claim_type"] = "main"
        if not bool(claims[0]["supported"]):
            unsupported_main = True
    answer_sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+|\n+", answer)
        if len(sentence.strip()) >= 12
    ]
    for sentence_index, sentence in enumerate(answer_sentences):
        sentence_tokens = _tokens(sentence)
        covered = any(
            _overlap(sentence_tokens, _tokens(str(item["claim"]))) >= 0.5
            for item in claims
        )
        if covered:
            continue
        claim_type = "main" if sentence_index == 0 else "supporting"
        claims.append(
            {
                "claim": sentence,
                "claim_type": claim_type,
                "chunk_ids": [],
                "quoted_support": None,
                "supported": False,
                "support_score": 0.0,
            }
        )
        if claim_type == "main":
            unsupported_main = True
    status = "supported" if all(bool(item["supported"]) for item in claims) else "partial"
    if all(not bool(item["supported"]) for item in claims):
        status = "unsupported"
        unsupported_main = True
    return EvidenceAssessment(claims, status, unsupported_main)
