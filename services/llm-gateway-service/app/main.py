from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import ConfigError, Settings, load_settings
from app.errors import (
    GatewayError,
    gateway_error_handler,
    http_error_handler,
    validation_error_handler,
)
from app.logging import configure_logging
from app.middleware import CorrelationIdMiddleware
from app.model_manager import effective_config, recommended_models
from app.rate_limit import InMemoryRateLimiter
from app.schemas import (
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    EmbeddingsRequest,
    EmbeddingsResponse,
    EffectiveConfigResponse,
    HealthResponse,
    ModelPullRequest,
    ModelPullResponse,
    ModelTestChatRequest,
    ModelTestEmbeddingRequest,
    ModelsResponse,
    ProvidersResponse,
    RecommendedModelsResponse,
)
from app.security import require_service_auth
from app.telemetry import configure_telemetry
from providers.router import ProviderRouter

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()
    configure_logging(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
        app.state.settings = resolved_settings
        app.state.provider_router = ProviderRouter(resolved_settings)
        app.state.rate_limiter = InMemoryRateLimiter(resolved_settings)
        yield

    app = FastAPI(
        title="AKL LLM Gateway Service",
        version=resolved_settings.service_version,
        description="Unified LLM API over Ollama, vLLM/OpenAI-compatible endpoints, and a mock provider.",
        lifespan=lifespan,
    )
    app.add_middleware(CorrelationIdMiddleware)
    app.add_exception_handler(GatewayError, gateway_error_handler)
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

    @app.get("/ready", tags=["health"])
    async def ready(request: Request) -> JSONResponse:
        status = await _router(request).readiness()
        status_code = 200 if status["status"] == "ready" else 503
        return JSONResponse(status_code=status_code, content=status)

    @app.get("/api/v1/models", response_model=ModelsResponse, tags=["models"])
    async def models(request: Request) -> ModelsResponse:
        _guard_request(request)
        logger.info("llm_models_requested")
        return ModelsResponse(models=await _router(request).list_models())

    @app.get("/api/v1/providers", response_model=ProvidersResponse, tags=["model-manager"])
    async def providers(request: Request) -> ProvidersResponse:
        _guard_request(request)
        logger.info("llm_providers_requested")
        return await _router(request).providers_info()

    @app.get(
        "/api/v1/models/recommended",
        response_model=RecommendedModelsResponse,
        tags=["model-manager"],
    )
    async def models_recommended(request: Request) -> RecommendedModelsResponse:
        _guard_request(request)
        logger.info("llm_recommended_models_requested")
        return recommended_models()

    @app.get(
        "/api/v1/config/effective",
        response_model=EffectiveConfigResponse,
        tags=["model-manager"],
    )
    async def config_effective(request: Request) -> EffectiveConfigResponse:
        _guard_request(request)
        logger.info("llm_effective_config_requested")
        return effective_config(_settings(request))

    @app.post(
        "/api/v1/models/pull",
        response_model=ModelPullResponse,
        tags=["model-manager"],
    )
    async def models_pull(payload: ModelPullRequest, request: Request) -> ModelPullResponse:
        _guard_request(request)
        logger.info(
            "llm_model_pull_requested provider=%s model=%s kind=%s",
            _settings(request).default_provider,
            payload.model,
            payload.kind,
        )
        return await _router(request).pull_model(payload.model, payload.kind)

    @app.post(
        "/api/v1/models/test-chat",
        response_model=ChatCompletionResponse,
        tags=["model-manager"],
    )
    async def models_test_chat(
        payload: ModelTestChatRequest,
        request: Request,
    ) -> ChatCompletionResponse:
        _guard_request(request)
        settings = _settings(request)
        model = payload.model or settings.default_chat_model
        provider = _router(request).provider_for_model(model)
        logger.info(
            "llm_model_test_chat_requested provider=%s model=%s",
            provider.name,
            model,
        )
        return await provider.chat_completion(
            ChatCompletionRequest(
                model=model,
                messages=[{"role": "user", "content": payload.prompt}],
                think=payload.think,
                temperature=0,
                max_tokens=payload.max_tokens,
                metadata={"purpose": "model_manager_test_chat"},
            )
        )

    @app.post(
        "/api/v1/models/test-embedding",
        response_model=EmbeddingsResponse,
        tags=["model-manager"],
    )
    async def models_test_embedding(
        payload: ModelTestEmbeddingRequest,
        request: Request,
    ) -> EmbeddingsResponse:
        _guard_request(request)
        settings = _settings(request)
        model = payload.model or settings.default_embedding_model
        provider = _router(request).provider_for_model(model)
        logger.info(
            "llm_model_test_embedding_requested provider=%s model=%s",
            provider.name,
            model,
        )
        return await provider.embeddings(
            EmbeddingsRequest(
                model=model,
                input=[payload.input],
                dimensions=payload.dimensions or settings.default_embedding_dimensions,
                metadata={"purpose": "model_manager_test_embedding"},
            )
        )

    @app.post(
        "/api/v1/chat/completions",
        response_model=ChatCompletionResponse,
        tags=["chat"],
        responses={200: {"description": "JSON completion or text/event-stream when stream=true."}},
    )
    async def chat_completions(
        payload: ChatCompletionRequest,
        request: Request,
    ) -> ChatCompletionResponse | StreamingResponse:
        _guard_request(request)
        provider = _router(request).provider_for_model(payload.model)
        logger.info(
            "llm_chat_requested provider=%s model=%s stream=%s message_count=%s metadata_keys=%s",
            provider.name,
            payload.model,
            payload.stream,
            len(payload.messages),
            sorted(payload.metadata.keys()),
        )

        if payload.stream:
            return StreamingResponse(
                _stream_sse(provider.stream_chat_completion(payload)),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        response = await provider.chat_completion(payload)
        logger.info(
            "llm_chat_completed provider=%s model=%s finish_reason=%s total_tokens=%s",
            response.provider,
            response.model,
            response.finish_reason,
            response.usage.total_tokens,
        )
        return response

    @app.post("/api/v1/embeddings", response_model=EmbeddingsResponse, tags=["embeddings"])
    async def embeddings(
        payload: EmbeddingsRequest,
        request: Request,
    ) -> EmbeddingsResponse:
        _guard_request(request)
        provider = _router(request).provider_for_model(payload.model)
        logger.info(
            "llm_embeddings_requested provider=%s model=%s input_count=%s metadata_keys=%s",
            provider.name,
            payload.model,
            len(payload.input),
            sorted(payload.metadata.keys()),
        )
        response = await provider.embeddings(payload)
        logger.info(
            "llm_embeddings_completed provider=%s model=%s input_count=%s",
            response.provider,
            response.model,
            len(response.data),
        )
        return response

    return app


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _router(request: Request) -> ProviderRouter:
    return request.app.state.provider_router


def _guard_request(request: Request) -> None:
    settings = _settings(request)
    require_service_auth(request, settings)
    request.app.state.rate_limiter.check(request)


async def _stream_sse(chunks: AsyncIterator[ChatCompletionChunk]) -> AsyncIterator[str]:
    async for chunk in chunks:
        yield f"data: {json.dumps(chunk.model_dump(), ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"


try:
    app = create_app()
except ConfigError as exc:
    logger.critical("configuration_error reason=%s", exc)
    raise
