from __future__ import annotations

import hashlib
import logging
import re
import uuid
from dataclasses import dataclass
from typing import AsyncIterator

from answer_composer.composer import AnswerComposer, StreamEvent
from app.config import Settings
from app.errors import RetrievalError
from app.llm_client import LLMGatewayClient
from app.registry_client import RegistryClient
from app.schemas import (
    AnswerRequest,
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantConversationResponse,
    AssistantSuggestion,
    AssistantSuggestionsResponse,
    AssistantSuggestedAction,
    ClarificationQuestion,
    RagAnswer,
    RagQueryRequest,
    RagQueryFilters,
    RetrieveRequest,
    RetrieveResponse,
    RetrievedChunk,
    ResponseLanguage,
    SourceContextResponse,
    SourceLocation,
    ViewerMode,
)
from app.security import AuthContext
from policies.no_answer import NoAnswerPolicy
from rerankers.lexical import LexicalReranker
from retrievers.base import Retriever

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RetrievalRun:
    response: RetrieveResponse
    had_candidates: bool
    denied_document_ids: set[str]


class RagRetrievalService:
    def __init__(
        self,
        *,
        settings: Settings,
        registry_client: RegistryClient,
        retriever: Retriever,
        reranker: LexicalReranker,
        llm_client: LLMGatewayClient,
        no_answer_policy: NoAnswerPolicy,
        answer_composer: AnswerComposer,
    ) -> None:
        self._settings = settings
        self._registry_client = registry_client
        self._retriever = retriever
        self._reranker = reranker
        self._llm_client = llm_client
        self._no_answer_policy = no_answer_policy
        self._answer_composer = answer_composer

    async def retrieve(
        self,
        payload: RetrieveRequest,
        *,
        auth_context: AuthContext | None = None,
    ) -> RetrieveResponse:
        query_id = _query_id()
        run = await self._retrieve_authorized(
            payload=payload,
            query_id=query_id,
            auth_context=auth_context,
        )
        await self._audit_retrieval(
            actor_id=payload.subject_id,
            event_type="rag.retrieve.executed",
            query_id=query_id,
            chunks=run.response.chunks,
            warnings=run.response.warnings,
            auth_context=auth_context,
        )
        return run.response

    async def query(
        self,
        payload: RagQueryRequest,
        *,
        auth_context: AuthContext | None = None,
    ) -> RagAnswer:
        if payload.answer_mode == "compare":
            raise RetrievalError(
                "NOT_IMPLEMENTED",
                "Document comparison is outside this retrieval-only implementation.",
                status_code=501,
            )

        query_id = _query_id()
        run = await self._retrieve_authorized(
            payload=RetrieveRequest(
                subject_id=payload.subject_id,
                query=payload.query,
                filters=payload.filters,
                max_chunks=payload.max_chunks,
            ),
            query_id=query_id,
            auth_context=auth_context,
        )
        decision = self._no_answer_policy.evaluate(
            chunks=run.response.chunks,
            had_candidates=run.had_candidates,
            denied_document_ids=run.denied_document_ids,
        )
        if not decision.can_answer:
            answer = self._no_answer_policy.no_answer(
                query_id=query_id,
                decision=decision,
                response_language=payload.response_language,
            )
        elif payload.answer_mode == "retrieve_only":
            answer = _retrieval_only_answer(
                query_id=query_id,
                chunks=run.response.chunks,
                confidence=decision.confidence,
                warnings=decision.warnings,
                response_language=payload.response_language,
            )
        else:
            answer = await self._answer_composer.compose(
                query_id=query_id,
                query=payload.query,
                chunks=run.response.chunks,
                confidence=decision.confidence,
                warnings=decision.warnings,
                max_chunks=payload.max_chunks,
                answer_mode=payload.answer_mode,
                response_language=payload.response_language,
                auth_context=auth_context,
            )

        await self._audit_answer(
            actor_id=payload.subject_id,
            event_type="rag.query.executed",
            answer=answer,
            auth_context=auth_context,
        )
        logger.info(
            "rag_query_completed query_id=%s confidence=%s used_chunk_count=%s warning_count=%s",
            query_id,
            answer.confidence,
            len(answer.used_chunks),
            len(answer.warnings),
        )
        return answer

    async def query_stream(
        self,
        payload: RagQueryRequest,
        *,
        auth_context: AuthContext | None = None,
    ) -> AsyncIterator[StreamEvent]:
        if payload.answer_mode == "compare":
            raise RetrievalError(
                "NOT_IMPLEMENTED",
                "Document comparison is outside this retrieval-only implementation.",
                status_code=501,
            )

        query_id = _query_id()
        run = await self._retrieve_authorized(
            payload=RetrieveRequest(
                subject_id=payload.subject_id,
                query=payload.query,
                filters=payload.filters,
                max_chunks=payload.max_chunks,
            ),
            query_id=query_id,
            auth_context=auth_context,
        )
        decision = self._no_answer_policy.evaluate(
            chunks=run.response.chunks,
            had_candidates=run.had_candidates,
            denied_document_ids=run.denied_document_ids,
        )
        if not decision.can_answer:
            answer = self._no_answer_policy.no_answer(
                query_id=query_id,
                decision=decision,
                response_language=payload.response_language,
            )
            await self._audit_answer(
                actor_id=payload.subject_id,
                event_type="rag.query_stream.executed",
                answer=answer,
                auth_context=auth_context,
            )
            yield StreamEvent(kind="done", answer=answer)
            return

        if payload.answer_mode == "retrieve_only":
            answer = _retrieval_only_answer(
                query_id=query_id,
                chunks=run.response.chunks,
                confidence=decision.confidence,
                warnings=decision.warnings,
                response_language=payload.response_language,
            )
            await self._audit_answer(
                actor_id=payload.subject_id,
                event_type="rag.query_stream.executed",
                answer=answer,
                auth_context=auth_context,
            )
            yield StreamEvent(kind="done", answer=answer)
            return

        final_answer: RagAnswer | None = None
        async for event in self._answer_composer.compose_stream(
            query_id=query_id,
            query=payload.query,
            chunks=run.response.chunks,
            confidence=decision.confidence,
            warnings=decision.warnings,
            max_chunks=payload.max_chunks,
            answer_mode=payload.answer_mode,
            response_language=payload.response_language,
            auth_context=auth_context,
        ):
            if event.kind == "done":
                final_answer = event.answer
            yield event

        if final_answer is not None:
            await self._audit_answer(
                actor_id=payload.subject_id,
                event_type="rag.query_stream.executed",
                answer=final_answer,
                auth_context=auth_context,
            )
        logger.info(
            "rag_query_stream_completed query_id=%s confidence=%s",
            query_id,
            final_answer.confidence if final_answer else "unknown",
        )

    async def answer(
        self,
        payload: AnswerRequest,
        *,
        auth_context: AuthContext | None = None,
    ) -> RagAnswer:
        if payload.answer_mode == "compare":
            raise RetrievalError(
                "NOT_IMPLEMENTED",
                "Document comparison is outside this retrieval-only implementation.",
                status_code=501,
            )

        query_id = _query_id()
        chunks, denied_document_ids = await self._filter_authorized_chunks(
            subject_id=payload.subject_id,
            chunks=payload.chunks,
            auth_context=auth_context,
        )
        reranked = (
            self._reranker.rerank(query=payload.query, chunks=chunks, limit=payload.max_chunks)
            if self._settings.enable_reranking
            else chunks[: payload.max_chunks]
        )
        decision = self._no_answer_policy.evaluate(
            chunks=reranked,
            had_candidates=bool(payload.chunks),
            denied_document_ids=denied_document_ids,
        )
        if not decision.can_answer:
            answer = self._no_answer_policy.no_answer(
                query_id=query_id,
                decision=decision,
                response_language=payload.response_language,
            )
        else:
            answer = await self._answer_composer.compose(
                query_id=query_id,
                query=payload.query,
                chunks=reranked,
                confidence=decision.confidence,
                warnings=decision.warnings,
                max_chunks=payload.max_chunks,
                answer_mode=payload.answer_mode,
                response_language=payload.response_language,
                auth_context=auth_context,
            )

        await self._audit_answer(
            actor_id=payload.subject_id,
            event_type="rag.answer.executed",
            answer=answer,
            auth_context=auth_context,
        )
        return answer

    async def readiness(self) -> dict[str, str]:
        return {
            "registry-api": await self._registry_client.readiness(),
            "retriever": await self._retriever.readiness(),
            "llm-gateway": await self._llm_client.readiness(),
        }

    async def assistant_chat(
        self,
        payload: AssistantChatRequest,
        *,
        auth_context: AuthContext | None = None,
    ) -> AssistantChatResponse:
        conversation_id = payload.conversation_id or f"conv_{uuid.uuid4().hex[:12]}"
        await self._audit_assistant(
            actor_id=payload.user_id,
            event_type="assistant.question_asked",
            conversation_id=conversation_id,
            metadata={
                "mode": payload.mode,
                "response_language": payload.response_language,
                "message_sha256": hashlib.sha256(payload.message.encode("utf-8")).hexdigest(),
            },
            auth_context=auth_context,
        )

        questions = _clarification_questions(payload.message, payload.context, payload.response_language)
        if questions:
            response = AssistantChatResponse(
                response_type="clarification_needed",
                conversation_id=conversation_id,
                message=_localized(payload.response_language, "clarification_message"),
                questions=questions,
                why_needed=_localized(payload.response_language, "clarification_why_needed"),
                current_context=payload.context,
                suggested_actions=[
                    AssistantSuggestedAction(
                        label=_localized(payload.response_language, "complete_answers"),
                        action_type="continue_conversation",
                        target=conversation_id,
                    )
                ],
            )
            await self._audit_assistant(
                actor_id=payload.user_id,
                event_type="assistant.clarification_requested",
                conversation_id=conversation_id,
                metadata={"question_ids": [question.id for question in questions]},
                auth_context=auth_context,
            )
            await self._persist_conversation_turn(
                conversation_id=conversation_id,
                user_id=payload.user_id,
                user_message=payload.message,
                response=response,
                auth_context=auth_context,
            )
            return response

        rag_answer = await self.query(
            RagQueryRequest(
                subject_id=payload.user_id,
                query=_assistant_query(payload.message, payload.context),
                filters=_assistant_filters(payload.context),
                answer_mode=payload.mode,
                max_chunks=6,
                response_language=payload.response_language,
            ),
            auth_context=auth_context,
        )
        if rag_answer.citations:
            response = AssistantChatResponse(
                response_type="answer",
                conversation_id=conversation_id,
                answer=_employee_answer(rag_answer.answer, payload.response_language),
                citations=rag_answer.citations,
                follow_up_questions=_follow_up_questions(payload.message, payload.response_language),
                suggested_actions=[
                    AssistantSuggestedAction(
                        label=_localized(payload.response_language, "open_source"),
                        action_type="open_citation",
                    ),
                    AssistantSuggestedAction(
                        label=_localized(payload.response_language, "ask_followup"),
                        action_type="ask_followup",
                    ),
                ],
                confidence=rag_answer.confidence,
                warnings=rag_answer.warnings,
            )
            await self._audit_assistant(
                actor_id=payload.user_id,
                event_type="assistant.answer_returned",
                conversation_id=conversation_id,
                metadata={"citation_count": len(rag_answer.citations), "confidence": rag_answer.confidence},
                auth_context=auth_context,
            )
            await self._persist_conversation_turn(
                conversation_id=conversation_id,
                user_id=payload.user_id,
                user_message=payload.message,
                response=response,
                auth_context=auth_context,
            )
            return response

        response_type = "handoff_recommended" if rag_answer.confidence == "insufficient_source" else "no_answer"
        response = AssistantChatResponse(
            response_type=response_type,
            conversation_id=conversation_id,
            answer=_localized(payload.response_language, "no_precise_source"),
            citations=[],
            confidence=rag_answer.confidence,
            warnings=rag_answer.warnings,
            missing_information=rag_answer.missing_information,
            recommended_action=_localized(payload.response_language, "service_desk_handoff"),
            suggested_actions=[
                AssistantSuggestedAction(
                    label=_localized(payload.response_language, "service_desk_handoff"),
                    action_type="handoff",
                    target="service-desk",
                )
            ],
        )
        await self._audit_assistant(
            actor_id=payload.user_id,
            event_type="assistant.handoff_recommended" if response_type == "handoff_recommended" else "assistant.no_answer_returned",
            conversation_id=conversation_id,
            metadata={"warnings": rag_answer.warnings, "missing_information": rag_answer.missing_information},
            auth_context=auth_context,
        )
        await self._persist_conversation_turn(
            conversation_id=conversation_id,
            user_id=payload.user_id,
            user_message=payload.message,
            response=response,
            auth_context=auth_context,
        )
        return response

    async def assistant_suggestions(self, response_language: ResponseLanguage = "cs") -> AssistantSuggestionsResponse:
        dynamic = await self._content_based_suggestions(response_language)
        if dynamic:
            return AssistantSuggestionsResponse(suggestions=dynamic)
        return AssistantSuggestionsResponse(suggestions=_assistant_suggestions(response_language))

    async def _content_based_suggestions(self, response_language: ResponseLanguage) -> list[AssistantSuggestion]:
        """Derive suggested questions from documents actually present in the
        search index, so the assistant promotes real stored content instead
        of a generic IT-support catalogue."""
        list_titles = getattr(self._retriever, "list_document_titles", None)
        if list_titles is None:
            return []
        try:
            documents = await list_titles(limit=64)
        except Exception:
            logger.warning("assistant_suggestions_index_lookup_failed", exc_info=True)
            return []
        suggestions: list[AssistantSuggestion] = []
        for document in documents[:8]:
            title = document.get("document_title", "").strip()
            if not title:
                continue
            domain = _suggestion_domain(document.get("document_type", ""), response_language)
            if response_language == "en":
                prompt = f"What does the document “{title}” regulate and what are its key obligations?"
            else:
                prompt = f"Co upravuje dokument „{title}“ a jaké jsou jeho klíčové povinnosti?"
            suggestions.append(
                AssistantSuggestion(label=_shorten_title(title), prompt=prompt, domain=domain)
            )
        return suggestions

    async def assistant_conversation(
        self,
        conversation_id: str,
        *,
        auth_context: AuthContext | None = None,
    ) -> AssistantConversationResponse:
        try:
            stored = await self._registry_client.fetch_conversation(
                conversation_id=conversation_id,
                auth_context=auth_context,
            )
        except Exception as exc:
            logger.warning(
                "assistant_conversation_fetch_failed conversation_id=%s reason=%s",
                conversation_id,
                exc.__class__.__name__,
            )
            stored = None
        if stored is None:
            return AssistantConversationResponse(
                conversation_id=conversation_id,
                status="ephemeral",
                messages=[],
                warnings=["CONVERSATION_HISTORY_NOT_PERSISTED"],
            )
        messages = stored.get("messages", [])
        return AssistantConversationResponse(
            conversation_id=conversation_id,
            status="persisted",
            messages=messages if isinstance(messages, list) else [],
            warnings=[],
        )

    async def _persist_conversation_turn(
        self,
        *,
        conversation_id: str,
        user_id: str,
        user_message: str,
        response: AssistantChatResponse,
        auth_context: AuthContext | None = None,
    ) -> None:
        assistant_content = response.answer or response.message or ""
        try:
            await self._registry_client.append_conversation_messages(
                conversation_id=conversation_id,
                user_id=user_id,
                messages=[
                    {
                        "role": "user",
                        "content": user_message,
                        "citations": [],
                        "metadata": {},
                    },
                    {
                        "role": "assistant",
                        "content": assistant_content or "(empty)",
                        "response_type": response.response_type,
                        "citations": [citation.model_dump(mode="json") for citation in response.citations],
                        "metadata": {
                            "confidence": response.confidence,
                            "warnings": response.warnings,
                        },
                    },
                ],
                auth_context=auth_context,
            )
        except Exception as exc:
            logger.warning(
                "assistant_conversation_persist_failed conversation_id=%s reason=%s",
                conversation_id,
                exc.__class__.__name__,
            )

    async def source_context(
        self,
        *,
        chunk_id: str,
        subject_id: str,
        event_type: str = "chunk.opened",
        auth_context: AuthContext | None = None,
    ) -> SourceContextResponse:
        chunk = await self._retriever.get_chunk(chunk_id)
        if chunk is None:
            raise RetrievalError(
                "CHUNK_NOT_FOUND",
                "Requested chunk was not found in the retrieval index.",
                status_code=404,
                details={"chunk_id": chunk_id},
            )
        allowed, denied = await self._filter_authorized_chunks(
            subject_id=subject_id,
            chunks=[chunk],
            auth_context=auth_context,
        )
        if not allowed:
            raise RetrievalError(
                "CHUNK_ACCESS_DENIED",
                "The subject is not authorized to open this chunk.",
                status_code=403,
                details={"chunk_id": chunk_id, "denied_document_ids": sorted(denied)},
            )

        response = _source_context_from_chunk(chunk)
        neighbor_getter = getattr(self._retriever, "get_neighbors", None)
        if neighbor_getter is not None:
            try:
                before_text, after_text = await neighbor_getter(chunk)
                response = response.model_copy(update={"before_text": before_text, "after_text": after_text})
            except Exception as exc:
                logger.warning(
                    "source_context_neighbors_failed chunk_id=%s reason=%s",
                    chunk_id,
                    exc.__class__.__name__,
                )
        await self._audit_source_opened(
            actor_id=subject_id,
            event_type=event_type,
            context=response,
            auth_context=auth_context,
        )
        return response

    async def _retrieve_authorized(
        self,
        *,
        payload: RetrieveRequest,
        query_id: str,
        auth_context: AuthContext | None = None,
    ) -> RetrievalRun:
        query_vectors = await self._llm_client.embeddings([payload.query], auth_context=auth_context)
        query_vector = query_vectors[0] if query_vectors else None
        candidates = await self._retriever.retrieve(
            query=payload.query,
            filters=payload.filters,
            limit=max(self._settings.retrieval_candidate_limit, payload.max_chunks * 3),
            query_vector=query_vector,
        )
        authorized, denied_document_ids = await self._filter_authorized_chunks(
            subject_id=payload.subject_id,
            chunks=candidates,
            auth_context=auth_context,
        )
        warnings = (
            ["AUTHZ_FILTERED_SOURCES"]
            if self._settings.authz_mode == "registry" and denied_document_ids
            else []
        )
        if self._settings.enable_reranking:
            chunks = self._reranker.rerank(query=payload.query, chunks=authorized, limit=payload.max_chunks)
        else:
            chunks = authorized[: payload.max_chunks]
        logger.info(
            "rag_retrieval_candidates query_id=%s retriever_mode=%s authz_mode=%s "
            "candidates_before_authz=%s candidates_after_authz=%s applied_filters=%s",
            query_id,
            self._settings.retriever_mode,
            self._settings.authz_mode,
            len(candidates),
            len(authorized),
            payload.filters.model_dump(),
        )
        return RetrievalRun(
            response=RetrieveResponse(query_id=query_id, chunks=chunks, warnings=warnings),
            had_candidates=bool(candidates),
            denied_document_ids=denied_document_ids,
        )

    async def _filter_authorized_chunks(
        self,
        *,
        subject_id: str,
        chunks: list[RetrievedChunk],
        auth_context: AuthContext | None = None,
    ) -> tuple[list[RetrievedChunk], set[str]]:
        candidate_document_ids = sorted({chunk.citation.document_id for chunk in chunks})
        authz = await self._registry_client.filter_allowed_documents(
            subject_id=subject_id,
            candidate_document_ids=candidate_document_ids,
            auth_context=auth_context,
        )
        allowed = [chunk for chunk in chunks if chunk.citation.document_id in authz.allowed_document_ids]
        return allowed, authz.denied_document_ids

    async def _audit_retrieval(
        self,
        *,
        actor_id: str,
        event_type: str,
        query_id: str,
        chunks: list[RetrievedChunk],
        warnings: list[str],
        auth_context: AuthContext | None = None,
    ) -> None:
        try:
            await self._registry_client.write_audit_event(
                actor_id=actor_id,
                event_type=event_type,
                resource_id=query_id,
                metadata={
                    "used_chunk_ids": [chunk.chunk_id for chunk in chunks],
                    "cited_document_ids": sorted({chunk.citation.document_id for chunk in chunks}),
                    "warnings": warnings,
                },
                auth_context=auth_context,
            )
        except Exception as exc:
            logger.warning("rag_audit_failed event_type=%s query_id=%s reason=%s", event_type, query_id, exc.__class__.__name__)

    async def _audit_answer(
        self,
        *,
        actor_id: str,
        event_type: str,
        answer: RagAnswer,
        auth_context: AuthContext | None = None,
    ) -> None:
        try:
            await self._registry_client.write_audit_event(
                actor_id=actor_id,
                event_type=event_type,
                resource_id=answer.query_id,
                metadata={
                    "confidence": answer.confidence,
                    "used_chunk_ids": answer.used_chunks,
                    "citation_count": len(answer.citations),
                    "cited_document_ids": sorted({citation.document_id for citation in answer.citations}),
                    "warnings": answer.warnings,
                    "answer_sha256": hashlib.sha256(answer.answer.encode("utf-8")).hexdigest(),
                },
                auth_context=auth_context,
            )
        except Exception as exc:
            logger.warning(
                "rag_audit_failed event_type=%s query_id=%s reason=%s",
                event_type,
                answer.query_id,
                exc.__class__.__name__,
            )

    async def _audit_source_opened(
        self,
        *,
        actor_id: str,
        event_type: str,
        context: SourceContextResponse,
        auth_context: AuthContext | None = None,
    ) -> None:
        try:
            await self._registry_client.write_audit_event(
                actor_id=actor_id,
                event_type=event_type,
                resource_type="chunk" if event_type == "chunk.opened" else "citation",
                resource_id=context.chunk_id,
                metadata={
                    "document_id": context.document_id,
                    "document_version_id": context.document_version_id,
                    "source_file_uri": context.source_file_uri,
                    "viewer_mode": context.viewer_mode,
                },
                auth_context=auth_context,
            )
        except Exception as exc:
            logger.warning(
                "rag_audit_failed event_type=%s chunk_id=%s reason=%s",
                event_type,
                context.chunk_id,
                exc.__class__.__name__,
            )

    async def _audit_assistant(
        self,
        *,
        actor_id: str,
        event_type: str,
        conversation_id: str,
        metadata: dict[str, object],
        auth_context: AuthContext | None = None,
    ) -> None:
        try:
            await self._registry_client.write_audit_event(
                actor_id=actor_id,
                event_type=event_type,
                resource_type="assistant_conversation",
                resource_id=conversation_id,
                metadata=metadata,
                auth_context=auth_context,
            )
        except Exception as exc:
            logger.warning(
                "assistant_audit_failed event_type=%s conversation_id=%s reason=%s",
                event_type,
                conversation_id,
                exc.__class__.__name__,
            )


