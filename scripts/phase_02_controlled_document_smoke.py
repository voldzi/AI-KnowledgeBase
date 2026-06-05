#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "documents" / "controlled-document-sample.md"

REGISTRY_URL = os.getenv("AKL_SMOKE_REGISTRY_URL", "http://localhost:8001").rstrip("/")
INGESTION_URL = os.getenv("AKL_SMOKE_INGESTION_URL", "http://localhost:8090").rstrip("/")
RAG_URL = os.getenv("AKL_SMOKE_RAG_URL", "http://localhost:8082").rstrip("/")
LLM_URL = os.getenv("AKL_SMOKE_LLM_URL", "http://localhost:8083").rstrip("/")
QDRANT_URL = os.getenv("AKL_SMOKE_QDRANT_URL", "http://localhost:6333").rstrip("/")
QDRANT_COLLECTION = os.getenv("AKL_QDRANT_COLLECTION", "akl_document_chunks")
INGESTION_CONTAINER = os.getenv("AKL_SMOKE_INGESTION_CONTAINER", "akl-ingestion-service-1")
SOURCE_URI = os.getenv(
    "AKL_SMOKE_SOURCE_URI",
    "s3://akl-documents/smoke/phase02-controlled-document.md",
)
SUBJECT_ID = os.getenv("AKL_SMOKE_SUBJECT_ID", "user_dev")
TODAY = dt.date.today().isoformat()
RUN_TAG = os.getenv("AKL_SMOKE_RUN_TAG", f"phase02-smoke-{uuid.uuid4().hex[:8]}")


def main() -> int:
    print("Phase 02 controlled document smoke test")
    fixture_text = FIXTURE_PATH.read_text(encoding="utf-8")
    seed_ingestion_object(fixture_text)
    check_health()
    document = create_document()
    version = create_version(document["document_id"], fixture_text)
    published = publish_version(document["document_id"], version["document_version_id"])
    ingestion = run_ingestion(document["document_id"], published["document_version_id"])
    report = wait_for_report(ingestion["job_id"])
    points = verify_qdrant_index(document, published, report)
    answer = query_rag(document["document_id"])
    rag_audit = find_audit_event("rag.query.executed", answer["query_id"])
    smoke_audit = write_smoke_audit(document["document_id"], ingestion["job_id"], answer["query_id"])

    print("OK document_id=", document["document_id"])
    print("OK document_version_id=", published["document_version_id"])
    print("OK ingestion_job_id=", ingestion["job_id"])
    print("OK chunks_created=", report["chunks_created"])
    print("OK qdrant_points=", len(points))
    print("OK cited_chunk_id=", answer["citations"][0]["chunk_id"])
    print("OK answer_confidence=", answer["confidence"])
    print("OK rag_audit_event_id=", rag_audit["audit_event_id"])
    print("OK smoke_audit_event_id=", smoke_audit["audit_event_id"])
    return 0


def seed_ingestion_object(content: str) -> None:
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
        "&& cat > /data/object-storage/akl-documents/smoke/phase02-controlled-document.md",
    ]
    subprocess.run(command, input=content, text=True, check=True)
    print("OK seeded controlled document fixture")


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

    models = request_json("GET", f"{LLM_URL}/api/v1/models")
    if "models" not in models:
        raise RuntimeError(f"LLM Gateway model list is invalid: {models}")
    print("OK healthchecks")


def create_document() -> dict[str, Any]:
    return request_json(
        "POST",
        f"{REGISTRY_URL}/api/v1/documents",
        {
            "title": "Směrnice pro správu testovací dokumentace",
            "document_type": "directive",
            "owner_id": SUBJECT_ID,
            "gestor_unit": "Odbor řízení dokumentace",
            "classification": "internal",
            "tags": [RUN_TAG, "controlled-document"],
            "metadata": {"source": "phase_02_controlled_document_smoke", "run_tag": RUN_TAG},
            "access_policies": [
                {
                    "subjects": [f"user:{SUBJECT_ID}", "role:reader"],
                    "actions": ["document.read", "rag.query"],
                    "constraints": {"classification_max": "internal"},
                },
                {
                    "subjects": ["role:service_ingestion", "role:document_manager", "role:admin"],
                    "actions": [
                        "document.read",
                        "document.ingest",
                        "document.reindex",
                        "document.version.create",
                        "document.version.publish",
                        "document.version.archive",
                    ],
                    "constraints": {"classification_max": "internal"},
                },
            ],
        },
        expected_status=201,
    )


def create_version(document_id: str, fixture_text: str) -> dict[str, Any]:
    sha256 = "sha256:" + hashlib.sha256(fixture_text.encode("utf-8")).hexdigest()
    return request_json(
        "POST",
        f"{REGISTRY_URL}/api/v1/documents/{document_id}/versions",
        {
            "version_label": "1.0-phase02",
            "valid_from": TODAY,
            "valid_to": None,
            "source_file_uri": SOURCE_URI,
            "file_hash": sha256,
            "change_summary": "Phase 02 controlled-document smoke fixture.",
            "file": {
                "filename": "controlled-document-sample.md",
                "mime_type": "text/markdown",
                "size_bytes": len(fixture_text.encode("utf-8")),
                "sha256": sha256,
                "uploaded_by": "phase02-smoke",
            },
        },
        expected_status=201,
    )


