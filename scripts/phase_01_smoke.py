#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.legacy_mutation_guard import retire_legacy_mutation  # noqa: E402


REGISTRY_URL = os.getenv("AKL_SMOKE_REGISTRY_URL", "http://localhost:8001").rstrip("/")
INGESTION_URL = os.getenv("AKL_SMOKE_INGESTION_URL", "http://localhost:8090").rstrip("/")
RAG_URL = os.getenv("AKL_SMOKE_RAG_URL", "http://localhost:8082").rstrip("/")
LLM_URL = os.getenv("AKL_SMOKE_LLM_URL", "http://localhost:8083").rstrip("/")
WEB_URL = os.getenv("AKL_SMOKE_WEB_URL", "http://localhost:3002").rstrip("/")
INGESTION_CONTAINER = os.getenv("AKL_SMOKE_INGESTION_CONTAINER", "akl-ingestion-service-1")
SOURCE_URI = os.getenv("AKL_SMOKE_SOURCE_URI", "s3://akl-documents/smoke/phase01.txt")

SMOKE_TEXT = """# Phase 01 Smoke Directive

Article 4 Exception approvals

Paragraph 2 The document owner approves an exception after justification is provided.

Another paragraph contains additional rules for a citable chunk.
"""


def main() -> int:
    retire_legacy_mutation("scripts/phase_01_smoke.py")
    print("Phase 01 smoke test")
    seed_ingestion_object()
    check_health()
    document = create_document()
    version = create_version(document["document_id"])
    ingestion = run_ingestion(document["document_id"], version["document_version_id"])
    retrieval = retrieve()
    llm = call_llm()
    answer = query_rag()
    audit = write_audit_event(document["document_id"])

    print("OK document_id=", document["document_id"])
    print("OK document_version_id=", version["document_version_id"])
    print("OK ingestion_job_id=", ingestion["job_id"])
    print("OK retrieved_chunk_id=", retrieval["chunks"][0]["chunk_id"])
    print("OK llm_provider=", llm["provider"])
    print("OK answer_confidence=", answer["confidence"])
    print("OK audit_event_id=", audit["audit_event_id"])
    return 0


def seed_ingestion_object() -> None:
    retire_legacy_mutation("scripts/phase_01_smoke.py seed_ingestion_object")
    if os.getenv("AKL_SMOKE_SKIP_DOCKER_SEED") == "1":
        print("SKIP object-storage seed")
        return

    command = [
        "docker",
        "exec",
        "-i",
        INGESTION_CONTAINER,
        "sh",
        "-lc",
        "mkdir -p /data/object-storage/akl-documents/smoke "
        "&& cat > /data/object-storage/akl-documents/smoke/phase01.txt",
    ]
    subprocess.run(command, input=SMOKE_TEXT, text=True, check=True)
    print("OK seeded ingestion object storage")


def check_health() -> None:
    endpoints = [
        f"{REGISTRY_URL}/health",
        f"{INGESTION_URL}/health",
        f"{RAG_URL}/health",
        f"{LLM_URL}/health",
        f"{WEB_URL}/health",
    ]
    for endpoint in endpoints:
        body = request_json("GET", endpoint)
        if body.get("status") != "ok":
            raise RuntimeError(f"Healthcheck failed for {endpoint}: {body}")
    print("OK healthchecks")


def create_document() -> dict[str, Any]:
    retire_legacy_mutation("scripts/phase_01_smoke.py create_document")
    return request_json(
        "POST",
        f"{REGISTRY_URL}/api/v1/documents",
        {
            "title": "Phase 01 Smoke Directive",
            "document_type": "directive",
            "owner_id": "user_dev",
            "classification": "internal",
            "tags": ["phase01-smoke"],
            "metadata": {"source": "phase_01_smoke"},
        },
        expected_status=201,
    )


def create_version(document_id: str) -> dict[str, Any]:
    retire_legacy_mutation("scripts/phase_01_smoke.py create_version")
    return request_json(
        "POST",
        f"{REGISTRY_URL}/api/v1/documents/{document_id}/versions",
        {
            "version_label": "1.0",
            "source_file_uri": SOURCE_URI,
            "change_summary": "Phase 01 smoke fixture.",
        },
        expected_status=201,
    )


