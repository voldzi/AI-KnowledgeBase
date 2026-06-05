from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass

from answer_composer.composer import AnswerComposer
from app.config import Settings
from app.errors import RetrievalError
from app.llm_client import LLMGatewayClient
from app.registry_client import RegistryClient
from app.schemas import (
    AnswerRequest,
    RagAnswer,
    RagQueryRequest,
    RetrieveRequest,
    RetrieveResponse,
    RetrievedChunk,
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
            answer = self._no_answer_policy.no_answer(query_id=query_id, decision=decision)
        elif payload.answer_mode == "retrieve_only":
            answer = _retrieval_only_answer(
                query_id=query_id,
                chunks=run.response.chunks,
                confidence=decision.confidence,
                warnings=decision.warnings,
            )
        else:
            answer = await self._answer_composer.compose(
                query_id=query_id,
                query=payload.query,
                chunks=run.response.chunks,
                confidence=decision.confidence,
                warnings=decision.warnings,
                max_chunks=payload.max_chunks,
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
            answer = self._no_answer_policy.no_answer(query_id=query_id, decision=decision)
        else:
            answer = await self._answer_composer.compose(
                query_id=query_id,
                query=payload.query,
                chunks=reranked,
                confidence=decision.confidence,
                warnings=decision.warnings,
                max_chunks=payload.max_chunks,
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


def _query_id() -> str:
    return f"query_{uuid.uuid4().hex[:12]}"


def _retrieval_only_answer(
    *,
    query_id: str,
    chunks: list[RetrievedChunk],
    confidence: str,
    warnings: list[str],
) -> RagAnswer:
    from answer_composer.composer import _citations

    return RagAnswer(
        query_id=query_id,
        answer=f"Retrieval-only mode returned {len(chunks)} authorized chunk(s).",
        confidence=confidence,  # type: ignore[arg-type]
        citations=_citations(chunks),
        warnings=warnings,
        used_chunks=[chunk.chunk_id for chunk in chunks],
        missing_information=None,
    )
