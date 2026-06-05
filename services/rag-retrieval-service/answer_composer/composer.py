from __future__ import annotations

from app.config import Settings
from app.llm_client import LLMGatewayClient
from app.schemas import Citation, Confidence, RagAnswer, RetrievedChunk
from app.security import AuthContext
from policies.no_answer import NO_ANSWER_TEXT


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
        auth_context: AuthContext | None = None,
    ) -> RagAnswer:
        selected, truncated = self._select_context(chunks[:max_chunks])
        messages = [
            {
                "role": "system",
                "content": (
                    "You are the AKL Retrieval answer composer. Answer only from the supplied context. "
                    "Do not add facts that are not supported by cited chunks. If the context is insufficient, "
                    "say that the source support is insufficient."
                ),
            },
            {
                "role": "user",
                "content": _build_user_prompt(query=query, chunks=selected),
            },
        ]
        answer = await self._llm_client.chat_completion(
            messages=messages,
            metadata={
                "purpose": "rag_answer_composition",
                "query_id": query_id,
                "chunk_count": len(selected),
                "used_chunk_ids": [chunk.chunk_id for chunk in selected],
            },
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

        response_warnings = [*warnings]
        if truncated:
            response_warnings.append("CONTEXT_TRUNCATED")

        return RagAnswer(
            query_id=query_id,
            answer=answer,
            confidence=confidence,
            citations=_citations(selected),
            warnings=response_warnings,
            used_chunks=[chunk.chunk_id for chunk in selected],
            missing_information=None,
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


def _build_user_prompt(*, query: str, chunks: list[RetrievedChunk]) -> str:
    lines = [
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
            )
        )
    return citations
