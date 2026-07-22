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
    ArchflowArchitectureExtractionProposeRequest,
    ArchflowArchitectureExtractionResponse,
    ArchflowGoalExtractionProposeRequest,
    ArchflowGoalExtractionResponse,
    AiipApplicationResponse,
    AiipDuplicateSearchRequest,
    AiipHarmonizeRequest,
    ContractExtractionProfilesResponse,
    ContractExtractionProposeRequest,
    ContractExtractionResponse,
    HealthResponse,
    RagAnswer,
    RagQueryRequest,
    ReadinessResponse,
    RetrieveRequest,
    RetrieveResponse,
    ResponseLanguage,
    SourceContextResponse,
    StratosExtractionFeedbackRequest,
    StratosExtractionFeedbackResponse,
    StratosExtractionResponse,
)
from app.security import AuthContext, auth_context_for_request, require_service_auth
from app.service import RagRetrievalService
from app.telemetry import configure_telemetry
from policies.evidence import EvidenceGate
from policies.no_answer import NoAnswerPolicy
from rerankers.cross_encoder import CrossEncoderReranker
from retrievers.qdrant import create_retriever

logger = logging.getLogger(__name__)


def _log_runtime_profile(settings: Settings) -> None:
    logger.info(
        "rag_runtime_profile reranker_mode=%s reranker_provider=%s "
        "reranker_endpoint_count=%d reranker_strategy=%s v2_retrieval_mode=%s "
        "adaptive_retrieval_mode=%s parent_retrieval_mode=%s evidence_gate_mode=%s "
        "colbert_mode=%s content_logged=false",
        settings.reranker_mode,
        settings.reranker_provider,
        len(settings.reranker_base_urls),
        settings.reranker_strategy,
        settings.v2_retrieval_mode,
        settings.adaptive_retrieval_mode,
        settings.parent_retrieval_mode,
        settings.evidence_gate_mode,
        settings.colbert_mode,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()
    configure_logging(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
        _log_runtime_profile(resolved_settings)
        registry_client = create_registry_client(resolved_settings)
        llm_client = create_llm_client(resolved_settings)
        retriever = create_retriever(resolved_settings)
        app.state.settings = resolved_settings
        app.state.rag_service = RagRetrievalService(
            settings=resolved_settings,
            registry_client=registry_client,
            retriever=retriever,
            reranker=CrossEncoderReranker(resolved_settings),
            llm_client=llm_client,
            no_answer_policy=NoAnswerPolicy(resolved_settings),
            answer_composer=AnswerComposer(resolved_settings, llm_client),
            evidence_gate=EvidenceGate(resolved_settings, llm_client),
        )
        yield

    app = FastAPI(
        title="AKL RAG Retrieval Service",
        version=resolved_settings.service_version,
        description=(
            "Hybrid retrieval, permission-aware reranking, answer composition, citations, "
            "confidence, and no-answer policy for AKB Platform."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(CorrelationIdMiddleware)
    app.add_exception_handler(RetrievalError, retrieval_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
    configure_telemetry(
        app,
        service_name=resolved_settings.service_name,
        service_version=resolved_settings.service_version,
    )

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
        auth_context = _guard_subject_request(request, payload.subject_id)
        logger.info(
            "rag_retrieve_requested subject_id=%s max_chunks=%s answer_text_logged=false",
            payload.subject_id,
            payload.max_chunks,
        )
        return await _service(request).retrieve(payload, auth_context=auth_context)

    @app.post("/api/v1/rag/query", response_model=RagAnswer, tags=["rag"])
    async def query(payload: RagQueryRequest, request: Request) -> RagAnswer:
        auth_context = _guard_subject_request(request, payload.subject_id)
        logger.info(
            "rag_query_requested subject_id=%s answer_mode=%s max_chunks=%s query_text_logged=false",
            payload.subject_id,
            payload.answer_mode,
            payload.max_chunks,
        )
        return await _service(request).query(payload, auth_context=auth_context)

    @app.post("/api/v1/rag/query-stream", tags=["rag"])
    async def query_stream(payload: RagQueryRequest, request: Request) -> StreamingResponse:
        auth_context = _guard_subject_request(request, payload.subject_id)
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
        auth_context = _guard_subject_request(request, payload.subject_id)
        logger.info(
            "rag_answer_requested subject_id=%s chunk_count=%s query_text_logged=false",
            payload.subject_id,
            len(payload.chunks),
        )
        return await _service(request).answer(payload, auth_context=auth_context)

    @app.post(
        "/api/v1/integrations/aiip/harmonize",
        response_model=AiipApplicationResponse,
        tags=["aiip-integration"],
    )
    async def aiip_harmonize(
        payload: AiipHarmonizeRequest,
        request: Request,
        response: Response,
    ) -> AiipApplicationResponse:
        auth_context = _guard_aiip_request(
            request,
            classification=payload.classification,
            tenant_id=payload.tenant_id,
        )
        idempotency_key = _aiip_idempotency_key(request)
        execution = await _service(request).aiip_harmonize(
            payload,
            idempotency_key=idempotency_key,
            auth_context=auth_context,
        )
        if execution.replayed:
            response.headers["Idempotency-Replayed"] = "true"
        return execution.response

    @app.post(
        "/api/v1/integrations/aiip/duplicates/search",
        response_model=AiipApplicationResponse,
        tags=["aiip-integration"],
    )
    async def aiip_duplicate_search(
        payload: AiipDuplicateSearchRequest,
        request: Request,
        response: Response,
    ) -> AiipApplicationResponse:
        auth_context = _guard_aiip_request(
            request,
            classification=payload.classification,
            tenant_id=payload.tenant_id,
        )
        idempotency_key = _aiip_idempotency_key(request)
        execution = await _service(request).aiip_duplicate_search(
            payload,
            idempotency_key=idempotency_key,
            auth_context=auth_context,
        )
        if execution.replayed:
            response.headers["Idempotency-Replayed"] = "true"
        return execution.response

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
        auth_context = _guard_request(request)
        return await _service(request).assistant_conversation(conversation_id, auth_context=auth_context)

    @app.get(
        "/api/v1/stratos/extractions/profiles",
        response_model=ContractExtractionProfilesResponse,
        tags=["stratos-extractions"],
    )
    async def stratos_extraction_profiles(request: Request) -> ContractExtractionProfilesResponse:
        _guard_request(request)
        return await _service(request).extraction_profiles()

    @app.post(
        "/api/v1/stratos/extractions/contracts/propose",
        response_model=ContractExtractionResponse,
        tags=["stratos-extractions"],
    )
    async def propose_contract_extraction(
        payload: ContractExtractionProposeRequest,
        request: Request,
    ) -> ContractExtractionResponse:
        auth_context = _guard_request(request)
        logger.info(
            "stratos_contract_extraction_requested subject_id=%s tenant_id=%s external_system=%s "
            "document_id=%s document_version_id=%s profile=%s content_logged=false",
            payload.subject_id,
            payload.tenant_id,
            payload.external_system,
            payload.document_id,
            payload.document_version_id,
            payload.profile,
        )
        return await _service(request).propose_contract_extraction(payload, auth_context=auth_context)

    @app.post(
        "/api/v1/stratos/extractions/archflow-goals/propose",
        response_model=ArchflowGoalExtractionResponse,
        tags=["stratos-extractions"],
    )
    async def propose_archflow_goal_extraction(
        payload: ArchflowGoalExtractionProposeRequest,
        request: Request,
    ) -> ArchflowGoalExtractionResponse:
        auth_context = _guard_request(request)
        logger.info(
            "stratos_archflow_goal_extraction_requested subject_id=%s tenant_id=%s external_system=%s "
            "source_set_id=%s catalog_version_id=%s source_document_count=%s profile=%s content_logged=false",
            payload.subject_id,
            payload.tenant_id,
            payload.external_system,
            payload.source_set_id,
            payload.catalog_version_id,
            len(payload.documents),
            payload.profile,
        )
        return await _service(request).propose_archflow_goal_extraction(payload, auth_context=auth_context)

    @app.post(
        "/api/v1/stratos/extractions/architecture-package/propose",
        response_model=ArchflowArchitectureExtractionResponse,
        tags=["stratos-extractions"],
    )
    async def propose_archflow_architecture_package_extraction(
        payload: ArchflowArchitectureExtractionProposeRequest,
        request: Request,
    ) -> ArchflowArchitectureExtractionResponse:
        auth_context = _guard_request(request)
        if payload.profile != "architecture_package_review_v1":
            raise RetrievalError(
                "INVALID_EXTRACTION_PROFILE",
                "architecture-package endpoint requires profile architecture_package_review_v1.",
                status_code=422,
                details={"profile": payload.profile},
            )
        logger.info(
            "stratos_archflow_architecture_package_extraction_requested subject_id=%s tenant_id=%s "
            "entity_type=%s entity_id=%s artifact_type=%s source_document_count=%s profile=%s content_logged=false",
            payload.subject_id,
            payload.tenant_id,
            payload.entity_type,
            payload.entity_id,
            payload.artifact_type,
            len(payload.documents),
            payload.profile,
        )
        return await _service(request).propose_archflow_architecture_package_extraction(payload, auth_context=auth_context)

    @app.post(
        "/api/v1/stratos/extractions/architecture-handover/propose",
        response_model=ArchflowArchitectureExtractionResponse,
        tags=["stratos-extractions"],
    )
    async def propose_archflow_handover_extraction(
        payload: ArchflowArchitectureExtractionProposeRequest,
        request: Request,
    ) -> ArchflowArchitectureExtractionResponse:
        auth_context = _guard_request(request)
        if payload.profile != "architecture_handover_v1":
            raise RetrievalError(
                "INVALID_EXTRACTION_PROFILE",
                "architecture-handover endpoint requires profile architecture_handover_v1.",
                status_code=422,
                details={"profile": payload.profile},
            )
        logger.info(
            "stratos_archflow_handover_extraction_requested subject_id=%s tenant_id=%s "
            "entity_type=%s entity_id=%s artifact_type=%s source_document_count=%s profile=%s content_logged=false",
            payload.subject_id,
            payload.tenant_id,
            payload.entity_type,
            payload.entity_id,
            payload.artifact_type,
            len(payload.documents),
            payload.profile,
        )
        return await _service(request).propose_archflow_handover_extraction(payload, auth_context=auth_context)

    @app.get(
        "/api/v1/stratos/extractions/{extraction_id}",
        response_model=StratosExtractionResponse,
        tags=["stratos-extractions"],
    )
    async def get_stratos_extraction(extraction_id: str, request: Request) -> StratosExtractionResponse:
        auth_context = _guard_request(request)
        return await _service(request).document_extraction(extraction_id, auth_context=auth_context)

    @app.post(
        "/api/v1/stratos/extractions/{extraction_id}/feedback",
        response_model=StratosExtractionFeedbackResponse,
        tags=["stratos-extractions"],
    )
    async def record_stratos_extraction_feedback(
        extraction_id: str,
        payload: StratosExtractionFeedbackRequest,
        request: Request,
    ) -> StratosExtractionFeedbackResponse:
        auth_context = _guard_request(request)
        logger.info(
            "stratos_extraction_feedback_received extraction_id=%s field=%s decision=%s "
            "source_app=%s content_logged=false",
            extraction_id,
            payload.field,
            payload.decision,
            payload.source_app,
        )
        return await _service(request).record_document_extraction_feedback(
            extraction_id,
            payload,
            auth_context=auth_context,
        )

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


def _authenticate_request(request: Request) -> AuthContext:
    require_service_auth(request, _settings(request))
    return auth_context_for_request(request, _settings(request))


def _guard_request(request: Request) -> AuthContext:
    context = _authenticate_request(request)
    if context.service_identity:
        raise RetrievalError(
            "SERVICE_ROUTE_FORBIDDEN",
            "Service identities are not allowed on this end-user route.",
            status_code=403,
        )
    return context


def _guard_subject_request(request: Request, subject_id: str) -> AuthContext:
    context = _guard_request(request)
    settings = _settings(request)
    if settings.auth_mode in {"oidc", "bearer"}:
        if context.service_identity:
            raise RetrievalError(
                "USER_DELEGATION_REQUIRED",
                "Generic RAG routes require a verified end-user bearer token.",
                status_code=403,
            )
        if not context.bearer_token or context.subject_id != subject_id:
            raise RetrievalError(
                "SUBJECT_DELEGATION_MISMATCH",
                "The request subject must match the verified bearer identity.",
                status_code=403,
            )
    return context


def _guard_aiip_request(
    request: Request,
    *,
    classification: str,
    tenant_id: str,
) -> AuthContext:
    context = _authenticate_request(request)
    settings = _settings(request)
    if (
        not context.service_identity
        or context.service_client_id not in settings.aiip_service_client_ids
        or "service_aiip" not in context.roles
    ):
        raise RetrievalError(
            "AUTH_FORBIDDEN",
            "This endpoint requires an explicitly allowed AIIP service client.",
            status_code=403,
        )
    if tenant_id != "org_stratos":
        raise RetrievalError(
            "ORGANIZATION_SCOPE_NOT_ALLOWED",
            "AIIP processing is restricted to organization org_stratos.",
            status_code=403,
        )
    if classification not in {"public", "internal"}:
        raise RetrievalError(
            "CLASSIFICATION_NOT_ALLOWED",
            "AIIP processing is allowed only for public and internal data.",
            status_code=403,
            details={"classification": classification},
        )
    return context


def _aiip_idempotency_key(request: Request) -> str:
    value = request.headers.get("Idempotency-Key", "").strip()
    if len(value) < 8 or len(value) > 128:
        raise RetrievalError(
            "IDEMPOTENCY_KEY_REQUIRED",
            "Idempotency-Key must contain between 8 and 128 characters.",
            status_code=400,
        )
    return value


try:
    app = create_app()
except ConfigError as exc:
    logger.critical("configuration_error reason=%s", exc)
    raise
