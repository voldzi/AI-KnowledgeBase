#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


REGISTRY_URL = os.getenv("AKL_SMOKE_REGISTRY_URL", "http://localhost:8001").rstrip("/")
INGESTION_URL = os.getenv("AKL_SMOKE_INGESTION_URL", "http://localhost:8090").rstrip("/")
RAG_URL = os.getenv("AKL_SMOKE_RAG_URL", "http://localhost:8082").rstrip("/")
LLM_URL = os.getenv("AKL_SMOKE_LLM_URL", "http://localhost:8083").rstrip("/")
WEB_URL = os.getenv("AKL_SMOKE_WEB_URL", "http://localhost:3002").rstrip("/")
QDRANT_URL = os.getenv("AKL_SMOKE_QDRANT_URL", "http://localhost:6333").rstrip("/")
QDRANT_COLLECTION = os.getenv("AKL_QDRANT_COLLECTION", "akl_document_chunks")
DOCS_TAG = os.getenv("AKL_PHASE_03_DOCS_TAG", "akb-docs")
DOCS_QUERY = os.getenv("AKL_PHASE_03_DOCS_QUERY", "Jak funguje RAG retrieval a citace?")
SUBJECT_ID = os.getenv("AKL_SMOKE_SUBJECT_ID", "user_dev")
ROLES = os.getenv("AKL_SMOKE_ROLES", "admin,document_manager,reader")


def main() -> int:
    print("Phase 03 local production smoke test")
    check_stack_health()
    effective_config = check_llm_config()
    check_qdrant_collection()
    docs_count = check_docs_imported()
    answer = query_docs_rag()
    check_web_health()
    check_web_assistant_route()

    print("OK active_provider=", effective_config.get("active_provider"))
    print("OK default_chat_model=", effective_config.get("default_chat_model"))
    print("OK default_embedding_model=", effective_config.get("default_embedding_model"))
    print("OK docs_qdrant_count=", docs_count)
    print("OK cited_chunk_id=", answer["citations"][0]["chunk_id"])
    print("OK query_id=", answer["query_id"])
    print("OK web_health=", WEB_URL)
    print("OK employee_assistant=", WEB_URL + "/assistant")
    return 0


def check_stack_health() -> None:
    for endpoint in (f"{REGISTRY_URL}/health", f"{INGESTION_URL}/health", f"{RAG_URL}/health", f"{LLM_URL}/health"):
        body = request_json("GET", endpoint)
        if body.get("status") != "ok":
            raise RuntimeError(f"Healthcheck failed for {endpoint}: {body}")
    print("OK healthchecks")


def check_llm_config() -> dict[str, Any]:
    body = request_json("GET", f"{LLM_URL}/api/v1/config/effective")
    if body.get("active_provider") != "ollama":
        raise RuntimeError(f"LLM Gateway is not using Ollama: {body}")
    if body.get("default_chat_model") != "gemma4:12b-mlx":
        raise RuntimeError(f"Unexpected chat model: {body}")
    if body.get("default_embedding_model") != "bge-m3":
        raise RuntimeError(f"Unexpected embedding model: {body}")
    if body.get("ollama_think") is not False:
        raise RuntimeError(f"ollama_think must be false: {body}")
    return body


def check_qdrant_collection() -> None:
    body = request_json("GET", f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}", headers=qdrant_headers())
    vectors = body.get("result", {}).get("config", {}).get("params", {}).get("vectors", {})
    if vectors.get("size") != 1024 or str(vectors.get("distance", "")).lower() != "cosine":
        raise RuntimeError(f"Qdrant collection does not match bge-m3 profile: {vectors}")


def check_docs_imported() -> int:
    body = request_json(
        "POST",
        f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/count",
        {
            "filter": {
                "must": [
                    {"key": "document_type", "match": {"value": "project_documentation"}},
                    {"key": "tags", "match": {"value": DOCS_TAG}},
                ]
            },
            "exact": True,
        },
        headers=qdrant_headers(),
    )
    count = int(body.get("result", {}).get("count", 0))
    if count < 1:
        raise RuntimeError(f"docs/ are not imported into Qdrant: {body}")
    return count


def query_docs_rag() -> dict[str, Any]:
    answer = request_json(
        "POST",
        f"{RAG_URL}/api/v1/rag/query",
        {
            "subject_id": SUBJECT_ID,
            "query": DOCS_QUERY,
            "filters": {
                "document_types": ["project_documentation"],
                "only_valid": True,
                "classification_max": "internal",
                "tags": [DOCS_TAG],
            },
            "answer_mode": "normative_with_citations",
            "max_chunks": 6,
        },
    )
    if not answer.get("citations"):
        raise RuntimeError(f"RAG answer has no citations: {answer}")
    return answer


def check_web_health() -> None:
    body = request_json("GET", f"{WEB_URL}/api/health")
    if body.get("status") != "ok":
        raise RuntimeError(f"Web health failed: {body}")


def check_web_assistant_route() -> None:
    text = request_text("GET", f"{WEB_URL}/assistant")
    if "Znalostní asistent" not in text:
        raise RuntimeError("Employee assistant route did not render expected content")


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    expected_status: int = 200,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request_headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Request-ID": "phase03-local-production-smoke",
        "X-Correlation-ID": "phase03-local-production-smoke",
        "X-AKL-Subject": SUBJECT_ID,
        "X-AKL-Roles": ROLES,
    }
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read().decode("utf-8")
            body = json.loads(raw) if raw else {}
            status = response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {raw}") from exc
    if status != expected_status:
        raise RuntimeError(f"{method} {url} returned HTTP {status}, expected {expected_status}: {body}")
    return body


def request_text(method: str, url: str, *, expected_status: int = 200) -> str:
    request_headers = {
        "Accept": "text/html",
        "X-Request-ID": "phase03-local-production-smoke",
        "X-Correlation-ID": "phase03-local-production-smoke",
        "X-AKL-Subject": SUBJECT_ID,
        "X-AKL-Roles": ROLES,
    }
    request = urllib.request.Request(url, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read().decode("utf-8")
            status = response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {raw}") from exc
    if status != expected_status:
        raise RuntimeError(f"{method} {url} returned HTTP {status}, expected {expected_status}: {raw[:500]}")
    return raw


def qdrant_headers() -> dict[str, str]:
    api_key = os.getenv("AKL_QDRANT_API_KEY")
    return {"api-key": api_key} if api_key else {}


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
