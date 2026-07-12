#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.import_docs_folder import (  # noqa: E402
    ImportOptions,
    bearer_subject_id,
    load_information_policy_file,
    opensearch_headers,
    parse_bool_env,
    run_import,
    write_reports,
)


REGISTRY_URL = os.getenv("AKL_SMOKE_REGISTRY_URL", "http://localhost:8001").rstrip("/")
INGESTION_URL = os.getenv("AKL_SMOKE_INGESTION_URL", "http://localhost:8090").rstrip("/")
RAG_URL = os.getenv("AKL_SMOKE_RAG_URL", "http://localhost:8082").rstrip("/")
LLM_URL = os.getenv("AKL_SMOKE_LLM_URL", "http://localhost:8083").rstrip("/")
QDRANT_URL = os.getenv("AKL_SMOKE_QDRANT_URL", "http://localhost:6333").rstrip("/")
QDRANT_COLLECTION = os.getenv("AKL_QDRANT_COLLECTION", "akl_document_chunks")
OPENSEARCH_URL = os.getenv("AKL_SMOKE_OPENSEARCH_URL", os.getenv("AKL_IMPORT_OPENSEARCH_URL", "http://localhost:9200")).rstrip("/")
OPENSEARCH_INDEX = os.getenv("AKL_IMPORT_OPENSEARCH_INDEX", os.getenv("AKL_OPENSEARCH_INDEX", "akl_document_chunks"))
REQUIRE_OPENSEARCH = parse_bool_env(os.getenv("AKL_PHASE_03_REQUIRE_OPENSEARCH", "true"))
DOCS_TAG = os.getenv("AKL_PHASE_03_DOCS_TAG", "akb-docs")
DOCS_QUERY = os.getenv("AKL_PHASE_03_DOCS_QUERY", "Jak funguje RAG retrieval a citace?")
INGESTION_CONTAINER = os.getenv("AKL_SMOKE_INGESTION_CONTAINER", "akl-ingestion-service-1")
BEARER_TOKEN = os.getenv("AKL_SMOKE_BEARER_TOKEN") or None
SUBJECT_ID = bearer_subject_id(BEARER_TOKEN) if BEARER_TOKEN else os.getenv("AKL_SMOKE_SUBJECT_ID", "user_dev")
ROLES = os.getenv("AKL_SMOKE_ROLES", "admin,document_manager,reader")
IMPORT_LIMIT = int(os.getenv("AKL_PHASE_03_DOCS_IMPORT_LIMIT", "8"))
REPORT_PATH = ROOT / os.getenv("AKL_PHASE_03_DOCS_IMPORT_REPORT", "reports/docs_import_report.json")
INFORMATION_POLICY_FILE = os.getenv("AKL_IMPORT_INFORMATION_POLICY_FILE")


def main() -> int:
    print("Phase 03 docs import smoke test")
    check_health()
    report = import_docs_subset()
    verify_report(report)
    qdrant_count = verify_docs_qdrant_points()
    opensearch_count = verify_docs_opensearch_documents()
    answer = query_rag_architecture()

    print("OK found_documents=", report["totals"]["found_documents"])
    print("OK imported_documents=", report["totals"]["imported_documents"])
    print("OK chunks_created=", report["totals"]["chunks_created"])
    print("OK qdrant_points=", report["totals"]["qdrant_points"])
    print("OK opensearch_documents=", report["totals"]["opensearch_documents"])
    print("OK docs_qdrant_count=", qdrant_count)
    print("OK docs_opensearch_count=", opensearch_count)
    print("OK cited_chunk_id=", answer["citations"][0]["chunk_id"])
    print("OK query_id=", answer["query_id"])
    print("OK report=", REPORT_PATH)
    return 0


def check_health() -> None:
    endpoints = [
        f"{REGISTRY_URL}/health",
        f"{INGESTION_URL}/health",
        f"{RAG_URL}/health",
        f"{LLM_URL}/health",
    ]
    for endpoint in endpoints:
        body = request_json("GET", endpoint)
        if body.get("status") != "ok":
            raise RuntimeError(f"Healthcheck failed for {endpoint}: {body}")
    print("OK healthchecks")