def _query_id() -> str:
    return f"query_{uuid.uuid4().hex[:12]}"


def _retrieval_only_answer(
    *,
    query_id: str,
    chunks: list[RetrievedChunk],
    confidence: str,
    warnings: list[str],
    response_language: ResponseLanguage = "cs",
) -> RagAnswer:
    from answer_composer.composer import _citations

    return RagAnswer(
        query_id=query_id,
        answer=(
            f"Retrieval-only mode returned {len(chunks)} authorized chunk(s)."
            if response_language == "en"
            else f"Režim pouze vyhledávání vrátil {len(chunks)} autorizovaných částí dokumentů."
        ),
        confidence=confidence,  # type: ignore[arg-type]
        citations=_citations(chunks),
        warnings=warnings,
        used_chunks=[chunk.chunk_id for chunk in chunks],
        missing_information=None,
    )


def _source_context_from_chunk(chunk: RetrievedChunk) -> SourceContextResponse:
    metadata = chunk.metadata
    source_mime_type = _str_or_none(metadata.get("source_mime_type"))
    source_file_name = _str_or_none(metadata.get("source_file_name"))
    warnings: list[str] = []
    if not metadata.get("source_file_uri"):
        warnings.append("SOURCE_FILE_URI_MISSING")
    if not source_mime_type:
        warnings.append("SOURCE_MIME_TYPE_MISSING")

    return SourceContextResponse(
        chunk_id=chunk.chunk_id,
        document_id=chunk.citation.document_id,
        document_version_id=chunk.citation.document_version_id,
        document_title=chunk.citation.document_title,
        source_file_uri=_str_or_none(metadata.get("source_file_uri")),
        source_mime_type=source_mime_type,
        source_file_name=source_file_name,
        source_size_bytes=_int_or_none(metadata.get("source_size_bytes")),
        source_sha256=_str_or_none(metadata.get("source_sha256")),
        viewer_mode=_viewer_mode(source_mime_type, source_file_name),
        location=SourceLocation(
            page_number=chunk.citation.page_number,
            section_path=chunk.citation.section_path,
            section_title=_str_or_none(metadata.get("section_title")),
            paragraph_number=chunk.citation.paragraph_number,
            char_start=_int_or_none(metadata.get("char_start")),
            char_end=_int_or_none(metadata.get("char_end")),
            bbox=metadata.get("bbox") if isinstance(metadata.get("bbox"), dict) else None,
        ),
        chunk_text=chunk.text,
        before_text="",
        after_text="",
        warnings=warnings,
    )


