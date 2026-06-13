from __future__ import annotations

from app.config import Settings
from app.schemas import EffectiveConfigResponse, RecommendedModel, RecommendedModelsResponse


def recommended_models() -> RecommendedModelsResponse:
    return RecommendedModelsResponse(
        chat_models=[
            RecommendedModel(
                name="gemma4:12b",
                provider="ollama",
                recommended_for="real local RAG",
                minimum_memory_gb=24,
            ),
            RecommendedModel(
                name="qwen2.5:14b",
                provider="ollama",
                recommended_for="balanced Czech/English local RAG alternative",
                minimum_memory_gb=24,
            ),
            RecommendedModel(
                name="qwen2.5:32b",
                provider="ollama",
                recommended_for="higher quality local RAG",
                minimum_memory_gb=48,
            ),
            RecommendedModel(
                name="qwen2.5:0.5b",
                provider="ollama",
                recommended_for="lightweight local smoke tests",
                minimum_memory_gb=4,
            ),
        ],
        embedding_models=[
            RecommendedModel(
                name="bge-m3",
                provider="ollama",
                recommended_for="multilingual embeddings",
                minimum_memory_gb=4,
            ),
            RecommendedModel(
                name="nomic-embed-text",
                provider="ollama",
                recommended_for="lightweight local embedding smoke tests",
                minimum_memory_gb=4,
            ),
        ],
    )


def effective_config(settings: Settings) -> EffectiveConfigResponse:
    return EffectiveConfigResponse(
        service=settings.service_name,
        version=settings.service_version,
        environment=settings.env,
        active_provider=settings.default_provider,
        enabled_providers=list(settings.enabled_providers),
        default_chat_model=settings.default_chat_model,
        default_embedding_model=settings.default_embedding_model,
        default_max_tokens=settings.default_max_tokens,
        model_provider_map=settings.model_provider_map,
        allow_model_pull=settings.allow_model_pull,
        allow_model_delete=settings.allow_model_delete,
        ollama_base_url=settings.ollama_base_url,
        ollama_base_urls=list(settings.ollama_base_urls),
        ollama_think=settings.ollama_think,
        openai_base_url=settings.openai_base_url,
        openai_api_key_configured=bool(settings.openai_api_key),
    )
