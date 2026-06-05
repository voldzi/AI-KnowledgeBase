#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


LLM_URL = os.getenv("AKL_SMOKE_LLM_URL", "http://localhost:8083").rstrip("/")
CHAT_MODEL = os.getenv("AKL_LLM_SMOKE_CHAT_MODEL", os.getenv("AKL_LLM_DEFAULT_CHAT_MODEL", "gemma4:12b"))
MAX_TOKENS = int(os.getenv("AKL_LLM_SMOKE_MAX_TOKENS", os.getenv("AKL_LLM_DEFAULT_MAX_TOKENS", "256")))


def main() -> int:
    print("Phase 02 LLM Gateway smoke test")
    print(f"LLM Gateway: {LLM_URL}")
    print(f"Chat model: {CHAT_MODEL}")

    health = request_json("GET", f"{LLM_URL}/health")
    if health.get("status") != "ok":
        raise RuntimeError(f"Healthcheck failed: {health}")
    print("OK health")

    response = request_json(
        "POST",
        f"{LLM_URL}/api/v1/models/test-chat",
        {
            "model": CHAT_MODEL,
            "prompt": "Odpověz česky jednou větou: k čemu slouží řízená dokumentace?",
            "think": False,
            "max_tokens": MAX_TOKENS,
        },
    )
    if response.get("provider") == "ollama" and response.get("finish_reason") == "length":
        raise RuntimeError(f"Ollama stopped because of length; increase max_tokens: {response}")
    if not response.get("content"):
        raise RuntimeError(f"Chat response content is empty: {response}")

    print(f"OK provider={response.get('provider')}")
    print(f"OK model={response.get('model')}")
    print(f"OK finish_reason={response.get('finish_reason')}")
    print("OK content_sample=", response["content"][:160].replace("\n", " "))
    return 0


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    expected_status: int = 200,
) -> dict[str, Any]:
    data = None
    headers = {
        "Content-Type": "application/json",
        "X-Request-ID": "phase-02-llm-gateway-smoke",
        "X-Correlation-ID": "phase-02-llm-gateway-smoke",
        "X-Service-Name": "phase-02-llm-gateway-smoke",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
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
