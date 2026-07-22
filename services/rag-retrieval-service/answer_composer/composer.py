from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
from typing import AsyncIterator

from app.config import Settings
from app.llm_client import LLMGatewayClient
from app.schemas import (
    AnswerMode,
    Citation,
    CitationPolicySummary,
    Confidence,
    RagAnswer,
    ResponseLanguage,
    RetrievedChunk,
)
from app.security import AuthContext
from policies.no_answer import NO_ANSWER_TEXT


HIGH_QUALITY_ANSWER_MODES: frozenset[AnswerMode] = frozenset(
    {
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
    }
)


@dataclass
class StreamEvent:
    kind: str  # "meta" | "delta" | "done"
    delta: str = field(default="")
    answer: RagAnswer | None = field(default=None)


class AnswerComposer:
    def __init__(self, settings: Settings, llm_client: LLMGatewayClient) -> None:
        self._settings = settings
        self._llm_client = llm_client

    async def compose(
        self,
        *,
        query_id: str,
        query: str,
        chunks: list[RetrievedChunk],
        confidence: Confidence,
        warnings: list[str],
        max_chunks: int,
        answer_mode: AnswerMode = "normative_with_citations",
        response_language: ResponseLanguage = "cs",
        auth_context: AuthContext | None = None,
    ) -> RagAnswer:
        selected, truncated = self._select_context(chunks[:max_chunks])
        selected_chat_model = self._select_chat_model(
            answer_mode=answer_mode,
            selected_chunks=selected,
            truncated=truncated,
        )
        messages = [
            {
                "role": "system",
                "content": _system_prompt(answer_mode, response_language),
            },
            {
                "role": "user",
                "content": _build_user_prompt(query=query, chunks=selected, response_language=response_language),
            },
        ]
        answer = await self._llm_client.chat_completion(
            messages=messages,
            metadata={
                "purpose": "rag_answer_composition",
                "answer_mode": answer_mode,
                "response_language": response_language,
                "query_id": query_id,
                "chunk_count": len(selected),
                "used_chunk_ids": [chunk.chunk_id for chunk in selected],
                "chat_model": selected_chat_model or self._settings.chat_model,
                "chat_model_tier": "high_quality" if selected_chat_model else "standard",
                **_policy_metadata(selected),
            },
            model=selected_chat_model,
            auth_context=auth_context,
        )

        if not answer:
            return RagAnswer(
                query_id=query_id,
                answer=NO_ANSWER_TEXT,
                confidence="insufficient_source",
                citations=[],
                warnings=[*warnings, "LLM_EMPTY_ANSWER"],
                used_chunks=[],
                missing_information="LLM Gateway nevratil odpoved.",
            )

        response_warnings = _merge_warnings(warnings, _source_quality_warnings(selected))
        if truncated:
            response_warnings = _merge_warnings(response_warnings, ["CONTEXT_TRUNCATED"])

        return RagAnswer(
            query_id=query_id,
            answer=answer,
            confidence=confidence,
            citations=_citations(selected),
            warnings=response_warnings,
            used_chunks=[chunk.chunk_id for chunk in selected],
            missing_information=None,
            policy_bindings=_answer_policy_bindings(selected),
            obligations=list(_policy_metadata(selected).get("obligations", [])),
        )

    async def compose_stream(
        self,
        *,
        query_id: str,
        query: str,
        chunks: list[RetrievedChunk],
        confidence: Confidence,
        warnings: list[str],
        max_chunks: int,
        answer_mode: AnswerMode = "normative_with_citations",
        response_language: ResponseLanguage = "cs",
        auth_context: AuthContext | None = None,
    ) -> "AsyncIterator[StreamEvent]":
        selected, truncated = self._select_context(chunks[:max_chunks])
        selected_chat_model = self._select_chat_model(
            answer_mode=answer_mode,
            selected_chunks=selected,
            truncated=truncated,
        )
        response_warnings = _merge_warnings(warnings, _source_quality_warnings(selected))
        if truncated:
            response_warnings = _merge_warnings(response_warnings, ["CONTEXT_TRUNCATED"])

        yield StreamEvent(
            kind="meta",
            answer=RagAnswer(
                query_id=query_id,
                answer="",
                confidence=confidence,
                citations=_citations(selected),
                warnings=response_warnings,
                used_chunks=[chunk.chunk_id for chunk in selected],
                missing_information=None,
                policy_bindings=_answer_policy_bindings(selected),
                obligations=list(_policy_metadata(selected).get("obligations", [])),
            ),
        )

        messages = [
            {
                "role": "system",
                "content": _system_prompt(answer_mode, response_language),
            },
            {
                "role": "user",
                "content": _build_user_prompt(query=query, chunks=selected, response_language=response_language),
            },
        ]
        parts: list[str] = []
        async for delta in self._llm_client.stream_chat_completion(
            messages=messages,
            metadata={
                "purpose": "rag_answer_composition",
                "answer_mode": answer_mode,
                "response_language": response_language,
                "query_id": query_id,
                "chunk_count": len(selected),
                "used_chunk_ids": [chunk.chunk_id for chunk in selected],
                "chat_model": selected_chat_model or self._settings.chat_model,
                "chat_model_tier": "high_quality" if selected_chat_model else "standard",
                **_policy_metadata(selected),
            },
            model=selected_chat_model,
            auth_context=auth_context,
        ):
            parts.append(delta)
            yield StreamEvent(kind="delta", delta=delta)

        answer_text = "".join(parts).strip()
        if not answer_text:
            yield StreamEvent(
                kind="done",
                answer=RagAnswer(
                    query_id=query_id,
                    answer=NO_ANSWER_TEXT,
                    confidence="insufficient_source",
                    citations=[],
                    warnings=[*warnings, "LLM_EMPTY_ANSWER"],
                    used_chunks=[],
                    missing_information="LLM Gateway nevratil odpoved.",
                ),
            )
            return

        yield StreamEvent(
            kind="done",
            answer=RagAnswer(
                query_id=query_id,
                answer=answer_text,
                confidence=confidence,
                citations=_citations(selected),
                warnings=response_warnings,
                used_chunks=[chunk.chunk_id for chunk in selected],
                missing_information=None,
                policy_bindings=_answer_policy_bindings(selected),
                obligations=list(_policy_metadata(selected).get("obligations", [])),
            ),
        )

    def _select_context(self, chunks: list[RetrievedChunk]) -> tuple[list[RetrievedChunk], bool]:
        chunks = [chunk for chunk in chunks if chunk.score >= self._settings.no_answer_min_score]
        selected: list[RetrievedChunk] = []
        total_chars = 0
        truncated = False
        for chunk in chunks:
            next_total = total_chars + len(chunk.text)
            if selected and next_total > self._settings.max_context_chars:
                truncated = True
                break
            selected.append(chunk)
            total_chars = next_total
        return selected, truncated

    def _select_chat_model(
        self,
        *,
        answer_mode: AnswerMode,
        selected_chunks: list[RetrievedChunk],
        truncated: bool,
    ) -> str | None:
        high_quality_model = self._settings.high_quality_chat_model
        if not high_quality_model:
            return None
        if answer_mode in HIGH_QUALITY_ANSWER_MODES:
            return high_quality_model
        if truncated:
            return high_quality_model
        if len(selected_chunks) >= self._settings.high_quality_min_context_chunks:
            return high_quality_model
        return None


