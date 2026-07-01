#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


LLM_URL = os.getenv("AKL_SMOKE_LLM_URL", "http://localhost:8083").rstrip("/")
CHAT_MODEL = os.getenv("AKL_LLM_SMOKE_CHAT_MODEL", "gemma4:12b-mlx")
EMBEDDING_MODEL = os.getenv("AKL_LLM_SMOKE_EMBEDDING_MODEL", "bge-m3")
BEARER_TOKEN = os.getenv("AKL_SMOKE_LLM_BEARER_TOKEN")


def main() -> int:
    print("Phase 02B non-mock LLM smoke test")
    print(f"LLM Gateway: {LLM_URL}")

    health = request_json("GET", f"{LLM_URL}/health")
    if health.get("status") != "ok":
        raise RuntimeError(f"LLM Gateway healthcheck failed: {health}")
    print("OK health")

    ready = request_json("GET", f"{LLM_URL}/ready")
    if ready.get("status") != "ready":
        raise RuntimeError(
            "LLM Gateway is not ready. "
            "Check AKL_LLM_DEFAULT_PROVIDER=ollama and AKL_OLLAMA_BASE_URL. "
            f"Response: {ready}"
        )
    if ready.get("default_provider") == "mock":
        raise RuntimeError("LLM Gateway default provider is still mock; enable the non-mock Ollama profile first.")
    print(f"OK ready provider={ready.get('default_provider')}")

    models_body = request_json("GET", f"{LLM_URL}/api/v1/models")
    models = models_body.get("models") or []
    non_mock_models = [model for model in models if model.get("provider") != "mock"]
    if not non_mock_models:
        raise RuntimeError(
            "/api/v1/models returned no non-mock model. "
            "Start Ollama and pull at least one chat model and one embedding model."
        )
    print("OK non-mock models=", ", ".join(model["model_id"] for model in non_mock_models))

    chat_model = CHAT_MODEL or select_model(non_mock_models, "chat")
    embedding_model = EMBEDDING_MODEL or select_model(non_mock_models, "embeddings")
    assert_model_available(non_mock_models, chat_model, "chat")
    assert_model_available(non_mock_models, embedding_model, "embeddings")

    embedding = request_json(
        "POST",
        f"{LLM_URL}/api/v1/embeddings",
        {
            "model": embedding_model,
            "input": ["AKL Phase 02B non-mock embedding smoke input."],
            "metadata": {"purpose": "phase_02b_non_mock_smoke"},
        },
    )
    if embedding.get("provider") == "mock":
        raise RuntimeError("Embeddings response came from mock provider.")
    vector = embedding.get("data", [{}])[0].get("embedding", [])
    if not vector:
        raise RuntimeError(f"Embeddings response did not include a vector: {embedding}")
    print(f"OK embeddings provider={embedding.get('provider')} model={embedding.get('model')} dimensions={len(vector)}")

    completion = request_json(
        "POST",
        f"{LLM_URL}/api/v1/chat/completions",
        {
            "model": chat_model,
            "messages": [{"role": "user", "content": "Return exactly: AKL non-mock LLM OK"}],
            "think": False,
            "temperature": 0,
            "max_tokens": 32,
            "metadata": {"purpose": "phase_02b_non_mock_smoke"},
        },
    )
    if completion.get("provider") == "mock":
        raise RuntimeError("Chat completion response came from mock provider.")
    if not completion.get("content"):
        raise RuntimeError(f"Chat completion response had empty content: {completion}")
    print(f"OK chat provider={completion.get('provider')} model={completion.get('model')}")
    print("OK content_sample=", completion["content"][:120].replace("\n", " "))
    return 0


def select_model(models: list[dict[str, Any]], capability: str) -> str:
    for model in models:
        if capability in set(model.get("capabilities") or []):
            return str(model["model_id"])
    raise RuntimeError(
        f"No non-mock model advertises capability '{capability}'. "
        "Set AKL_LLM_SMOKE_CHAT_MODEL or AKL_LLM_SMOKE_EMBEDDING_MODEL explicitly if capability inference is wrong."
    )


def assert_model_available(models: list[dict[str, Any]], model_id: str, capability: str) -> None:
    for model in models:
        if model.get("model_id") == model_id:
            if capability not in set(model.get("capabilities") or []):
                raise RuntimeError(
                    f"Model '{model_id}' is listed but does not advertise capability '{capability}'. "
                    "Adjust smoke model env vars or model naming."
                )
            return
    raise RuntimeError(
        f"Configured smoke model '{model_id}' was not returned by /api/v1/models. "
        "Pull the model in Ollama or change AKL_LLM_SMOKE_*_MODEL."
    )


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    expected_status: int = 200,
) -> dict[str, Any]:
    data = None
    headers = {
        "Content-Type": "application/json",
        "X-Request-ID": "phase-02b-llm-smoke",
        "X-Correlation-ID": "phase-02b-llm-smoke",
        "X-Service-Name": "phase-02b-smoke",
    }
    if BEARER_TOKEN:
        headers["Authorization"] = f"Bearer {BEARER_TOKEN}"
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
            if response.status != expected_status:
                raise RuntimeError(f"{method} {url} returned {response.status}: {body}")
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} returned {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {url} failed: {exc.reason}") from exc


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
