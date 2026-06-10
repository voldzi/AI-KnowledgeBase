from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import StreamingResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from answer_composer.composer import AnswerComposer, StreamEvent
from app.config import ConfigError, Settings, load_settings
from app.errors import (
    RetrievalError,
    http_error_handler,
    retrieval_error_handler,
    validation_error_handler,
)
from app.http_utils import request_json_with_retry
from app.llm_client import create_llm_client
from app.logging import configure_logging
from app.middleware import CorrelationIdMiddleware
from app.registry_client import create_registry_client
from app.schemas import (
    AnswerRequest,
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantConversationResponse,
    AssistantSuggestionsResponse,
    HealthResponse,
    RagAnswer,
    RagQueryRequest,
    ReadinessResponse,
    RetrieveRequest,
    RetrieveResponse,
    ResponseLanguage,
    SourceContextResponse,
)
from app.security import AuthContext, auth_context_for_request, require_service_auth
from app.service import RagRetrievalService
from policies.no_answer import NoAnswerPolicy
from rerankers.lexical import LexicalReranker
from retrievers.qdrant import create_retriever

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()
    configure_logging(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
        registry_client = create_registry_client(resolved_settings)
        llm_client = create_llm_client(resolved_settings)
        retriever = create_retriever(resolved_settings)
        app.state.settings = resolved_settings
        app.state.rag_service = RagRetrievalService(
            settings=resolved_settings,
            registry_client=registry_client,
            retriever=retriever,
            reranker=LexicalReranker(),
            llm_client=llm_client,
            no_answer_policy=NoAnswerPolicy(resolved_settings),
            answer_composer=AnswerComposer(resolved_settings, llm_client),
        )
        yield

    app = FastAPI(
        title="AKL RAG Retrieval Service",
        version=resolved_settings.service_version,
        description=(
            "Hybrid retrieval, permission-aware reranking, answer composition, citations, "
            "confidence, and no-answer policy for AKL Platform."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(CorrelationIdMiddleware)
    app.add_exception_handler(RetrievalError, retrieval_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)

    @app.get("/health", response_model=HealthResponse, tags=["health"])
    async def health(request: Request) -> HealthResponse:
        settings = _settings(request)
        return HealthResponse(
            status="ok",
            service=settings.service_name,
            version=settings.service_version,
        )

    @app.get(
        "/ready",
        response_model=ReadinessResponse,
        tags=["health"],
        responses={503: {"description": "At least one dependency is not ready."}},
    )
    async def ready(request: Request, response: Response) -> ReadinessResponse:
        statuses = await _service(request).readiness()
        status = "ready" if all(value == "ready" for value in statuses.values()) else "not_ready"
        if status != "ready":
            response.status_code = 503
        return ReadinessResponse(status=status, service=_settings(request).service_name, dependencies=statuses)

    @app.post("/api/v1/rag/retrieve", response_model=RetrieveResponse, tags=["rag"])
    async def retrieve(payload: RetrieveRequest, request: Request) -> RetrieveResponse:
        auth_context = _guard_request(request)
        logger.info(
            "rag_retrieve_requested subject_id=%s max_chunks=%s answer_text_logged=false",
            payload.subject_id,
            payload.max_chunks,
        )
        return await _service(request).retrieve(payload, auth_context=auth_context)

    @app.post("/api/v1/rag/query", response_model=RagAnswer, tags=["rag"])
    async def query(payload: RagQueryRequest, request: Request) -> RagAnswer:
        auth_context = _guard_request(request)
        logger.info(
            "rag_query_requested subject_id=%s answer_mode=%s max_chunks=%s query_text_logged=false",
            payload.subject_id,
            payload.answer_mode,
            payload.max_chunks,
        )
        return await _service(request).query(payload, auth_context=auth_context)

    @app.post("/api/v1/rag/query-stream", tags=["rag"])
    async def query_stream(payload: RagQueryRequest, request: Request) -> StreamingResponse:
        auth_context = _guard_request(request)
        logger.info(
            "rag_query_stream_requested subject_id=%s answer_mode=%s max_chunks=%s query_text_logged=false",
            payload.subject_id,
            payload.answer_mode,
            payload.max_chunks,
        )
        service = _service(request)

        async def _events() -> AsyncIterator[str]:
            async for event in service.query_stream(payload, auth_context=auth_context):
                data = json.dumps(
                    {
                        "kind": event.kind,
                        "delta": event.delta,
                        "answer": event.answer.model_dump() if event.answer is not None else None,
                    }
                )
                yield f"data: {data}\n\n"

        return StreamingResponse(
            _events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/v1/rag/answer", response_model=RagAnswer, tags=["rag"])
    async def answer(payload: AnswerRequest, request: Request) -> RagAnswer:
        auth_context = _guard_request(request)
        logger.info(
            "rag_answer_requested subject_id=%s chunk_count=%s query_text_logged=false",
            payload.subject_id,
            len(payload.chunks),
        )
        return await _service(request).answer(payload, auth_context=auth_context)

    @app.get("/api/v1/chunks/{chunk_id}/source-context", response_model=SourceContextResponse, tags=["viewer"])
    async def chunk_source_context(chunk_id: str, request: Request, subject_id: str = "user_dev") -> SourceContextResponse:
        auth_context = _guard_request(request)
        logger.info("chunk_source_context_requested subject_id=%s chunk_id=%s", subject_id, chunk_id)
        return await _service(request).source_context(
            chunk_id=chunk_id,
            subject_id=subject_id,
            event_type="chunk.opened",
            auth_context=auth_context,
        )

    @app.get("/api/v1/citations/{chunk_id}/open", response_model=SourceContextResponse, tags=["viewer"])
    async def open_citation(chunk_id: str, request: Request, subject_id: str = "user_dev") -> SourceContextResponse:
        auth_context = _guard_request(request)
        logger.info("citation_open_requested subject_id=%s chunk_id=%s", subject_id, chunk_id)
        return await _service(request).source_context(
            chunk_id=chunk_id,
            subject_id=subject_id,
            event_type="citation.opened",
            auth_context=auth_context,
        )

    @app.get("/api/v1/assistant/citations/{chunk_id}/open", response_model=SourceContextResponse, tags=["assistant"])
    async def open_assistant_citation(chunk_id: str, request: Request, subject_id: str = "user_dev") -> SourceContextResponse:
        auth_context = _guard_request(request)
        logger.info("assistant_citation_open_requested subject_id=%s chunk_id=%s", subject_id, chunk_id)
        return await _service(request).source_context(
            chunk_id=chunk_id,
            subject_id=subject_id,
            event_type="assistant.citation_opened",
            auth_context=auth_context,
        )

    @app.post("/api/v1/assistant/chat", response_model=AssistantChatResponse, tags=["assistant"])
    async def assistant_chat(payload: AssistantChatRequest, request: Request) -> AssistantChatResponse:
        auth_context = _guard_request(request)
        logger.info(
            "assistant_chat_requested user_id=%s conversation_id=%s mode=%s message_logged=false",
            payload.user_id,
            payload.conversation_id,
            payload.mode,
        )
        return await _service(request).assistant_chat(payload, auth_context=auth_context)

    @app.post("/api/v1/assistant/clarify", response_model=AssistantChatResponse, tags=["assistant"])
    async def assistant_clarify(payload: AssistantChatRequest, request: Request) -> AssistantChatResponse:
        auth_context = _guard_request(request)
        logger.info(
            "assistant_clarify_requested user_id=%s conversation_id=%s mode=%s message_logged=false",
            payload.user_id,
            payload.conversation_id,
            payload.mode,
        )
        return await _service(request).assistant_chat(payload, auth_context=auth_context)

    @app.get("/api/v1/assistant/suggestions", response_model=AssistantSuggestionsResponse, tags=["assistant"])
    async def assistant_suggestions(
        request: Request,
        response_language: ResponseLanguage = "cs",
    ) -> AssistantSuggestionsResponse:
        _guard_request(request)
        return await _service(request).assistant_suggestions(response_language)

    @app.get(
        "/api/v1/assistant/conversations/{conversation_id}",
        response_model=AssistantConversationResponse,
        tags=["assistant"],
    )
    async def assistant_conversation(conversation_id: str, request: Request) -> AssistantConversationResponse:
        _guard_request(request)
        return await _service(request).assistant_conversation(conversation_id)

    @app.post(
        "/api/v1/rag/compare-documents",
        tags=["rag"],
        responses={502: {"description": "Governance service is unavailable."}},
    )
    async def compare_documents(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        auth_context = _guard_request(request)
        logger.info(
            "rag_compare_documents_requested subject_id=%s content_logged=false",
            payload.get("subject_id"),
        )
        return await _forward_to_governance(
            request,
            path="/governance/compare-versions",
            payload=payload,
            auth_context=auth_context,
        )

    @app.post(
        "/api/v1/rag/check-compliance",
        tags=["rag"],
        responses={502: {"description": "Governance service is unavailable."}},
    )
    async def check_compliance(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        auth_context = _guard_request(request)
        logger.info(
            "rag_check_compliance_requested subject_id=%s content_logged=false",
            payload.get("subject_id"),
        )
        return await _forward_to_governance(
            request,
            path="/governance/check-compliance",
            payload=payload,
            auth_context=auth_context,
        )

    return app


async def _forward_to_governance(
    request: Request,
    *,
    path: str,
    payload: dict[str, Any],
    auth_context: AuthContext,
) -> dict[str, Any]:
    settings = _settings(request)
    return await request_json_with_retry(
        dependency="governance",
        settings=settings,
        method="POST",
        url=f"{settings.governance_base_url}{path}",
        json_body=payload,
        auth_context=auth_context,
        prefer_upstream_token=True,
    )


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _service(request: Request) -> RagRetrievalService:
    return request.app.state.rag_service


def _guard_request(request: Request) -> AuthContext:
    require_service_auth(request, _settings(request))
    return auth_context_for_request(request, _settings(request))


try:
    app = create_app()
except ConfigError as exc:
    logger.critical("configuration_error reason=%s", exc)
    raise
