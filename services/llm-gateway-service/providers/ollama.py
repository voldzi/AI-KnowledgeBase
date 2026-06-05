from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.config import Settings
from app.errors import GatewayError
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


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def list_models(self) -> list[ModelInfo]:
        models = await self._fetch_model_items(allow_empty=False)

        return [
            ModelInfo(
                model_id=str(item.get("name")),
                provider="ollama",
                capabilities=_infer_capabilities(str(item.get("name", ""))),
                context_window=None,
            )
            for item in models
            if item.get("name")
        ]

    async def provider_info(self, enabled: bool, active: bool) -> ProviderInfo:
        try:
            await self._fetch_model_items(allow_empty=True)
            return ProviderInfo(
                name="ollama",
                enabled=enabled,
                active=active,
                available=True,
                supports_chat=True,
                supports_embeddings=True,
                supports_model_pull=True,
                supports_model_delete=False,
                base_url=self.settings.ollama_base_url,
            )
        except Exception as exc:
            return ProviderInfo(
                name="ollama",
                enabled=enabled,
                active=active,
                available=False,
                supports_chat=True,
                supports_embeddings=True,
                supports_model_pull=True,
                supports_model_delete=False,
                base_url=self.settings.ollama_base_url,
                error_code=exc.__class__.__name__,
                error_message="Ollama is not reachable or did not return model metadata.",
            )

    async def pull_model(self, model_name: str, kind: ModelKind) -> ModelPullResponse:
        if not self.settings.allow_model_pull:
            return ModelPullResponse(
                status="disabled",
                provider="ollama",
                model=model_name,
                message="Model pull is disabled. Set AKL_LLM_ALLOW_MODEL_PULL=true to enable it.",
            )

        async with httpx.AsyncClient(timeout=self.settings.model_pull_timeout_seconds) as client:
            response = await client.post(
                f"{self.settings.ollama_base_url}/api/pull",
                headers=outgoing_headers(self.settings),
                json={"name": model_name, "stream": False},
            )

        if response.status_code >= 400:
            raise provider_error(
                self.name,
                "Ollama model pull failed",
                {"status_code": response.status_code, "kind": kind},
            )

        return ModelPullResponse(
            status="completed",
            provider="ollama",
            model=model_name,
            message="Model pull completed.",
        )

    async def _fetch_model_items(self, allow_empty: bool) -> list[dict[str, Any]]:
        data = await request_json_with_retry(
            provider=self.name,
            settings=self.settings,
            method="GET",
            url=f"{self.settings.ollama_base_url}/api/tags",
            headers=outgoing_headers(self.settings),
        )
        models = data.get("models", [])
        if not isinstance(models, list):
            raise provider_error(self.name, "Ollama returned an invalid model list")
        if not models and not allow_empty:
            raise provider_error(
                self.name,
                "Ollama returned no models; pull at least one model for the selected profile",
            )
        return [item for item in models if isinstance(item, dict)]

    async def chat_completion(self, request: ChatCompletionRequest) -> ChatCompletionResponse:
        data = await request_json_with_retry(
            provider=self.name,
            settings=self.settings,
            method="POST",
            url=f"{self.settings.ollama_base_url}/api/chat",
            headers=outgoing_headers(self.settings),
            json_body=_chat_payload(request, self.settings, stream=False),
        )

        message = data.get("message", {})
        if not isinstance(message, dict):
            raise provider_error(self.name, "Ollama returned an invalid chat response")

        content = str(message.get("content") or "")
        thinking = message.get("thinking")
        finish_reason = str(data.get("done_reason") or "stop")
        if content == "" and _has_thinking(thinking):
            raise GatewayError(
                "EMPTY_CONTENT_THINKING_ONLY",
                "Ollama returned thinking output but empty content. Disable thinking with think=false or increase max_tokens.",
                status_code=502,
                details={"provider": self.name, "model": request.model, "finish_reason": finish_reason},
            )

        prompt_tokens = int(data.get("prompt_eval_count") or 0)
        completion_tokens = int(data.get("eval_count") or 0)

        return ChatCompletionResponse(
            id=f"cmpl_{uuid.uuid4().hex}",
            model=request.model,
            content=content,
            finish_reason=finish_reason,
            usage=Usage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
            ),
            provider="ollama",
        )

    async def stream_chat_completion(
        self,
        request: ChatCompletionRequest,
    ) -> AsyncIterator[ChatCompletionChunk]:
        completion_id = f"cmpl_{uuid.uuid4().hex}"
        async for item in _stream_json_lines(
            provider=self.name,
            settings=self.settings,
            url=f"{self.settings.ollama_base_url}/api/chat",
            headers=outgoing_headers(self.settings),
            json_body=_chat_payload(request, self.settings, stream=True),
        ):
            message = item.get("message", {})
            delta = message.get("content", "") if isinstance(message, dict) else ""
            finish_reason = str(item.get("done_reason")) if item.get("done") else None
            yield ChatCompletionChunk(
                id=completion_id,
                model=request.model,
                delta=str(delta),
                finish_reason=finish_reason,
                provider="ollama",
            )

    async def embeddings(self, request: EmbeddingsRequest) -> EmbeddingsResponse:
        data = await request_json_with_retry(
            provider=self.name,
            settings=self.settings,
            method="POST",
            url=f"{self.settings.ollama_base_url}/api/embed",
            headers=outgoing_headers(self.settings),
            json_body={"model": request.model, "input": request.input},
        )

        embeddings = data.get("embeddings")
        if not isinstance(embeddings, list):
            raise provider_error(self.name, "Ollama returned an invalid embeddings response")

        return EmbeddingsResponse(
            model=request.model,
            data=[
                EmbeddingItem(index=index, embedding=[float(value) for value in embedding])
                for index, embedding in enumerate(embeddings)
            ],
            provider="ollama",
        )

    async def ready(self) -> bool:
        try:
            await self.list_models()
            return True
        except Exception:
            return False


def _chat_payload(request: ChatCompletionRequest, settings: Settings, stream: bool) -> dict[str, Any]:
    options: dict[str, Any] = {}
    if request.temperature is not None:
        options["temperature"] = request.temperature
    if request.top_p is not None:
        options["top_p"] = request.top_p
    options["num_predict"] = request.max_tokens or settings.default_max_tokens

    if settings.ollama_think is False or request.think is False:
        effective_think = False
    elif request.think is True:
        effective_think = True
    else:
        effective_think = settings.ollama_think

    payload: dict[str, Any] = {
        "model": request.model,
        "messages": [message.model_dump() for message in request.messages],
        "stream": stream,
        "think": effective_think,
    }
    if options:
        payload["options"] = options
    return payload


def _has_thinking(thinking: Any) -> bool:
    if thinking is None:
        return False
    if isinstance(thinking, str):
        return thinking.strip() != ""
    if isinstance(thinking, (list, dict, tuple, set)):
        return len(thinking) > 0
    return True


def _infer_capabilities(model_id: str) -> list[str]:
    lower = model_id.lower()
    if any(fragment in lower for fragment in ("embed", "bge", "nomic")):
        return ["embeddings"]
    return ["chat"]


async def _stream_json_lines(
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
                        if not line.strip():
                            continue
                        yield json.loads(line)
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
