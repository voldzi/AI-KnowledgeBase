from __future__ import annotations

import asyncio
import logging

from app.config import Settings
from app.errors import GatewayError
from app.schemas import ModelInfo, ModelKind, ModelPullResponse, ProviderInfo, ProvidersResponse
from providers.base import LLMProvider
from providers.mock import MockProvider
from providers.ollama import OllamaProvider
from providers.openai_compatible import OpenAICompatibleProvider

logger = logging.getLogger(__name__)


class ProviderRouter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.all_providers: dict[str, LLMProvider] = {
            "mock": MockProvider(settings),
            "ollama": OllamaProvider(settings),
            "openai": OpenAICompatibleProvider(settings),
        }
        self.providers: dict[str, LLMProvider] = {}

        for provider_name in settings.enabled_providers:
            self.providers[provider_name] = self.all_providers[provider_name]

    def provider_for_model(self, model: str) -> LLMProvider:
        provider_name = self.settings.model_provider_map.get(model, self.settings.default_provider)
        provider = self.providers.get(provider_name)
        if provider is None:
            raise GatewayError(
                "LLM_PROVIDER_NOT_CONFIGURED",
                "No provider is configured for the requested model",
                status_code=400,
                details={"model": model, "provider": provider_name},
            )
        return provider

    def active_provider(self) -> LLMProvider:
        provider = self.providers.get(self.settings.default_provider)
        if provider is None:
            raise GatewayError(
                "LLM_PROVIDER_NOT_CONFIGURED",
                "The active provider is not enabled",
                status_code=400,
                details={"provider": self.settings.default_provider},
            )
        return provider

    async def list_models(self) -> list[ModelInfo]:
        tasks = [provider.list_models() for provider in self.providers.values()]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        models: list[ModelInfo] = []
        errors: dict[str, str] = {}
        for provider_name, result in zip(self.providers.keys(), results, strict=True):
            if isinstance(result, Exception):
                errors[provider_name] = result.__class__.__name__
                logger.warning(
                    "provider_model_listing_failed provider=%s reason=%s",
                    provider_name,
                    result.__class__.__name__,
                )
                continue
            models.extend(result)

        if not models and errors:
            raise GatewayError(
                "LLM_PROVIDER_UNAVAILABLE",
                "No configured LLM provider returned model metadata",
                status_code=503,
                details={"providers": errors},
            )

        return sorted(models, key=lambda item: (item.provider, item.model_id))

    async def providers_info(self) -> ProvidersResponse:
        infos: list[ProviderInfo] = []
        enabled = set(self.settings.enabled_providers)
        for provider_name, provider in self.all_providers.items():
            infos.append(
                await provider.provider_info(
                    enabled=provider_name in enabled,
                    active=provider_name == self.settings.default_provider,
                )
            )

        return ProvidersResponse(
            active_provider=self.settings.default_provider,
            providers=infos,
        )

    async def pull_model(self, model_name: str, kind: ModelKind) -> ModelPullResponse:
        return await self.active_provider().pull_model(model_name, kind)

    async def readiness(self) -> dict[str, object]:
        statuses: dict[str, bool] = {}
        for provider_name, provider in self.providers.items():
            statuses[provider_name] = await provider.ready()

        default_ready = statuses.get(self.settings.default_provider, False)
        return {
            "status": "ready" if default_ready else "not_ready",
            "service": self.settings.service_name,
            "default_provider": self.settings.default_provider,
            "providers": statuses,
        }
