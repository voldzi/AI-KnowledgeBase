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

from tools.import_docs_folder import ImportOptions, run_import, write_reports  # noqa: E402


REGISTRY_URL = os.getenv("AKL_SMOKE_REGISTRY_URL", "http://localhost:8001").rstrip("/")
INGESTION_URL = os.getenv("AKL_SMOKE_INGESTION_URL", "http://localhost:8090").rstrip("/")
RAG_URL = os.getenv("AKL_SMOKE_RAG_URL", "http://localhost:8082").rstrip("/")
LLM_URL = os.getenv("AKL_SMOKE_LLM_URL", "http://localhost:8083").rstrip("/")
QDRANT_URL = os.getenv("AKL_SMOKE_QDRANT_URL", "http://localhost:6333").rstrip("/")
QDRANT_COLLECTION = os.getenv("AKL_QDRANT_COLLECTION", "akl_document_chunks")
DOCS_TAG = os.getenv("AKL_PHASE_03_DOCS_TAG", "akb-docs")
DOCS_QUERY = os.getenv("AKL_PHASE_03_DOCS_QUERY", "Jak funguje RAG retrieval a citace?")
INGESTION_CONTAINER = os.getenv("AKL_SMOKE_INGESTION_CONTAINER", "akl-ingestion-service-1")
SUBJECT_ID = os.getenv("AKL_SMOKE_SUBJECT_ID", "user_dev")
ROLES = os.getenv("AKL_SMOKE_ROLES", "admin,document_manager,reader")
REPORT_PATH = Path(os.getenv("AKL_PHASE_03_VIEWER_IMPORT_REPORT", "/tmp/akl_phase3_document_viewer_import_report.json"))


def main() -> int:
    print("Phase 03 document viewer smoke test")
    check_health()
    report = import_docs_subset()
    verify_report(report)
    target_payload = first_imported_qdrant_payload(report)
    answer = query_rag(str(target_payload.get("text") or target_payload.get("normalized_text") or "")[:300])
    citation = answer["citations"][0]
    source_context = open_citation(citation["chunk_id"])
    qdrant_payload = qdrant_payload_for_chunk(citation["chunk_id"])
    verify_source_context(source_context, qdrant_payload)

    print("OK imported_documents=", report["totals"]["imported_documents"])
    print("OK chunks_created=", report["totals"]["chunks_created"])
    print("OK cited_chunk_id=", citation["chunk_id"])
    print("OK viewer_mode=", source_context["viewer_mode"])
    print("OK source_file_uri=", source_context["source_file_uri"])
    print("OK chunk_text_chars=", len(source_context["chunk_text"]))
    return 0


def check_health() -> None:
    for endpoint in (f"{REGISTRY_URL}/health", f"{INGESTION_URL}/health", f"{RAG_URL}/health", f"{LLM_URL}/health"):
        body = request_json("GET", endpoint)
        if body.get("status") != "ok":
            raise RuntimeError(f"Healthcheck failed for {endpoint}: {body}")
    print("OK healthchecks")


def import_docs_subset() -> dict[str, Any]:
    options = ImportOptions(
        source=ROOT / "docs",
        manifest_path=ROOT / "docs" / "import-manifest.yaml",
        mode=os.getenv("AKL_PHASE_03_VIEWER_IMPORT_MODE", "reindex"),
        limit=int(os.getenv("AKL_PHASE_03_VIEWER_IMPORT_LIMIT", "4")),
        dry_run=False,
        report_path=REPORT_PATH,
        registry_url=REGISTRY_URL,
        ingestion_url=INGESTION_URL,
        qdrant_url=QDRANT_URL,
        qdrant_collection=QDRANT_COLLECTION,
        ingestion_container=INGESTION_CONTAINER,
        subject_id=os.getenv("AKL_IMPORT_SUBJECT_ID", "docs-import"),
        roles=os.getenv("AKL_IMPORT_ROLES", ROLES),
        storage_bucket=os.getenv("AKL_IMPORT_STORAGE_BUCKET", "akl-documents"),
        storage_prefix=os.getenv("AKL_IMPORT_STORAGE_PREFIX", "docs-import"),
        timeout_seconds=int(os.getenv("AKL_IMPORT_TIMEOUT_SECONDS", "180")),
    )
    report = run_import(options)
    write_reports(report, REPORT_PATH)
    return report