def _viewer_mode(mime_type: str | None, file_name: str | None) -> ViewerMode:
    value = (mime_type or "").lower()
    name = (file_name or "").lower()
    if value == "application/pdf" or name.endswith(".pdf"):
        return "pdf"
    if value in {"text/markdown", "text/x-markdown", "application/markdown"} or name.endswith((".md", ".markdown")):
        return "markdown"
    if value.startswith("text/") or name.endswith((".txt", ".rtf")):
        return "text"
    if value in {"text/html", "application/xhtml+xml"} or name.endswith((".html", ".htm")):
        return "html"
    if "spreadsheet" in value or "excel" in value or name.endswith((".xls", ".xlsx", ".csv")):
        return "table"
    if "presentation" in value or "powerpoint" in value or name.endswith((".ppt", ".pptx")):
        return "presentation"
    if value.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".tiff", ".webp")):
        return "image"
    if name.endswith((".doc", ".docx", ".odt")):
        return "text"
    return "binary"


def _str_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _int_or_none(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _assistant_filters(context: dict[str, object]) -> RagQueryFilters:
    tags: list[str] = []
    context_tags = context.get("tags")
    if isinstance(context_tags, list):
        tags.extend(str(tag).strip() for tag in context_tags if str(tag).strip())
    return RagQueryFilters(
        document_types=[
            "project_documentation",
            "directive",
            "methodology",
            "policy",
            "procedure",
            "manual",
            "knowledge_base_article",
        ],
        only_valid=True,
        classification_max="internal",
        tags=tags,
    )


def _assistant_query(message: str, context: dict[str, object]) -> str:
    context_parts = [f"{key}: {value}" for key, value in sorted(context.items()) if value not in (None, "", [])]
    if not context_parts:
        return message
    return f"{message}\n\nKontext zaměstnance:\n" + "\n".join(context_parts)


LOCALIZED_TEXT: dict[ResponseLanguage, dict[str, str]] = {
    "cs": {
        "clarification_message": "Potřebuji upřesnit dotaz.",
        "clarification_why_needed": "Dotaz může znamenat více různých postupů nebo odpovědností.",
        "complete_answers": "Doplnit odpovědi",
        "system_question": "O který systém se jedná?",
        "request_type_question": "Jde o nový přístup, změnu oprávnění nebo odebrání přístupu?",
        "request_new_access": "nový přístup",
        "request_change_permission": "změna oprávnění",
        "request_remove_access": "odebrání přístupu",
        "user_role_question": "Jste žadatel, vedoucí nebo správce?",
        "role_requester": "žadatel",
        "role_manager": "vedoucí",
        "role_admin": "správce",
        "incident_system_question": "O jakou aplikaci nebo službu jde?",
        "incident_impact_question": "Jde o úplný výpadek, chybu jedné funkce, nebo pomalou odezvu?",
        "incident_full_outage": "úplný výpadek",
        "incident_one_function": "chyba jedné funkce",
        "incident_slow_response": "pomalá odezva",
        "incident_scope_question": "Týká se problém jen vás, nebo více uživatelů?",
        "scope_me": "jen mě",
        "scope_more_users": "více uživatelů",
        "scope_workplace": "celé pracoviště",
        "approval_subject_question": "Co konkrétně má být schváleno?",
        "open_source": "Otevřít zdroj",
        "ask_followup": "Položit doplňující dotaz",
        "no_precise_source": "Nepodařilo se najít dostatečně přesný a citovatelný postup.",
        "service_desk_handoff": "Založit požadavek na Service Desk",
        "followup_owner": "Chcete zjistit, kdo je vlastník systému?",
        "followup_request_text": "Chcete připravit text žádosti?",
        "followup_incident_category": "Chcete doporučit kategorii incidentu?",
        "followup_incident_description": "Chcete připravit popis pro Service Desk?",
        "followup_open_source": "Chcete otevřít zdrojový dokument?",
        "followup_ask_more": "Chcete položit doplňující otázku?",
    },
    "en": {
        "clarification_message": "I need to clarify the question.",
        "clarification_why_needed": "The question can refer to multiple procedures or responsibilities.",
        "complete_answers": "Add details",
        "system_question": "Which system is this about?",
        "request_type_question": "Is this a new access request, permission change, or access removal?",
        "request_new_access": "new access",
        "request_change_permission": "permission change",
        "request_remove_access": "access removal",
        "user_role_question": "Are you the requester, manager, or administrator?",
        "role_requester": "requester",
        "role_manager": "manager",
        "role_admin": "administrator",
        "incident_system_question": "Which application or service is affected?",
        "incident_impact_question": "Is this a full outage, one broken function, or slow response?",
        "incident_full_outage": "full outage",
        "incident_one_function": "one broken function",
        "incident_slow_response": "slow response",
        "incident_scope_question": "Does the problem affect only you or more users?",
        "scope_me": "only me",
        "scope_more_users": "more users",
        "scope_workplace": "whole workplace",
        "approval_subject_question": "What exactly needs to be approved?",
        "open_source": "Open source",
        "ask_followup": "Ask follow-up",
        "no_precise_source": "I could not find a sufficiently precise and citable procedure.",
        "service_desk_handoff": "Create a Service Desk request",
        "followup_owner": "Do you want to identify the system owner?",
        "followup_request_text": "Do you want to draft the request text?",
        "followup_incident_category": "Do you want a recommended incident category?",
        "followup_incident_description": "Do you want to draft a Service Desk description?",
        "followup_open_source": "Do you want to open the source document?",
        "followup_ask_more": "Do you want to ask a follow-up question?",
    },
}


def _localized(language: ResponseLanguage, key: str) -> str:
    return LOCALIZED_TEXT[language][key]


def _clarification_questions(
    message: str,
    context: dict[str, object],
    response_language: ResponseLanguage = "cs",
) -> list[ClarificationQuestion]:
    normalized = _normalize_for_assistant(message)
    questions: list[ClarificationQuestion] = []
    if _is_access_query(normalized):
        if not context.get("system"):
            questions.append(
                ClarificationQuestion(
                    id="system",
                    question=_localized(response_language, "system_question"),
                    type="free_text",
                )
            )
        if not context.get("request_type"):
            questions.append(
                ClarificationQuestion(
                    id="request_type",
                    question=_localized(response_language, "request_type_question"),
                    type="single_choice",
                    options=[
                        _localized(response_language, "request_new_access"),
                        _localized(response_language, "request_change_permission"),
                        _localized(response_language, "request_remove_access"),
                    ],
                )
            )
        if not context.get("user_role"):
            questions.append(
                ClarificationQuestion(
                    id="user_role",
                    question=_localized(response_language, "user_role_question"),
                    type="single_choice",
                    options=[
                        _localized(response_language, "role_requester"),
                        _localized(response_language, "role_manager"),
                        _localized(response_language, "role_admin"),
                    ],
                )
            )
    if _is_incident_query(normalized):
        if not context.get("system"):
            questions.append(
                ClarificationQuestion(
                    id="system",
                    question=_localized(response_language, "incident_system_question"),
                    type="free_text",
                )
            )
        if not context.get("impact"):
            questions.append(
                ClarificationQuestion(
                    id="impact",
                    question=_localized(response_language, "incident_impact_question"),
                    type="single_choice",
                    options=[
                        _localized(response_language, "incident_full_outage"),
                        _localized(response_language, "incident_one_function"),
                        _localized(response_language, "incident_slow_response"),
                    ],
                )
            )
        if not context.get("scope"):
            questions.append(
                ClarificationQuestion(
                    id="scope",
                    question=_localized(response_language, "incident_scope_question"),
                    type="single_choice",
                    options=[
                        _localized(response_language, "scope_me"),
                        _localized(response_language, "scope_more_users"),
                        _localized(response_language, "scope_workplace"),
                    ],
                )
            )
    if _is_approval_query(normalized) and not context.get("approval_subject"):
        questions.append(
            ClarificationQuestion(
                id="approval_subject",
                question=_localized(response_language, "approval_subject_question"),
                type="free_text",
            )
        )
    return questions[:3]


def _normalize_for_assistant(value: str) -> str:
    import unicodedata

    normalized = unicodedata.normalize("NFKD", value.lower())
    return "".join(char for char in normalized if not unicodedata.combining(char))


def _is_access_query(value: str) -> bool:
    return any(term in value for term in ("pristup", "opravneni", "access", "permission"))


def _is_incident_query(value: str) -> bool:
    return any(term in value for term in ("nejde", "nefunguje", "vypadek", "chyba", "incident", "outage", "broken", "error"))


def _is_approval_query(value: str) -> bool:
    return (
        ("kdo" in value and any(term in value for term in ("schvaluje", "schvalit", "schvaleni")))
        or ("who" in value and any(term in value for term in ("approve", "approves", "approval")))
    )


def _employee_answer(answer: str, response_language: ResponseLanguage = "cs") -> str:
    text = answer.strip()
    text = _strip_inline_chunk_citations(text)
    text = _strip_markdown_emphasis(text)
    text = _normalize_markdown_bullets(text)
    text = _soften_employee_technical_terms(text, response_language)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _strip_inline_chunk_citations(value: str) -> str:
    text = re.sub(r"\s*\[(?:\s*chunk_[A-Za-z0-9]+\s*,?)+\]", "", value)
    text = re.sub(r"\s*\[chunk_[^\]]+\]", "", text)
    return re.sub(r"\bchunk_[A-Za-z0-9]+\b", "", text)


def _strip_markdown_emphasis(value: str) -> str:
    text = re.sub(r"\*\*([^*\n][^*]*?)\*\*", r"\1", value)
    text = re.sub(r"__([^_\n][^_]*?)__", r"\1", text)
    return text


def _normalize_markdown_bullets(value: str) -> str:
    return re.sub(r"(?m)^\s*[*-]\s+", "- ", value)


def _soften_employee_technical_terms(value: str, response_language: ResponseLanguage = "cs") -> str:
    text = value
    text = re.sub(
        r"\s*\([^)]*(?:registry-api|ingestion-service|rag-retrieval-service|llm-gateway-service|"
        r"evaluation-service|governance-service|PostgreSQL|Qdrant|MinIO|Keycloak|Prometheus|Grafana|"
        r"Loki|Next\.js|Ollama|vLLM|OpenAI|Docker|Kubernetes|ingestion|GET /health)[^)]*\)",
        "",
        text,
        flags=re.IGNORECASE,
    )
    replacements = _employee_term_replacements(response_language)
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    if response_language == "cs":
        text = re.sub(r"(provozní monitoring,\s*){2,}provozní monitoring", "provozní monitoring", text)
        text = re.sub(r"\bprostřednicti integrační rozhraní\b", "přes integrační rozhraní", text, flags=re.IGNORECASE)
        text = re.sub(r"\bprostřednictvím integrační rozhraní\b", "přes integrační rozhraní", text, flags=re.IGNORECASE)
        text = re.sub(r"\bWebový rozhraní\b", "Webové rozhraní", text)
        text = re.sub(r"(?m)^- uživatelské rozhraní:", "- Uživatelské rozhraní:", text)
        text = re.sub(r"\bAI prostředími\b", "AI prostředím", text)
        text = re.sub(r"\bAI prostředí\b", "AI prostředím", text)
        text = re.sub(r"\bvčetně databází, vyhledávací index, úložiště\b", "včetně databází, vyhledávacího indexu, úložiště", text)
        text = re.sub(r"\bvyhledávání ve znalostech funkcionality\b", "vyhledávacích funkcí", text)
    else:
        text = re.sub(r"(operational monitoring,\s*){2,}operational monitoring", "operational monitoring", text)
        text = re.sub(r"\bRegistry interface\b", "document registry", text, flags=re.IGNORECASE)
        text = re.sub(r"\bknowledge search knowledge search\b", "knowledge search", text, flags=re.IGNORECASE)
        text = re.sub(r"\bshared shared internal objects\b", "shared internal objects", text, flags=re.IGNORECASE)
        text = re.sub(r"\bAI layer\b", "answer generation", text, flags=re.IGNORECASE)
    return text


def _employee_term_replacements(response_language: ResponseLanguage) -> list[tuple[str, str]]:
    if response_language == "en":
        return [
            (r"\bweb frontend\b", "user interface"),
            (r"\bfrontend\b", "user interface"),
            (r"\bregistry-api\b", "document registry"),
            (r"\bRegistry API\b", "document registry"),
            (r"\bRegistry interface\b", "document registry"),
            (r"\bRegistry service\b", "document registry"),
            (r"\bingestion-service\b", "document processing"),
            (r"\bIngestion service\b", "document processing"),
            (r"\brag-retrieval-service\b", "knowledge search"),
            (r"\bRAG Retrieval Service\b", "knowledge search"),
            (r"\bknowledge search retrieval service\b", "knowledge search"),
            (r"\bRetrieval service\b", "knowledge search"),
            (r"\bllm-gateway-service\b", "AI answer layer"),
            (r"\bLLM Gateway Service\b", "AI answer layer"),
            (r"\bLLM Gateway\b", "AI layer"),
            (r"\bevaluation-service\b", "answer quality checks"),
            (r"\bEvaluation service\b", "answer quality checks"),
            (r"\bgovernance-service\b", "knowledge governance"),
            (r"\bGovernance service\b", "knowledge governance"),
            (r"\bPlatform Status Service\b", "platform health checks"),
            (r"\bPostgreSQL\b", "database layer"),
            (r"\bQdrant\b", "search index"),
            (r"\bMinIO\b", "document storage"),
            (r"\bKeycloak\b", "access management"),
            (r"\bPrometheus\b", "operational monitoring"),
            (r"\bGrafana\b", "operational monitoring"),
            (r"\bLoki\b", "operational monitoring"),
            (r"\bNext\.js\b", "web application"),
            (r"\bREST API\b", "integration interface"),
            (r"\bAPI endpoint(?:s)?\b", "integration interface"),
            (r"\bGET /health endpoint\b", "health check"),
            (r"`GET /health` endpoint", "health check"),
            (r"`GET /health`", "health check"),
            (r"\bendpoint(?:s)?\b", "interface"),
            (r"\bAPI\b", "interface"),
            (r"\bRAG\b", "knowledge search"),
            (r"\bLLM runtimes?\b", "AI environment"),
            (r"\bLLM\b", "AI"),
            (r"\bruntime(?:s)?\b", "operating environment"),
            (r"\boperating environment objects\b", "shared internal objects"),
            (r"\bfixed interface contracts\b", "agreed integration rules"),
            (r"\bvector database\b", "search index"),
            (r"\bchunk(?:s)?\b", "document sections"),
            (r"\bembedding(?:s)?\b", "search signals"),
            (r"\breranking\b", "result ordering"),
            (r"\bhybrid search\b", "knowledge search"),
            (r"\bmodel provider(?:s)?\b", "AI providers"),
            (r"\bmodel gateway(?:s)?\b", "AI answer layer"),
            (r"\bcontainer(?:s)?\b", "runtime components"),
            (r"\bDocker\b", "operating environment"),
            (r"\bKubernetes\b", "operating environment"),
            (r"\bOllama\b", "local AI environment"),
            (r"\bvLLM\b", "AI environment"),
        ]
    return [
        (r"\bweb frontend\b", "uživatelské rozhraní"),
        (r"\bfrontend\b", "uživatelské rozhraní"),
        (r"\bregistry-api\b", "registr dokumentů"),
        (r"\bRegistry API\b", "registr dokumentů"),
        (r"\bRegistry interface\b", "registr dokumentů"),
        (r"\bRegistry service\b", "registr dokumentů"),
        (r"\bingestion-service\b", "zpracování dokumentů"),
        (r"\bIngestion service\b", "zpracování dokumentů"),
        (r"\brag-retrieval-service\b", "vyhledávání ve znalostech"),
        (r"\bRAG Retrieval Service\b", "vyhledávání ve znalostech"),
        (r"\bknowledge search retrieval service\b", "vyhledávání ve znalostech"),
        (r"\bRetrieval service\b", "vyhledávání ve znalostech"),
        (r"\bllm-gateway-service\b", "AI vrstva pro odpovědi"),
        (r"\bLLM Gateway Service\b", "AI vrstva pro odpovědi"),
        (r"\bLLM Gateway\b", "AI vrstva"),
        (r"\bevaluation-service\b", "kontrola kvality odpovědí"),
        (r"\bEvaluation service\b", "kontrola kvality odpovědí"),
        (r"\bgovernance-service\b", "pravidla a správa znalostí"),
        (r"\bGovernance service\b", "pravidla a správa znalostí"),
        (r"\bPlatform Status Service\b", "kontrola stavu platformy"),
        (r"\bPostgreSQL\b", "databázová vrstva"),
        (r"\bQdrant\b", "vyhledávací index"),
        (r"\bMinIO\b", "úložiště dokumentů"),
        (r"\bKeycloak\b", "správa přístupů"),
        (r"\bPrometheus\b", "provozní monitoring"),
        (r"\bGrafana\b", "provozní monitoring"),
        (r"\bLoki\b", "provozní monitoring"),
        (r"\bNext\.js\b", "webová aplikace"),
        (r"\bREST API\b", "integrační rozhraní"),
        (r"\bAPI endpoint(?:y|ů|s)?\b", "integrační rozhraní"),
        (r"\bGET /health endpoint\b", "kontrola stavu"),
        (r"`GET /health` endpoint", "kontrola stavu"),
        (r"`GET /health`", "kontrola stavu"),
        (r"\bendpoint(?:y|ů|s)?\b", "rozhraní"),
        (r"\bAPI\b", "rozhraní"),
        (r"\bRAG\b", "vyhledávání ve znalostech"),
        (r"\bLLM runtimes?\b", "AI prostředí"),
        (r"\bLLM\b", "AI"),
        (r"\bruntime(?:s)?\b", "provozní prostředí"),
        (r"\bvektorov(?:á|é|ou|ých|ým) databáz(?:e|i|í)\b", "vyhledávací index"),
        (r"\bchunk(?:y|ů|em|ech)?\b", "části dokumentů"),
        (r"\bembedding(?:y|ů|em|ech|s)?\b", "vyhledávací signály"),
        (r"\breranking\b", "seřazení výsledků"),
        (r"\bhybridní vyhledávání\b", "vyhledávání ve znalostech"),
        (r"\bingestion\b", "zpracování dokumentů"),
        (r"\bAI runtim(?:y|u|em|ech)?\b", "AI prostředí"),
        (r"\bmodel provider(?:s)?\b", "poskytovatelé AI"),
        (r"\bmodel gateway(?:s)?\b", "AI vrstva pro odpovědi"),
        (r"\bcontainer(?:s)?\b", "provozní komponenty"),
        (r"\bDocker\b", "provozní prostředí"),
        (r"\bKubernetes\b", "provozní prostředí"),
        (r"\bOllama\b", "lokální AI prostředí"),
        (r"\bvLLM\b", "AI prostředí"),
        (r"\bidentity managementu\b", "správy přístupů"),
        (r"\bnástrojů pro monitoring\b", "provozního monitoringu"),
        (r"\bbusiness logik(?:y|a|u)\b", "aplikační logiky"),
    ]


def _follow_up_questions(message: str, response_language: ResponseLanguage = "cs") -> list[str]:
    normalized = _normalize_for_assistant(message)
    if _is_access_query(normalized):
        return [
            _localized(response_language, "followup_owner"),
            _localized(response_language, "followup_request_text"),
        ]
    if _is_incident_query(normalized):
        return [
            _localized(response_language, "followup_incident_category"),
            _localized(response_language, "followup_incident_description"),
        ]
    return [
        _localized(response_language, "followup_open_source"),
        _localized(response_language, "followup_ask_more"),
    ]


_SUGGESTION_DOMAINS = {
    "cs": {
        "law": "Legislativa",
        "regulation": "Legislativa",
        "directive": "Směrnice",
        "methodology": "Metodiky",
        "policy": "Politiky",
        "knowledge_base_article": "Znalostní báze",
        "project_documentation": "Projektová dokumentace",
    },
    "en": {
        "law": "Legislation",
        "regulation": "Legislation",
        "directive": "Directives",
        "methodology": "Methodologies",
        "policy": "Policies",
        "knowledge_base_article": "Knowledge base",
        "project_documentation": "Project documentation",
    },
}


def _suggestion_domain(document_type: str, response_language: ResponseLanguage) -> str:
    domains = _SUGGESTION_DOMAINS["en" if response_language == "en" else "cs"]
    return domains.get(document_type, "Dokumenty" if response_language != "en" else "Documents")


def _shorten_title(title: str, max_length: int = 48) -> str:
    if len(title) <= max_length:
        return title
    return title[: max_length - 1].rstrip() + "…"


def _assistant_suggestions(response_language: ResponseLanguage = "cs") -> list[AssistantSuggestion]:
    if response_language == "en":
        return [
            AssistantSuggestion(
                label="ISVS obligations",
                prompt="What obligations apply to public administration information systems?",
                domain="Digital governance",
            ),
            AssistantSuggestion(
                label="Cybersecurity duties",
                prompt="Which cybersecurity obligations follow from the indexed documents?",
                domain="Security",
            ),
            AssistantSuggestion(
                label="Classified information",
                prompt="What duties apply when working with classified or restricted information?",
                domain="Compliance",
            ),
            AssistantSuggestion(
                label="Document controls",
                prompt="Which evidence, approval, and audit controls are required?",
                domain="Governance",
            ),
        ]
    return [
        AssistantSuggestion(
            label="Povinnosti ISVS",
            prompt="Jaké povinnosti platí pro informační systémy veřejné správy?",
            domain="Digitální správa",
        ),
        AssistantSuggestion(
            label="Kybernetická bezpečnost",
            prompt="Jaké povinnosti kybernetické bezpečnosti vyplývají z uložených dokumentů?",
            domain="Bezpečnost",
        ),
        AssistantSuggestion(
            label="Utajované informace",
            prompt="Jaké povinnosti platí při práci s utajovanými nebo omezenými informacemi?",
            domain="Compliance",
        ),
        AssistantSuggestion(
            label="Kontroly dokumentů",
            prompt="Jaké evidence, schválení a auditní kontroly jsou vyžadované?",
            domain="Governance",
        ),
    ]
