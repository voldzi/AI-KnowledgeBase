from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncIterator, Protocol

import httpx

from app.config import Settings
from app.errors import RetrievalError
from app.http_utils import outgoing_headers, request_json_with_retry
from app.security import AuthContext
from retrievers.scoring import deterministic_embedding


@dataclass(frozen=True)
class ChatCompletionResult:
    content: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


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
        model: str | None = None,
        auth_context: AuthContext | None = None,
    ) -> str:
        ...

    async def chat_completion_result(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        model: str | None = None,
        auth_context: AuthContext | None = None,
    ) -> ChatCompletionResult:
        ...

    def stream_chat_completion(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        model: str | None = None,
        auth_context: AuthContext | None = None,
    ) -> AsyncIterator[str]:
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
        model: str | None = None,
        auth_context: AuthContext | None = None,
    ) -> str:
        result = await self.chat_completion_result(
            messages=messages,
            metadata=metadata,
            model=model,
            auth_context=auth_context,
        )
        return result.content

    async def chat_completion_result(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        model: str | None = None,
        auth_context: AuthContext | None = None,
    ) -> ChatCompletionResult:
        if self._settings.mock_chat_response:
            content = self._settings.mock_chat_response
            return ChatCompletionResult(
                content=content,
                model=model or self._settings.chat_model,
                prompt_tokens=max(1, sum(len(message.get("content", "")) for message in messages) // 4),
                completion_tokens=max(1, len(content) // 4),
                total_tokens=max(2, (sum(len(message.get("content", "")) for message in messages) + len(content)) // 4),
            )
        context = _extract_context(messages)
        source_text = _first_source_text_line(context)
        first_sentence = source_text.split(".")[0].strip()
        if not first_sentence:
            if metadata.get("response_language") == "en":
                content = "No sufficiently reliable source was found for the question."
            else:
                content = "K dotazu nebyl nalezen dostatečně důvěryhodný zdroj."
            return ChatCompletionResult(content=content, model=model or self._settings.chat_model)
        if metadata.get("response_language") == "en":
            content = f"According to the cited sources: {first_sentence}."
        else:
            content = f"Podle citovanych zdroju: {first_sentence}."
        return ChatCompletionResult(content=content, model=model or self._settings.chat_model)

    async def stream_chat_completion(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        model: str | None = None,
        auth_context: AuthContext | None = None,
    ) -> AsyncIterator[str]:
        answer = await self.chat_completion(messages=messages, metadata=metadata, model=model, auth_context=auth_context)
        for index, word in enumerate(answer.split(" ")):
            yield word if index == 0 else f" {word}"

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
        json_body: dict[str, Any] = {
            "model": self._settings.embedding_model,
            "input": texts,
            "metadata": {"purpose": "rag_retrieval"},
        }
        if self._settings.embedding_dimensions is not None:
            json_body["dimensions"] = self._settings.embedding_dimensions
        payload = await request_json_with_retry(
            dependency="llm-gateway",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.llm_gateway_base_url}/embeddings",
            json_body=json_body,
            auth_context=auth_context,
            bearer_token_override=self._settings.llm_gateway_token,
            service_identity=True,
            audience=self._settings.llm_gateway_audience,
        )
        data = payload.get("data", [])
        return [item["embedding"] for item in sorted(data, key=lambda item: item.get("index", 0))]

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        model: str | None = None,
        auth_context: AuthContext | None = None,
    ) -> str:
        result = await self.chat_completion_result(
            messages=messages,
            metadata=metadata,
            model=model,
            auth_context=auth_context,
        )
        return result.content

    async def chat_completion_result(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        model: str | None = None,
        auth_context: AuthContext | None = None,
    ) -> ChatCompletionResult:
        selected_model = model or self._settings.chat_model
        payload = await request_json_with_retry(
            dependency="llm-gateway",
            settings=self._settings,
            method="POST",
            url=f"{self._settings.llm_gateway_base_url}/chat/completions",
            json_body={
                "model": selected_model,
                "messages": messages,
                "temperature": 0.1,
                "max_tokens": self._settings.answer_max_tokens,
                "stream": False,
                "metadata": metadata,
            },
            auth_context=auth_context,
            bearer_token_override=self._settings.llm_gateway_token,
            service_identity=True,
            audience=self._settings.llm_gateway_audience,
        )
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        return ChatCompletionResult(
            content=str(payload.get("content", "")).strip(),
            model=str(payload.get("model") or selected_model),
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            total_tokens=int(usage.get("total_tokens") or 0),
        )

    async def stream_chat_completion(
        self,
        *,
        messages: list[dict[str, str]],
        metadata: dict[str, Any],
        model: str | None = None,
        auth_context: AuthContext | None = None,
    ) -> AsyncIterator[str]:
        selected_model = model or self._settings.chat_model
        timeout = httpx.Timeout(self._settings.request_timeout_seconds, read=None)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST",
                    f"{self._settings.llm_gateway_base_url}/chat/completions",
                    headers=outgoing_headers(
                        self._settings,
                        auth_context,
                        bearer_token_override=self._settings.llm_gateway_token,
                        service_identity=True,
                        audience=self._settings.llm_gateway_audience,
                    ),
                    json={
                        "model": selected_model,
                        "messages": messages,
                        "temperature": 0.1,
                        "max_tokens": self._settings.answer_max_tokens,
                        "stream": True,
                        "metadata": metadata,
                    },
                ) as response:
                    if response.status_code >= 400:
                        raise RetrievalError(
                            "UPSTREAM_ERROR",
                            "llm-gateway returned an error",
                            status_code=502,
                            details={"dependency": "llm-gateway", "status_code": response.status_code},
                        )
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data = line.removeprefix("data: ").strip()
                        if data == "[DONE]":
                            return
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        delta = str(chunk.get("delta") or "")
                        if delta:
                            yield delta
        except RetrievalError:
            raise
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise RetrievalError(
                "UPSTREAM_UNAVAILABLE",
                "llm-gateway is not reachable",
                status_code=502,
                details={"dependency": "llm-gateway", "reason": exc.__class__.__name__},
            ) from exc

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
            for marker in ("KONTEXT:", "CONTEXT:"):
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
