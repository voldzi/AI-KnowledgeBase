from __future__ import annotations

from typing import Any, Protocol

from app.config import Settings
from app.http_utils import request_json_with_retry
from app.security import AuthContext
from retrievers.scoring import deterministic_embedding


class LLMGatewayClient(Protocol):
    async def embeddings(
        self,
        texts: list[str],
        *,
        auth_context: AuthContext | None = None,
    ) -> list[list[float]]:
        ...

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        auth_context: AuthContext | None = None,
    ) -> str:
        ...

    async def readiness(self) -> str:
        ...


class MockLLMGatewayClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def embeddings(
        self,
        texts: list[str],
        *,
        auth_context: AuthContext | None = None,
    ) -> list[list[float]]:
        return [deterministic_embedding(text) for text in texts]

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        auth_context: AuthContext | None = None,
    ) -> str:
        if self._settings.mock_chat_response:
            return self._settings.mock_chat_response
        context = _extract_context(messages)
        source_text = _first_source_text_line(context)
        first_sentence = source_text.split(".")[0].strip()
        if not first_sentence:
            return "K dotazu nebyl nalezen dostatecne oporyhodny zdroj."
        return f"Podle citovanych zdroju: {first_sentence}."

    async def readiness(self) -> str:
        return "ready"


class HttpLLMGatewayClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def embeddings(
        self,
        texts: list[str],
        *,
        auth_context: AuthContext | None = None,
    ) -> list[list[float]]:
        payload = await request_json_with_retry(
            dependency="llm-gateway",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.llm_gateway_base_url}/embeddings",
            json_body={
                "model": self._settings.embedding_model,
                "input": texts,
                "metadata": {"purpose": "rag_retrieval"},
            },
            auth_context=auth_context,
        )
        data = payload.get("data", [])
        return [item["embedding"] for item in sorted(data, key=lambda item: item.get("index", 0))]

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        auth_context: AuthContext | None = None,
    ) -> str:
        payload = await request_json_with_retry(
            dependency="llm-gateway",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.llm_gateway_base_url}/chat/completions",
            json_body={
                "model": self._settings.chat_model,
                "messages": messages,
                "temperature": 0.1,
                "max_tokens": 900,
                "stream": False,
                "metadata": metadata,
            },
            auth_context=auth_context,
        )
        return str(payload.get("content", "")).strip()

    async def readiness(self) -> str:
        try:
            await request_json_with_retry(
                dependency="llm-gateway",
                settings=self._settings,
                method="GET",
                url=f"{self._settings.llm_gateway_base_url.removesuffix('/api/v1')}/ready",
            )
        except Exception:
            return "not_ready"
        return "ready"


def create_llm_client(settings: Settings) -> LLMGatewayClient:
    if settings.llm_client_mode == "mock":
        return MockLLMGatewayClient(settings)
    return HttpLLMGatewayClient(settings)


def _extract_context(messages: list[dict[str, str]]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            content = message.get("content", "")
            marker = "KONTEXT:"
            if marker in content:
                return content.split(marker, 1)[1]
    return ""


def _first_source_text_line(context: str) -> str:
    for line in context.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("["):
            continue
        return stripped
    return ""
