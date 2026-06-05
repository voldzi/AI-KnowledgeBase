from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.config import Settings
from app.schemas import (
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    EmbeddingItem,
    EmbeddingsRequest,
    EmbeddingsResponse,
    ModelKind,
    ModelInfo,
    ModelPullResponse,
    ProviderInfo,
    Usage,
)
from providers.base import LLMProvider
from providers.http_utils import outgoing_headers, provider_error, request_json_with_retry


class OpenAICompatibleProvider(LLMProvider):
    name = "openai"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def list_models(self) -> list[ModelInfo]:
        models = await self._fetch_model_items(allow_empty=False)
        return [
            ModelInfo(
                model_id=str(item.get("id")),
                provider="openai",
                capabilities=["chat", "embeddings"],
                context_window=None,
            )
            for item in models
            if item.get("id")
        ]

    async def provider_info(self, enabled: bool, active: bool) -> ProviderInfo:
        try:
            await self._fetch_model_items(allow_empty=True)
            return ProviderInfo(
                name="openai",
                enabled=enabled,
                active=active,
                available=True,
                supports_chat=True,
                supports_embeddings=True,
                supports_model_pull=False,
                supports_model_delete=False,
                base_url=self.settings.openai_base_url,
            )
        except Exception as exc:
            return ProviderInfo(
                name="openai",
                enabled=enabled,
                active=active,
                available=False,
                supports_chat=True,
                supports_embeddings=True,
                supports_model_pull=False,
                supports_model_delete=False,
                base_url=self.settings.openai_base_url,
                error_code=exc.__class__.__name__,
                error_message="OpenAI-compatible endpoint is not reachable or did not return model metadata.",
            )

    async def pull_model(self, model_name: str, kind: ModelKind) -> ModelPullResponse:
        return ModelPullResponse(
            status="unsupported",
            provider="openai",
            model=model_name,
            message=f"OpenAI-compatible provider does not support pulling {kind} models through this gateway.",
        )

    async def _fetch_model_items(self, allow_empty: bool) -> list[dict[str, Any]]:
        data = await request_json_with_retry(
            provider=self.name,
            settings=self.settings,
            method="GET",
            url=f"{self.settings.openai_base_url}/v1/models",
            headers=outgoing_headers(self.settings, self.settings.openai_api_key),
        )
        models = data.get("data", [])
        if not isinstance(models, list):
            raise provider_error(self.name, "OpenAI-compatible endpoint returned an invalid model list")
        if not models and not allow_empty:
            raise provider_error(
                self.name,
                "OpenAI-compatible endpoint returned no models; check runtime model loading",
            )
        return [item for item in models if isinstance(item, dict)]

    async def chat_completion(self, request: ChatCompletionRequest) -> ChatCompletionResponse:
        data = await request_json_with_retry(
            provider=self.name,
            settings=self.settings,
            method="POST",
            url=f"{self.settings.openai_base_url}/v1/chat/completions",
            headers=outgoing_headers(self.settings, self.settings.openai_api_key),
            json_body=_chat_payload(request, stream=False),
        )
        choice = _first_choice(data, self.name)
        message = choice.get("message", {})
        if not isinstance(message, dict):
            raise provider_error(self.name, "OpenAI-compatible endpoint returned an invalid chat response")

        usage = data.get("usage", {})
        if not isinstance(usage, dict):
            usage = {}

        return ChatCompletionResponse(
            id=str(data.get("id") or ""),
            model=str(data.get("model") or request.model),
            content=str(message.get("content") or ""),
            finish_reason=str(choice.get("finish_reason") or "stop"),
            usage=Usage(
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
                total_tokens=int(usage.get("total_tokens") or 0),
            ),
            provider="openai",
        )

    async def stream_chat_completion(
        self,
        request: ChatCompletionRequest,
    ) -> AsyncIterator[ChatCompletionChunk]:
        async for item in _stream_openai_events(
            provider=self.name,
            settings=self.settings,
            url=f"{self.settings.openai_base_url}/v1/chat/completions",
            headers=outgoing_headers(self.settings, self.settings.openai_api_key),
            json_body=_chat_payload(request, stream=True),
        ):
            choice = _first_choice(item, self.name)
            delta = choice.get("delta", {})
            content = delta.get("content", "") if isinstance(delta, dict) else ""
            yield ChatCompletionChunk(
                id=str(item.get("id") or ""),
                model=str(item.get("model") or request.model),
                delta=str(content or ""),
                finish_reason=choice.get("finish_reason"),
                provider="openai",
            )

    async def embeddings(self, request: EmbeddingsRequest) -> EmbeddingsResponse:
        data = await request_json_with_retry(
            provider=self.name,
            settings=self.settings,
            method="POST",
            url=f"{self.settings.openai_base_url}/v1/embeddings",
            headers=outgoing_headers(self.settings, self.settings.openai_api_key),
            json_body={"model": request.model, "input": request.input},
        )

        items = data.get("data", [])
        if not isinstance(items, list):
            raise provider_error(self.name, "OpenAI-compatible endpoint returned an invalid embeddings response")

        return EmbeddingsResponse(
            model=str(data.get("model") or request.model),
            data=[
                EmbeddingItem(
                    index=int(item.get("index", index)),
                    embedding=[float(value) for value in item.get("embedding", [])],
                )
                for index, item in enumerate(items)
                if isinstance(item, dict)
            ],
            provider="openai",
        )

    async def ready(self) -> bool:
        try:
            await self.list_models()
            return True
        except Exception:
            return False


def _chat_payload(request: ChatCompletionRequest, stream: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": request.model,
        "messages": [message.model_dump() for message in request.messages],
        "stream": stream,
    }
    if request.temperature is not None:
        payload["temperature"] = request.temperature
    if request.top_p is not None:
        payload["top_p"] = request.top_p
    if request.max_tokens is not None:
        payload["max_tokens"] = request.max_tokens
    return payload


def _first_choice(data: dict[str, Any], provider: str) -> dict[str, Any]:
    choices = data.get("choices", [])
    if not choices or not isinstance(choices, list) or not isinstance(choices[0], dict):
        raise provider_error(provider, "LLM provider response does not contain choices")
    return choices[0]


async def _stream_openai_events(
    *,
    provider: str,
    settings: Settings,
    url: str,
    headers: dict[str, str],
    json_body: dict[str, Any],
) -> AsyncIterator[dict[str, Any]]:
    for attempt in range(settings.retry_attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                async with client.stream("POST", url, headers=headers, json=json_body) as response:
                    if response.status_code >= 500 and attempt < settings.retry_attempts:
                        await response.aread()
                        await asyncio.sleep(settings.retry_backoff_seconds * (attempt + 1))
                        continue
                    if response.status_code >= 400:
                        await response.aread()
                        raise provider_error(
                            provider,
                            "LLM provider returned an error",
                            {"status_code": response.status_code},
                        )
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line.removeprefix("data:").strip()
                        if payload == "[DONE]":
                            return
                        yield json.loads(payload)
                    return
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            if attempt < settings.retry_attempts:
                await asyncio.sleep(settings.retry_backoff_seconds * (attempt + 1))
                continue
            raise provider_error(
                provider,
                "LLM provider stream is not reachable",
                {"reason": exc.__class__.__name__},
            ) from exc
