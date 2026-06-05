from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from answer_composer.composer import AnswerComposer
from app.config import ConfigError, Settings, load_settings
from app.errors import (
    RetrievalError,
    http_error_handler,
    retrieval_error_handler,
    validation_error_handler,
)
from app.llm_client import create_llm_client
from app.logging import configure_logging
from app.middleware import CorrelationIdMiddleware
from app.registry_client import create_registry_client
from app.schemas import (
    AnswerRequest,
    HealthResponse,
    RagAnswer,
    RagQueryRequest,
    ReadinessResponse,
    RetrieveRequest,
    RetrieveResponse,
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

    @app.post("/api/v1/rag/answer", response_model=RagAnswer, tags=["rag"])
    async def answer(payload: AnswerRequest, request: Request) -> RagAnswer:
        auth_context = _guard_request(request)
        logger.info(
            "rag_answer_requested subject_id=%s chunk_count=%s query_text_logged=false",
            payload.subject_id,
            len(payload.chunks),
        )
        return await _service(request).answer(payload, auth_context=auth_context)

    @app.post(
        "/api/v1/rag/compare-documents",
        tags=["rag"],
        status_code=501,
        responses={501: {"description": "Not implemented in this retrieval-only iteration."}},
    )
    async def compare_documents(_: dict[str, Any], request: Request) -> None:
        _guard_request(request)
        raise RetrievalError(
            "NOT_IMPLEMENTED",
            "Document comparison is outside this retrieval-only implementation.",
            status_code=501,
        )

    @app.post(
        "/api/v1/rag/check-compliance",
        tags=["rag"],
        status_code=501,
        responses={501: {"description": "Not implemented in this retrieval-only iteration."}},
    )
    async def check_compliance(_: dict[str, Any], request: Request) -> None:
        _guard_request(request)
        raise RetrievalError(
            "NOT_IMPLEMENTED",
            "Compliance checking is outside this retrieval-only implementation.",
            status_code=501,
        )

    return app


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