def run_ingestion(document_id: str, document_version_id: str) -> dict[str, Any]:
    retire_legacy_mutation("scripts/phase_01_smoke.py run_ingestion")
    job = request_json(
        "POST",
        f"{INGESTION_URL}/api/v1/ingestion/jobs",
        {
            "document_id": document_id,
            "document_version_id": document_version_id,
            "source_file_uri": SOURCE_URI,
            "parser_profile": "controlled_document",
            "ocr_enabled": True,
            "chunking_strategy": "legal_structured",
            "embedding_profile": "default",
        },
        expected_status=201,
    )
    report = wait_for_report(job["job_id"])
    if report["status"] not in {"completed", "completed_with_warnings"}:
        raise RuntimeError(f"Ingestion failed: {report}")
    if report["chunks_created"] < 1:
        raise RuntimeError(f"Ingestion did not create a chunk: {report}")
    return job


def wait_for_report(job_id: str) -> dict[str, Any]:
    endpoint = f"{INGESTION_URL}/api/v1/ingestion/jobs/{job_id}/report"
    last_error: Exception | None = None
    for _ in range(20):
        try:
            return request_json("GET", endpoint)
        except Exception as exc:
            last_error = exc
            time.sleep(0.5)
    raise RuntimeError(f"Ingestion report was not ready: {last_error}")


def retrieve() -> dict[str, Any]:
    retire_legacy_mutation("scripts/phase_01_smoke.py retrieve")
    body = request_json(
        "POST",
        f"{RAG_URL}/api/v1/rag/retrieve",
        {
            "subject_id": "user_dev",
            "query": "Kdo schvaluje vyjimku?",
            "filters": {
                "document_types": ["directive"],
                "only_valid": True,
                "classification_max": "internal",
                "tags": [],
            },
            "max_chunks": 4,
        },
    )
    if not body.get("chunks"):
        raise RuntimeError(f"RAG retrieval returned no chunks: {body}")
    return body


def call_llm() -> dict[str, Any]:
    retire_legacy_mutation("scripts/phase_01_smoke.py call_llm")
    request_json("GET", f"{LLM_URL}/api/v1/models")
    return request_json(
        "POST",
        f"{LLM_URL}/api/v1/chat/completions",
        {
            "model": "mock-chat",
            "messages": [{"role": "user", "content": "Return a short smoke-test answer."}],
            "temperature": 0.0,
            "metadata": {"purpose": "phase_01_smoke"},
        },
    )


def query_rag() -> dict[str, Any]:
    retire_legacy_mutation("scripts/phase_01_smoke.py query_rag")
    body = request_json(
        "POST",
        f"{RAG_URL}/api/v1/rag/query",
        {
            "subject_id": "user_dev",
            "query": "Kdo schvaluje vyjimku?",
            "filters": {
                "document_types": ["directive", "methodology", "knowledge_base_article", "policy"],
                "only_valid": True,
                "classification_max": "internal",
                "tags": [],
            },
            "answer_mode": "normative_with_citations",
            "max_chunks": 4,
        },
    )
    if not body.get("citations"):
        raise RuntimeError(f"RAG answer returned no citations: {body}")
    return body


def write_audit_event(document_id: str) -> dict[str, Any]:
    retire_legacy_mutation("scripts/phase_01_smoke.py write_audit_event")
    return request_json(
        "POST",
        f"{REGISTRY_URL}/api/v1/audit/events",
        {
            "actor_id": "phase01-smoke",
            "event_type": "phase01.smoke.completed",
            "resource_type": "document",
            "resource_id": document_id,
            "severity": "info",
            "correlation_id": "phase01-smoke",
            "metadata": {"smoke_test": "phase_01"},
        },
        expected_status=201,
    )


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    expected_status: int = 200,
) -> dict[str, Any]:
    if method.upper() not in {"GET", "HEAD", "OPTIONS"}:
        retire_legacy_mutation("scripts/phase_01_smoke.py request_json mutation")
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Request-ID": "phase01-smoke",
            "X-Correlation-ID": "phase01-smoke",
            "X-AKL-Subject": "user_dev",
            "X-AKL-Roles": "admin,document_manager,reader",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            raw = response.read().decode("utf-8")
            body = json.loads(raw) if raw else {}
            status = response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {raw}") from exc

    if status != expected_status:
        raise RuntimeError(f"{method} {url} returned HTTP {status}, expected {expected_status}: {body}")
    return body


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