def publish_version(document_id: str, version_id: str) -> dict[str, Any]:
    version = request_json(
        "POST",
        f"{REGISTRY_URL}/api/v1/documents/{document_id}/versions/{version_id}/publish",
    )
    if version.get("status") != "valid":
        raise RuntimeError(f"Published version is not valid: {version}")
    return version


def run_ingestion(document_id: str, document_version_id: str) -> dict[str, Any]:
    return request_json(
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


def wait_for_report(job_id: str) -> dict[str, Any]:
    endpoint = f"{INGESTION_URL}/api/v1/ingestion/jobs/{job_id}/report"
    last_error: Exception | None = None
    for _ in range(30):
        try:
            report = request_json("GET", endpoint)
            if report["status"] in {"completed", "completed_with_warnings", "failed"}:
                if report["status"] == "failed":
                    raise RuntimeError(f"Ingestion failed: {report}")
                if report["chunks_created"] < 1:
                    raise RuntimeError(f"Ingestion did not create chunks: {report}")
                return report
        except Exception as exc:
            last_error = exc
        time.sleep(1)
    raise RuntimeError(f"Ingestion report was not ready: {last_error}")


def verify_qdrant_index(
    document: dict[str, Any],
    version: dict[str, Any],
    report: dict[str, Any],
) -> list[dict[str, Any]]:
    filter_body = {
        "must": [
            {"key": "document_version_id", "match": {"value": version["document_version_id"]}},
        ]
    }
    count_body = request_json(
        "POST",
        f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/count",
        {"filter": filter_body, "exact": True},
        headers=qdrant_headers(),
    )
    count = int(count_body.get("result", {}).get("count", 0))
    if count < report["chunks_created"]:
        raise RuntimeError(f"Qdrant count {count} is lower than chunks_created {report['chunks_created']}")

    scroll_body = request_json(
        "POST",
        f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/scroll",
        {"filter": filter_body, "limit": max(10, report["chunks_created"]), "with_payload": True, "with_vector": False},
        headers=qdrant_headers(),
    )
    points = scroll_body.get("result", {}).get("points", [])
    if not isinstance(points, list) or not points:
        raise RuntimeError(f"Qdrant scroll returned no points: {scroll_body}")

    payloads = [point.get("payload", {}) for point in points if isinstance(point.get("payload"), dict)]
    article_two = [payload for payload in payloads if payload.get("article_number") == "2"]
    if not article_two:
        raise RuntimeError(f"Article 2 chunk was not indexed: {payloads}")

    payload = article_two[0]
    expected = {
        "document_id": document["document_id"],
        "document_version_id": version["document_version_id"],
        "document_title": document["title"],
        "version_label": version["version_label"],
        "classification": "internal",
        "status": "valid",
        "valid_from": TODAY,
    }
    for key, value in expected.items():
        if payload.get(key) != value:
            raise RuntimeError(f"Qdrant payload mismatch for {key}: expected {value!r}, got {payload.get(key)!r}")
    if "ředitel odboru" not in payload.get("text", ""):
        raise RuntimeError(f"Indexed Article 2 payload does not contain expected text: {payload}")
    return points


def query_rag(document_id: str) -> dict[str, Any]:
    answer = request_json(
        "POST",
        f"{RAG_URL}/api/v1/rag/query",
        {
            "subject_id": SUBJECT_ID,
            "query": "Kdo schvaluje výjimku ze směrnice?",
            "filters": {
                "document_types": ["directive"],
                "only_valid": True,
                "classification_max": "internal",
                "tags": [RUN_TAG],
            },
            "answer_mode": "normative_with_citations",
            "max_chunks": 4,
        },
    )
    citations = answer.get("citations") or []
    if not citations:
        raise RuntimeError(f"RAG answer returned no citations: {answer}")
    if not any(citation.get("document_id") == document_id for citation in citations):
        raise RuntimeError(f"RAG did not cite the created document. Answer: {answer}")
    if not answer.get("used_chunks"):
        raise RuntimeError(f"RAG answer returned no used_chunks: {answer}")
    return answer


def find_audit_event(event_type: str, resource_id: str) -> dict[str, Any]:
    query = urllib.parse.urlencode({"event_type": event_type, "resource_id": resource_id})
    body = request_json("GET", f"{REGISTRY_URL}/api/v1/audit/events?{query}")
    items = body.get("items", [])
    if not items:
        raise RuntimeError(f"Audit event {event_type}/{resource_id} was not found: {body}")
    return items[0]


def write_smoke_audit(document_id: str, job_id: str, query_id: str) -> dict[str, Any]:
    return request_json(
        "POST",
        f"{REGISTRY_URL}/api/v1/audit/events",
        {
            "actor_id": "phase02-smoke",
            "event_type": "phase02.controlled_document_smoke.completed",
            "resource_type": "document",
            "resource_id": document_id,
            "severity": "info",
            "correlation_id": "phase02-controlled-document-smoke",
            "metadata": {
                "job_id": job_id,
                "query_id": query_id,
                "qdrant_collection": QDRANT_COLLECTION,
            },
        },
        expected_status=201,
    )


def qdrant_headers() -> dict[str, str]:
    api_key = os.getenv("AKL_QDRANT_API_KEY")
    return {"api-key": api_key} if api_key else {}


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
        "X-Request-ID": "phase02-controlled-document-smoke",
        "X-Correlation-ID": "phase02-controlled-document-smoke",
        "X-AKL-Subject": SUBJECT_ID,
        "X-AKL-Roles": "admin,document_manager,reader",
    }
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
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