def import_docs_subset() -> dict[str, Any]:
    options = ImportOptions(
        source=ROOT / "docs",
        manifest_path=ROOT / "docs" / "import-manifest.yaml",
        mode=os.getenv("AKL_PHASE_03_DOCS_IMPORT_MODE", "reindex"),
        limit=IMPORT_LIMIT,
        dry_run=False,
        report_path=REPORT_PATH,
        registry_url=REGISTRY_URL,
        ingestion_url=INGESTION_URL,
        qdrant_url=QDRANT_URL,
        qdrant_collection=QDRANT_COLLECTION,
        opensearch_url=OPENSEARCH_URL,
        opensearch_index=OPENSEARCH_INDEX,
        require_opensearch=REQUIRE_OPENSEARCH,
        ingestion_container=INGESTION_CONTAINER,
        subject_id=os.getenv("AKL_IMPORT_SUBJECT_ID", "docs-import"),
        roles=os.getenv("AKL_IMPORT_ROLES", ROLES),
        storage_bucket=os.getenv("AKL_IMPORT_STORAGE_BUCKET", "akl-documents"),
        storage_prefix=os.getenv("AKL_IMPORT_STORAGE_PREFIX", "docs-import"),
        timeout_seconds=int(os.getenv("AKL_IMPORT_TIMEOUT_SECONDS", "180")),
        okf_profile=False,
        bearer_token=os.getenv("AKL_IMPORT_BEARER_TOKEN") or BEARER_TOKEN,
        information_policy=load_information_policy_file(INFORMATION_POLICY_FILE),
        approve_for_publish=True,
    )
    report = run_import(options)
    write_reports(report, REPORT_PATH)
    return report


def verify_report(report: dict[str, Any]) -> None:
    totals = report.get("totals") or {}
    if int(totals.get("found_documents", 0)) < 1:
        raise RuntimeError(f"Docs import found no Markdown documents: {report}")
    if int(totals.get("failed_documents", 0)) != 0:
        raise RuntimeError(f"Docs import failed for at least one document: {report.get('errors')}")
    if int(totals.get("imported_documents", 0)) < 1:
        raise RuntimeError(f"Docs import did not import or reindex any document: {totals}")
    if int(totals.get("chunks_created", 0)) < 1:
        raise RuntimeError(f"Docs import created no chunks: {totals}")
    if int(totals.get("qdrant_points", 0)) < 1:
        raise RuntimeError(f"Docs import observed no Qdrant points: {totals}")
    if REQUIRE_OPENSEARCH and int(totals.get("opensearch_documents", 0)) < 1:
        raise RuntimeError(f"Docs import observed no OpenSearch documents: {totals}")


def verify_docs_qdrant_points() -> int:
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
        raise RuntimeError(f"Qdrant contains no project documentation points: {body}")
    return count


def verify_docs_opensearch_documents() -> int:
    if not REQUIRE_OPENSEARCH:
        return 0
    body = request_json(
        "POST",
        f"{OPENSEARCH_URL}/{OPENSEARCH_INDEX}/_count",
        {
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"document_type": "project_documentation"}},
                        {"term": {"tags": DOCS_TAG}},
                    ]
                }
            }
        },
        headers=opensearch_headers(),
    )
    count = int(body.get("count", 0))
    if count < 1:
        raise RuntimeError(f"OpenSearch contains no project documentation chunks: {body}")
    return count


def query_rag_architecture() -> dict[str, Any]:
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
    citations = answer.get("citations") or []
    if not citations:
        raise RuntimeError(f"RAG architecture answer returned no citations: {answer}")
    if not answer.get("used_chunks"):
        raise RuntimeError(f"RAG architecture answer returned no used chunks: {answer}")
    return answer


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
        "X-Request-ID": "phase03-docs-import-smoke",
        "X-Correlation-ID": "phase03-docs-import-smoke",
    }
    if BEARER_TOKEN:
        request_headers["Authorization"] = f"Bearer {BEARER_TOKEN}"
    else:
        request_headers["X-AKL-Subject"] = SUBJECT_ID
        request_headers["X-AKL-Roles"] = ROLES
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
            body = json.loads(raw) if raw else {}
            status = response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {raw}") from exc

    if status != expected_status:
        raise RuntimeError(f"{method} {url} returned HTTP {status}, expected {expected_status}: {body}")
    return body


def qdrant_headers() -> dict[str, str]:
    api_key = os.getenv("AKL_QDRANT_API_KEY")
    return {"api-key": api_key} if api_key else {}


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
