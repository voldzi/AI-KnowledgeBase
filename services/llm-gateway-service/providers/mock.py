from __future__ import annotations

import hashlib
import uuid
from collections.abc import AsyncIterator

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


class MockProvider(LLMProvider):
    name = "mock"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(
                model_id="mock-chat",
                provider="mock",
                capabilities=["chat"],
                context_window=8192,
            ),
            ModelInfo(
                model_id="mock-embedding",
                provider="mock",
                capabilities=["embeddings"],
                context_window=None,
            ),
        ]

    async def provider_info(self, enabled: bool, active: bool) -> ProviderInfo:
        return ProviderInfo(
            name="mock",
            enabled=enabled,
            active=active,
            available=True,
            supports_chat=True,
            supports_embeddings=True,
            supports_model_pull=False,
            supports_model_delete=False,
        )

    async def pull_model(self, model_name: str, kind: ModelKind) -> ModelPullResponse:
        return ModelPullResponse(
            status="unsupported",
            provider="mock",
            model=model_name,
            message=f"Mock provider does not support pulling {kind} models.",
        )

    async def chat_completion(self, request: ChatCompletionRequest) -> ChatCompletionResponse:
        prompt_tokens = _estimate_prompt_tokens(request)
        completion_tokens = len(self.settings.mock_chat_response.split())
        return ChatCompletionResponse(
            id=f"cmpl_{uuid.uuid4().hex}",
            model=request.model,
            content=self.settings.mock_chat_response,
            finish_reason="stop",
            usage=Usage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
            ),
            provider="mock",
        )

    async def stream_chat_completion(
        self,
        request: ChatCompletionRequest,
    ) -> AsyncIterator[ChatCompletionChunk]:
        completion_id = f"cmpl_{uuid.uuid4().hex}"
        words = self.settings.mock_chat_response.split()
        for index, word in enumerate(words):
            suffix = " " if index < len(words) - 1 else ""
            yield ChatCompletionChunk(
                id=completion_id,
                model=request.model,
                delta=f"{word}{suffix}",
                finish_reason=None,
                provider="mock",
            )
        yield ChatCompletionChunk(
            id=completion_id,
            model=request.model,
            delta="",
            finish_reason="stop",
            provider="mock",
        )

    async def embeddings(self, request: EmbeddingsRequest) -> EmbeddingsResponse:
        items = [
            EmbeddingItem(index=index, embedding=_deterministic_embedding(text, request.model, self.settings))
            for index, text in enumerate(request.input)
        ]
        return EmbeddingsResponse(model=request.model, data=items, provider="mock")

    async def ready(self) -> bool:
        return True


def _estimate_prompt_tokens(request: ChatCompletionRequest) -> int:
    return sum(len(message.content.split()) for message in request.messages)


def _deterministic_embedding(text: str, model: str, settings: Settings) -> list[float]:
    values: list[float] = []
    for index in range(settings.mock_embedding_dimensions):
        digest = hashlib.sha256(f"{model}:{index}:{text}".encode("utf-8")).digest()
        integer = int.from_bytes(digest[:4], byteorder="big", signed=False)
        values.append(round((integer / 2**32) * 2 - 1, 6))
    return values
