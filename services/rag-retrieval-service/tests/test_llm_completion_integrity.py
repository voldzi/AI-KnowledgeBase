from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import pytest

from answer_composer.composer import AnswerComposer
from app import llm_client
from app.config import load_settings
from app.errors import RetrievalError
from app.llm_client import HttpLLMGatewayClient
from app.schemas import ChunkCitation, RetrievedChunk
from tests.conftest import make_client


def settings():
    return load_settings({"AKL_ENV": "test", "AKL_AUTH_MODE": "disabled", "AKL_RAG_DEPENDENCY_MODE": "mock"})


@pytest.mark.parametrize("reason", ["length", "content_filter", "tool_calls", None, "unknown", {}])
def test_incomplete_non_stream_answer_is_rejected_without_logging_content(monkeypatch, reason):
    monkeypatch.setattr(llm_client, "request_json_with_retry", AsyncMock(return_value={
        "content": "sensitive unfinished passage", "finish_reason": reason,
    }))
    with pytest.raises(RetrievalError) as failure:
        asyncio.run(HttpLLMGatewayClient(settings()).chat_completion(messages=[], metadata={}))
    assert failure.value.code == "LLM_ANSWER_INCOMPLETE"
    assert "sensitive" not in json.dumps(failure.value.details)
    assert "sensitive" not in failure.value.message


def test_complete_answer_keeps_usage_and_bounded_token_budget(monkeypatch):
    request = AsyncMock(return_value={
        "content": "Complete answer.", "finish_reason": "stop", "usage": {"total_tokens": 42},
    })
    monkeypatch.setattr(llm_client, "request_json_with_retry", request)
    result = asyncio.run(HttpLLMGatewayClient(settings()).chat_completion_result(messages=[], metadata={}))
    assert result.content == "Complete answer."
    assert result.finish_reason == "stop"
    assert result.total_tokens == 42
    assert request.call_args.kwargs["json_body"]["max_tokens"] == 1536


@pytest.mark.parametrize("reason,done,expected", [
    ("stop", True, True), ("length", True, False), (None, True, False), ("stop", False, False),
])
def test_stream_requires_explicit_successful_termination(monkeypatch, reason, done, expected):
    lines = [json.dumps({"delta": "Some text", "finish_reason": None})]
    if reason is not None:
        lines.append(json.dumps({"delta": "", "finish_reason": reason}))
    if done:
        lines.append("[DONE]")
    body = "".join(f"data: {line}\n\n" for line in lines)
    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text=body))
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original_client(transport=transport, **kwargs))

    async def collect():
        return [delta async for delta in HttpLLMGatewayClient(settings()).stream_chat_completion(messages=[], metadata={})]

    if expected:
        assert asyncio.run(collect()) == ["Some text"]
    else:
        with pytest.raises(RetrievalError) as failure:
            asyncio.run(collect())
        assert failure.value.code == "LLM_ANSWER_INCOMPLETE"


class InterruptedClient:
    async def chat_completion(self, **kwargs):
        raise RetrievalError("LLM_ANSWER_INCOMPLETE", "Incomplete")

    async def stream_chat_completion(self, **kwargs):
        yield "Unfinished passage"
        raise RetrievalError("LLM_ANSWER_INCOMPLETE", "Incomplete")


def test_composer_replaces_partial_prose_and_never_certifies_it():
    chunk = RetrievedChunk(
        chunk_id="chunk-test", score=0.95, retrieval_method="hybrid", text="Authorized source.",
        citation=ChunkCitation(document_id="doc-test", document_version_id="version-test",
                               document_title="Source", version_label="1", page_number=1, section_path=[]),
    )
    composer = AnswerComposer(settings(), InterruptedClient())
    arguments = dict(query_id="query-test", query="Summarize", chunks=[chunk], confidence="high",
                     warnings=[], max_chunks=1, response_language="en")
    answer = asyncio.run(composer.compose(**arguments))

    async def stream():
        return [event async for event in composer.compose_stream(**arguments)]

    events = asyncio.run(stream())
    assert any(event.kind == "delta" for event in events)
    for result in [answer, events[-1].answer]:
        assert result.confidence == "insufficient_source"
        assert result.citations == []
        assert result.used_chunks == []
        assert "LLM_ANSWER_INCOMPLETE" in result.warnings
        assert "could not be completed" in result.answer
        assert "Unfinished passage" not in result.answer


def test_employee_chat_distinguishes_incomplete_generation_from_missing_sources():
    with make_client() as client:
        service = client.app.state.rag_service
        service._answer_composer._llm_client = InterruptedClient()
        response = client.post("/api/v1/assistant/chat", json={
            "user_id": "user_123", "message": "Kdo schvaluje vyjimku?", "response_language": "en",
            "context": {"approval_subject": "vyjimka ze smernice"},
        })
    assert response.status_code == 200
    payload = response.json()
    assert payload["response_type"] == "no_answer"
    assert payload["confidence"] == "insufficient_source"
    assert "could not be completed" in payload["answer"]
    assert "LLM_ANSWER_INCOMPLETE" in payload["warnings"]