def _build_user_prompt(*, query: str, chunks: list[RetrievedChunk], response_language: ResponseLanguage = "cs") -> str:
    if response_language == "en":
        lines = [
            "FINAL ANSWER LANGUAGE: English",
            "Translate supported facts into English when the source text is in another language.",
            f"QUESTION: {query}",
            "",
            "CONTEXT:",
        ]
    else:
        lines = [
            "JAZYK FINÁLNÍ ODPOVĚDI: čeština",
            "Přelož podložená fakta do češtiny, pokud je zdrojový text v jiném jazyce.",
            f"DOTAZ: {query}",
            "",
            "KONTEXT:",
        ]
    for chunk in chunks:
        citation = chunk.citation
        section = " > ".join(citation.section_path)
        lines.extend(
            [
                (
                    f"[{chunk.chunk_id}] {citation.document_title}, verze {citation.version_label}, "
                    f"document_id={citation.document_id}, section={section}, page={citation.page_number}"
                ),
                chunk.text,
                "",
            ]
        )
    return "\n".join(lines)


def _source_quality_warnings(chunks: list[RetrievedChunk]) -> list[str]:
    warnings: list[str] = []
    for chunk in chunks:
        metadata = chunk.metadata
        parser_quality = metadata.get("parser_quality")
        quality_tier = str(
            metadata.get("quality_tier")
            or (parser_quality.get("quality_tier") if isinstance(parser_quality, dict) else "")
            or ""
        ).strip().lower()
        requires_review = metadata.get("requires_review")
        if requires_review is None and isinstance(parser_quality, dict):
            requires_review = parser_quality.get("requires_review")
        parser_name = str(metadata.get("parser_name") or "").strip().lower()
        parser_engine = str(metadata.get("parser_engine") or "").strip().lower()

        if _truthy(metadata.get("ocr_used")) or parser_name.startswith("ocr") or parser_engine in {"ocrmypdf", "tesseract"}:
            warnings.append("SOURCE_OCR_USED")
        if quality_tier == "poor":
            warnings.append("SOURCE_LOW_EXTRACTION_QUALITY")
        if quality_tier == "review" or _truthy(requires_review):
            warnings.append("SOURCE_QUALITY_REVIEW_REQUIRED")
    return _merge_warnings([], warnings)


