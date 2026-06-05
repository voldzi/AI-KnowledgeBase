from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from app.schemas import (
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    EmbeddingsRequest,
    EmbeddingsResponse,
    ModelKind,
    ModelInfo,
    ModelPullResponse,
    ProviderInfo,
)


class LLMProvider(ABC):
    name: str

    @abstractmethod
    async def list_models(self) -> list[ModelInfo]:
        raise NotImplementedError

    @abstractmethod
    async def provider_info(self, enabled: bool, active: bool) -> ProviderInfo:
        raise NotImplementedError

    @abstractmethod
    async def pull_model(self, model_name: str, kind: ModelKind) -> ModelPullResponse:
        raise NotImplementedError

    @abstractmethod
    async def chat_completion(self, request: ChatCompletionRequest) -> ChatCompletionResponse:
        raise NotImplementedError

    @abstractmethod
    async def stream_chat_completion(
        self,
        request: ChatCompletionRequest,
    ) -> AsyncIterator[ChatCompletionChunk]:
        raise NotImplementedError

    @abstractmethod
    async def embeddings(self, request: EmbeddingsRequest) -> EmbeddingsResponse:
        raise NotImplementedError

    @abstractmethod
    async def ready(self) -> bool:
        raise NotImplementedError