def verify_report(report: dict[str, Any]) -> None:
    totals = report.get("totals") or {}
    if int(totals.get("imported_documents", 0)) < 1:
        raise RuntimeError(f"Viewer smoke import did not import any docs: {totals}")
    if int(totals.get("failed_documents", 0)) != 0:
        raise RuntimeError(f"Viewer smoke import failed: {report.get('errors')}")
    if int(totals.get("chunks_created", 0)) < 1:
        raise RuntimeError(f"Viewer smoke import created no chunks: {totals}")
    if int(totals.get("qdrant_points", 0)) < 1:
        raise RuntimeError(f"Viewer smoke import observed no Qdrant points: {totals}")


def first_imported_qdrant_payload(report: dict[str, Any]) -> dict[str, Any]:
    for document in report.get("documents", []):
        version_id = document.get("document_version_id")
        if not version_id:
            continue
        body = request_json(
            "POST",
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/scroll",
            {
                "filter": {"must": [{"key": "document_version_id", "match": {"value": version_id}}]},
                "limit": 1,
                "with_payload": True,
                "with_vector": False,
            },
            headers=qdrant_headers(),
        )
        points = body.get("result", {}).get("points", [])
        if points and isinstance(points[0].get("payload"), dict):
            return points[0]["payload"]
    raise RuntimeError("No Qdrant payload found for imported viewer smoke documents")


def query_rag(query: str) -> dict[str, Any]:
    if not query.strip():
        query = DOCS_QUERY
    answer = request_json(
        "POST",
        f"{RAG_URL}/api/v1/rag/query",
        {
            "subject_id": SUBJECT_ID,
            "query": query,
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
        raise RuntimeError(f"RAG returned no citations: {answer}")
    return answer


def open_citation(chunk_id: str) -> dict[str, Any]:
    return request_json(
        "GET",
        f"{RAG_URL}/api/v1/citations/{chunk_id}/open?subject_id={SUBJECT_ID}",
    )


def qdrant_payload_for_chunk(chunk_id: str) -> dict[str, Any]:
    body = request_json(
        "POST",
        f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/scroll",
        {
            "filter": {"must": [{"key": "chunk_id", "match": {"value": chunk_id}}]},
            "limit": 1,
            "with_payload": True,
            "with_vector": False,
        },
        headers=qdrant_headers(),
    )
    points = body.get("result", {}).get("points", [])
    if not points:
        raise RuntimeError(f"Qdrant has no point for cited chunk {chunk_id}: {body}")
    payload = points[0].get("payload", {})
    if not isinstance(payload, dict):
        raise RuntimeError(f"Qdrant point payload is invalid for {chunk_id}: {points[0]}")
    return payload


def verify_source_context(source_context: dict[str, Any], qdrant_payload: dict[str, Any]) -> None:
    if not source_context.get("source_file_uri"):
        raise RuntimeError(f"source-context does not include source_file_uri: {source_context}")
    if not source_context.get("chunk_text"):
        raise RuntimeError(f"source-context does not include chunk_text: {source_context}")
    if source_context.get("viewer_mode") != "markdown":
        raise RuntimeError(f"Expected markdown viewer for imported docs, got: {source_context.get('viewer_mode')}")

    expected_text = (qdrant_payload.get("text") or qdrant_payload.get("normalized_text") or "").strip()
    if source_context["chunk_text"].strip() != expected_text:
        raise RuntimeError("source-context chunk_text does not match Qdrant payload text")


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
        "X-Request-ID": "phase03-document-viewer-smoke",
        "X-Correlation-ID": "phase03-document-viewer-smoke",
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


def qdrant_headers() -> dict[str, str]:
    api_key = os.getenv("AKL_QDRANT_API_KEY")
    return {"api-key": api_key} if api_key else {}


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