def _truthy(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "ano"}
    return bool(value)


def _merge_warnings(*groups: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for warning in group:
            if warning and warning not in seen:
                seen.add(warning)
                merged.append(warning)
    return merged


def _system_prompt(answer_mode: AnswerMode, response_language: ResponseLanguage = "cs") -> str:
    if answer_mode == "it_support_answer":
        base = (
            "You are the AKL employee assistant. Answer only from the supplied context. "
            "The API returns source citations separately, so do not include chunk ids, document ids, "
            "version ids, or bracket citation markers in the final prose. "
            "Do not add facts that are not supported by the supplied context. If the context is insufficient, "
            "say that the source support is insufficient."
        )
    else:
        base = (
            "You are the AKL Retrieval answer composer. Answer only from the supplied context. "
            "Every factual or normative claim must be supported by cited chunk ids in square brackets. "
            "Do not add facts that are not supported by cited chunks. If the context is insufficient, "
            "say that the source support is insufficient."
        )
    language_instruction = {
        "cs": (
            "The selected UI language is Czech. Write the final answer in Czech only, "
            "even when the user question or source context is in another language. "
            "Keep citation chunk ids unchanged."
        ),
        "en": (
            "The selected UI language is English. Write the final answer in English only, "
            "even when the user question or source context is Czech or another language. "
            "Translate supported facts into English. Keep citation chunk ids unchanged. "
            "Do not write Czech sentences except source titles, proper names, or identifiers."
        ),
    }[response_language]
    mode_prompts: dict[str, str] = {
        "ask": "Provide a concise sourced answer for an employee-facing assistant.",
        "standard_answer": "Provide a concise sourced answer.",
        "normative_with_citations": "Provide a normative answer with citations.",
        "normative_answer_with_citations": "Provide a normative answer with citations.",
        "find_procedure": "Find the relevant procedure and explain the actionable steps with citations.",
        "find_owner": "Identify the owner, gestor, or accountable role only when supported by citations.",
        "find_responsibility": "Identify responsibilities and role boundaries with citations.",
        "summary": "Summarize only the provided context and preserve citations.",
        "extract_obligations": "Extract obligations as role, obligation, deadline if present, and citation.",
        "extract_roles": "Extract roles and responsibilities with citations.",
        "extract_deadlines": "Extract terms, deadlines, validity dates, and timing constraints with citations.",
        "extract_risks": "Extract risks, failure scenarios, controls, and limitations with citations.",
        "create_checklist": "Create a checklist where each item is grounded in a citation.",
        "create_faq": "Create a FAQ from the context. Each answer must cite source chunks.",
        "create_kb_article": "Create a short knowledge base article with cited sections.",
        "find_conflicts": "Identify possible conflicts without choosing a winner unless a cited source clearly resolves it.",
        "find_missing_metadata": "Identify missing or weak governance metadata only when supported by context.",
        "explain_process": "Explain the process as ordered steps with citations.",
        "it_support_answer": (
            "Answer in plain employee-facing language. Avoid internal implementation terms such as API endpoint names, "
            "service container names, chunk ids, vector databases, embeddings, reranking, model gateways, model providers, "
            "ports, Docker, Kubernetes, monitoring product names, and runtime internals unless the user explicitly asks for "
            "technical implementation detail. When source text contains those details, summarize them as business capabilities "
            "such as user interface, document registry, document processing, search, answer generation, source display, audit, "
            "and access control."
        ),
        "manager_brief": "Provide a short management brief with decision-relevant facts and citations.",
        "audit_question": "Answer audit questions conservatively, preserve source constraints, and cite every factual claim.",
    }
    return f"{base} {language_instruction} {mode_prompts.get(answer_mode, mode_prompts['standard_answer'])}"


def _citations(chunks: list[RetrievedChunk]) -> list[Citation]:
    citations: list[Citation] = []
    seen: set[str] = set()
    for chunk in chunks:
        if chunk.chunk_id in seen:
            continue
        seen.add(chunk.chunk_id)
        citations.append(
            Citation(
                document_id=chunk.citation.document_id,
                document_version_id=chunk.citation.document_version_id,
                document_title=chunk.citation.document_title,
                version_label=chunk.citation.version_label,
                section_path=chunk.citation.section_path,
                page_number=chunk.citation.page_number,
                chunk_id=chunk.chunk_id,
                policy_binding_id=_metadata_text(chunk.metadata, "policy_binding_id"),
                policy_version=_metadata_text(chunk.metadata, "policy_version"),
                policy_hash=_metadata_text(chunk.metadata, "policy_hash"),
                policy_summary=_citation_policy_summary(chunk.metadata),
                policy_summary_hash=_citation_policy_summary_hash(chunk.metadata),
                document_context_tags=_citation_context_tags(chunk.metadata),
            )
        )
    return citations


def _metadata_text(metadata: dict[str, object], key: str) -> str | None:
    value = metadata.get(key)
    return value if isinstance(value, str) and value else None


def _citation_policy_summary(metadata: dict[str, object]) -> CitationPolicySummary | None:
    summary = metadata.get("policy_summary")
    if not isinstance(summary, dict):
        return None
    try:
        parsed = CitationPolicySummary.model_validate(summary)
    except ValueError:
        return None
    if (
        parsed.policyBindingId != _metadata_text(metadata, "policy_binding_id")
        or parsed.policyVersion != _metadata_text(metadata, "policy_version")
    ):
        return None
    return parsed


def _citation_policy_summary_hash(metadata: dict[str, object]) -> str | None:
    summary = _citation_policy_summary(metadata)
    if summary is None:
        return None
    encoded = json.dumps(
        summary.model_dump(mode="json"),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return f"sha256:{sha256(encoded).hexdigest()}"


def _citation_context_tags(metadata: dict[str, object]) -> list[str]:
    value = metadata.get("tags")
    if not isinstance(value, list):
        return []
    tags: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item or len(item) > 120 or item in tags:
            continue
        tags.append(item)
        if len(tags) == 20:
            break
    return tags


def _policy_metadata(chunks: list[RetrievedChunk]) -> dict[str, object]:
    rank = {"PUBLIC": 0, "INTERNAL": 1, "PROJECT_MANAGEMENT": 2, "RESTRICTED": 3}
    handling_class = "PUBLIC"
    obligations: set[str] = set()
    binding_ids: set[str] = set()
    policy_hashes: set[str] = set()
    for chunk in chunks:
        summary = chunk.metadata.get("policy_summary")
        if isinstance(summary, dict):
            candidate = summary.get("handlingClass")
            if isinstance(candidate, str) and rank.get(candidate, -1) > rank[handling_class]:
                handling_class = candidate
            raw_obligations = summary.get("obligations")
            if isinstance(raw_obligations, list):
                obligations.update(item for item in raw_obligations if isinstance(item, str))
        binding_id = _metadata_text(chunk.metadata, "policy_binding_id")
        policy_hash = _metadata_text(chunk.metadata, "policy_hash")
        if binding_id:
            binding_ids.add(binding_id)
        if policy_hash:
            policy_hashes.add(policy_hash)
    if not binding_ids:
        return {}
    return {
        "policy_version": "information-policy-2.0.0",
        "policy_binding_ids": sorted(binding_ids),
        "policy_hashes": sorted(policy_hashes),
        "handling_class": handling_class,
        "legal_classification": "NONE",
        "obligations": sorted(obligations),
    }


def _answer_policy_bindings(chunks: list[RetrievedChunk]) -> list[dict[str, str]]:
    bindings: dict[tuple[str, str], dict[str, str]] = {}
    for chunk in chunks:
        binding_id = _metadata_text(chunk.metadata, "policy_binding_id")
        policy_hash = _metadata_text(chunk.metadata, "policy_hash")
        policy_version = _metadata_text(chunk.metadata, "policy_version")
        if binding_id and policy_hash and policy_version:
            bindings[(binding_id, policy_hash)] = {
                "policy_binding_id": binding_id,
                "policy_version": policy_version,
                "policy_hash": policy_hash,
            }
    return [bindings[key] for key in sorted(bindings)]
