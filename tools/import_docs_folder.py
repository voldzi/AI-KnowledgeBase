#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.okf_profile import akb_metadata_from_okf, parse_markdown_frontmatter  # noqa: E402

DEFAULT_REGISTRY_URL = "http://localhost:8001"
DEFAULT_INGESTION_URL = "http://localhost:8090"
DEFAULT_QDRANT_URL = "http://localhost:6333"
DEFAULT_QDRANT_COLLECTION = "akl_document_chunks"
DEFAULT_INGESTION_CONTAINER = "akl-ingestion-service-1"
DEFAULT_SUBJECT_ID = "docs-import"
DEFAULT_ROLES = "admin,document_manager,reader"
DEFAULT_BUCKET = "akl-documents"
DEFAULT_STORAGE_PREFIX = "docs-import"

VALID_MODES = {"skip-existing", "new-version", "reindex"}
TERMINAL_INGESTION_STATUSES = {"completed", "completed_with_warnings", "failed", "cancelled"}
VALID_DOCUMENT_STATUSES = {"draft", "review", "valid", "superseded", "archived", "cancelled"}


@dataclass(frozen=True)
class ImportOptions:
    source: Path
    manifest_path: Path
    mode: str
    limit: int | None
    dry_run: bool
    report_path: Path
    registry_url: str
    ingestion_url: str
    qdrant_url: str
    qdrant_collection: str
    ingestion_container: str
    subject_id: str
    roles: str
    storage_bucket: str
    storage_prefix: str
    timeout_seconds: int
    okf_profile: bool


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)
    report = run_import(options)
    write_reports(report, options.report_path)
    print_summary(report, options.report_path)
    return 1 if report["totals"]["failed_documents"] else 0


def parse_args(argv: list[str] | None = None) -> ImportOptions:
    parser = argparse.ArgumentParser(description="Import local Markdown documentation into AKL Registry/Ingestion/Qdrant.")
    parser.add_argument("--source", default="./docs", help="Source documentation folder.")
    parser.add_argument("--manifest", default="docs/import-manifest.yaml", help="Import manifest YAML path.")
    parser.add_argument("--mode", choices=sorted(VALID_MODES), default="skip-existing")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of Markdown files to process.")
    parser.add_argument("--dry-run", action="store_true", help="Plan the import without writing Registry/Ingestion/Qdrant.")
    parser.add_argument("--report", default="reports/docs_import_report.json", help="JSON import report path.")
    parser.add_argument("--registry-url", default=os.getenv("AKL_IMPORT_REGISTRY_URL", DEFAULT_REGISTRY_URL))
    parser.add_argument("--ingestion-url", default=os.getenv("AKL_IMPORT_INGESTION_URL", DEFAULT_INGESTION_URL))
    parser.add_argument("--qdrant-url", default=os.getenv("AKL_IMPORT_QDRANT_URL", DEFAULT_QDRANT_URL))
    parser.add_argument(
        "--qdrant-collection",
        default=os.getenv("AKL_QDRANT_COLLECTION", DEFAULT_QDRANT_COLLECTION),
    )
    parser.add_argument(
        "--ingestion-container",
        default=os.getenv("AKL_IMPORT_INGESTION_CONTAINER", os.getenv("AKL_SMOKE_INGESTION_CONTAINER", DEFAULT_INGESTION_CONTAINER)),
    )
    parser.add_argument("--subject-id", default=os.getenv("AKL_IMPORT_SUBJECT_ID", DEFAULT_SUBJECT_ID))
    parser.add_argument("--roles", default=os.getenv("AKL_IMPORT_ROLES", DEFAULT_ROLES))
    parser.add_argument("--storage-bucket", default=os.getenv("AKL_IMPORT_STORAGE_BUCKET", DEFAULT_BUCKET))
    parser.add_argument("--storage-prefix", default=os.getenv("AKL_IMPORT_STORAGE_PREFIX", DEFAULT_STORAGE_PREFIX))
    parser.add_argument("--timeout-seconds", type=int, default=int(os.getenv("AKL_IMPORT_TIMEOUT_SECONDS", "120")))
    parser.add_argument(
        "--okf-profile",
        action="store_true",
        help="Treat Markdown sources as STRATOS OKF concepts and merge YAML frontmatter into AKB metadata.",
    )
    args = parser.parse_args(argv)

    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be greater than zero")

    return ImportOptions(
        source=(ROOT / args.source).resolve() if not Path(args.source).is_absolute() else Path(args.source).resolve(),
        manifest_path=(ROOT / args.manifest).resolve() if not Path(args.manifest).is_absolute() else Path(args.manifest).resolve(),
        mode=args.mode,
        limit=args.limit,
        dry_run=args.dry_run,
        report_path=(ROOT / args.report).resolve() if not Path(args.report).is_absolute() else Path(args.report).resolve(),
        registry_url=args.registry_url.rstrip("/"),
        ingestion_url=args.ingestion_url.rstrip("/"),
        qdrant_url=args.qdrant_url.rstrip("/"),
        qdrant_collection=args.qdrant_collection,
        ingestion_container=args.ingestion_container,
        subject_id=args.subject_id,
        roles=args.roles,
        storage_bucket=args.storage_bucket,
        storage_prefix=args.storage_prefix.strip("/"),
        timeout_seconds=args.timeout_seconds,
        okf_profile=args.okf_profile,
    )


def run_import(options: ImportOptions) -> dict[str, Any]:
    started = dt.datetime.now(dt.UTC)
    manifest = load_manifest(options.manifest_path)
    files = discover_markdown_files(options.source, manifest, options.limit)
    existing_documents = {} if options.dry_run else documents_by_source_path(options)

    report_items: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for index, path in enumerate(files, start=1):
        rel_path = path.relative_to(options.source).as_posix()
        item = base_report_item(path, rel_path, index, manifest, options)
        try:
            if options.dry_run:
                item["action"] = "would_import"
                item["status"] = "planned"
                report_items.append(item)
                continue

            existing = existing_documents.get(rel_path)
            if existing and options.mode == "skip-existing":
                item.update(handle_skip_existing(existing, options))
                report_items.append(item)
                continue

            if existing and options.mode == "reindex":
                item.update(import_existing_version(path, rel_path, existing, options))
                report_items.append(item)
                continue

            if existing:
                item.update(import_new_version(path, rel_path, existing, options, item["metadata"]))
                report_items.append(item)
                continue

            item.update(import_new_document(path, rel_path, options, item["metadata"]))
            report_items.append(item)
        except Exception as exc:
            error = {
                "source_path": rel_path,
                "code": exc.__class__.__name__,
                "message": str(exc),
            }
            item.update({"action": "failed", "status": "failed", "error": error})
            report_items.append(item)
            errors.append(error)

    finished = dt.datetime.now(dt.UTC)
    report = {
        "generated_at": finished.isoformat().replace("+00:00", "Z"),
        "started_at": started.isoformat().replace("+00:00", "Z"),
        "finished_at": finished.isoformat().replace("+00:00", "Z"),
        "duration_seconds": round((finished - started).total_seconds(), 3),
        "source": display_path(options.source),
        "manifest": display_path(options.manifest_path),
        "mode": options.mode,
        "dry_run": options.dry_run,
        "registry_url": options.registry_url,
        "ingestion_url": options.ingestion_url,
        "qdrant_url": options.qdrant_url,
        "qdrant_collection": options.qdrant_collection,
        "totals": report_totals(files, report_items, errors),
        "documents": report_items,
        "errors": errors,
    }
    return report


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Manifest not found: {path}")
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return parse_simple_yaml(text)


def parse_simple_yaml(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    current_key: str | None = None
    current_list_item: dict[str, Any] | None = None

    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        stripped = line.strip()

        if indent == 0:
            if stripped.endswith(":"):
                current_key = stripped[:-1]
                result[current_key] = []
                current_list_item = None
                continue
            key, value = split_yaml_pair(stripped)
            result[key] = parse_scalar(value)
            current_key = None
            current_list_item = None
            continue

        if current_key is None:
            raise ValueError(f"Unsupported manifest line: {raw_line}")

        if stripped.startswith("- "):
            value = stripped[2:].strip()
            if not isinstance(result[current_key], list):
                result[current_key] = []
            if ":" in value:
                key, item_value = split_yaml_pair(value)
                current_list_item = {key: parse_scalar(item_value)}
                result[current_key].append(current_list_item)
            else:
                current_list_item = None
                result[current_key].append(parse_scalar(value))
            continue

        if isinstance(result[current_key], list) and current_list_item is not None:
            key, value = split_yaml_pair(stripped)
            current_list_item[key] = parse_scalar(value)
            continue

        if isinstance(result[current_key], list) and not result[current_key]:
            result[current_key] = {}
        if not isinstance(result[current_key], dict):
            raise ValueError(f"Unsupported manifest line: {raw_line}")
        key, value = split_yaml_pair(stripped)
        result[current_key][key] = parse_scalar(value)

    return result


def split_yaml_pair(value: str) -> tuple[str, str]:
    if ":" not in value:
        raise ValueError(f"Expected key: value pair in manifest line: {value}")
    key, raw = value.split(":", 1)
    return key.strip(), raw.strip()


def parse_scalar(value: str) -> Any:
    if value in {"", "null", "Null", "~"}:
        return None
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [strip_quotes(item.strip()) for item in inner.split(",")]
    return strip_quotes(value)


def strip_quotes(value: str) -> str:
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value


def discover_markdown_files(source: Path, manifest: dict[str, Any], limit: int | None) -> list[Path]:
    if not source.exists() or not source.is_dir():
        raise FileNotFoundError(f"Source folder not found: {source}")
    excludes = [str(pattern) for pattern in manifest.get("exclude", [])]
    files = []
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.suffix.lower() != ".md":
            continue
        rel_path = path.relative_to(source).as_posix()
        if any(matches_path(rel_path, pattern) for pattern in excludes):
            continue
        files.append(path)
        if limit is not None and len(files) >= limit:
            break
    return files


def base_report_item(
    path: Path,
    rel_path: str,
    index: int,
    manifest: dict[str, Any],
    options: ImportOptions,
) -> dict[str, Any]:
    content = path.read_bytes()
    metadata = metadata_for_path(rel_path, manifest, path if options.okf_profile else None)
    return {
        "index": index,
        "source_path": rel_path,
        "title": title_for_markdown(path),
        "sha256": f"sha256:{hashlib.sha256(content).hexdigest()}",
        "size_bytes": len(content),
        "metadata": metadata,
        "source_file_uri": source_uri_for(rel_path, options),
        "action": None,
        "status": "pending",
        "document_id": None,
        "document_version_id": None,
        "version_label": None,
        "ingestion_job_id": None,
        "chunks_created": 0,
        "qdrant_points": 0,
        "error": None,
    }


def metadata_for_path(rel_path: str, manifest: dict[str, Any], source_path: Path | None = None) -> dict[str, Any]:
    defaults = dict(manifest.get("defaults") or {})
    metadata = {
        "document_type": defaults.get("document_type", "project_documentation"),
        "classification": defaults.get("classification", "internal"),
        "status": defaults.get("status", "valid"),
        "owner": defaults.get("owner", "akl-team"),
        "area": defaults.get("area", "project"),
        "language": defaults.get("language", "cs"),
        "source_system": defaults.get("source_system", "git"),
        "tags": list(defaults.get("tags") or ["akl-docs", "project-documentation"]),
    }
    for key, value in defaults.items():
        metadata.setdefault(key, value)

    for rule in manifest.get("path_rules") or []:
        if not isinstance(rule, dict):
            continue
        pattern = str(rule.get("pattern", ""))
        if not pattern or not matches_path(rel_path, pattern):
            continue
        for key, value in rule.items():
            if key == "pattern":
                continue
            if key == "tags":
                metadata.setdefault("tags", [])
                metadata["tags"].extend(str(tag) for tag in value or [])
            else:
                metadata[key] = value

    area = str(metadata.get("area") or "project")
    domain = str(metadata.get("domain") or area).strip()
    audience = metadata.get("audience") or []
    if isinstance(audience, str):
        audience = [audience]
    derived_tags = {
        "akl-docs",
        "project-documentation",
        f"area:{area}",
        *(str(tag) for tag in metadata.get("tags") or []),
    }
    if domain:
        derived_tags.add(f"domain:{slugify(domain)}")
    derived_tags.update(f"audience:{slugify(str(item))}" for item in audience if str(item).strip())
    metadata["tags"] = sorted(
        derived_tags
    )
    if metadata["status"] not in VALID_DOCUMENT_STATUSES:
        raise ValueError(f"Unsupported document status {metadata['status']!r} for {rel_path}")
    if source_path is not None:
        frontmatter, _body = parse_markdown_frontmatter(source_path.read_text(encoding="utf-8", errors="replace"))
        metadata = akb_metadata_from_okf(frontmatter, rel_path, metadata)
        if metadata["status"] not in VALID_DOCUMENT_STATUSES:
            raise ValueError(f"Unsupported document status {metadata['status']!r} for {rel_path}")
    return metadata


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def matches_path(rel_path: str, pattern: str) -> bool:
    normalized = rel_path.replace("\\", "/")
    pattern = pattern.replace("\\", "/")
    return (
        fnmatch.fnmatch(normalized, pattern)
        or fnmatch.fnmatch(f"/{normalized}", pattern)
        or (pattern.startswith("**/") and fnmatch.fnmatch(normalized, pattern[3:]))
    )


def documents_by_source_path(options: ImportOptions) -> dict[str, dict[str, Any]]:
    documents: dict[str, dict[str, Any]] = {}
    offset = 0
    limit = 100
    while True:
        query = urllib.parse.urlencode({"limit": limit, "offset": offset})
        body = request_json("GET", f"{options.registry_url}/api/v1/documents?{query}", options=options)
        items = body.get("items") or []
        if not isinstance(items, list):
            raise RuntimeError(f"Invalid Registry document list response: {body}")
        for document in items:
            if not isinstance(document, dict):
                continue
            metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
            source_path = metadata.get("source_path")
            if isinstance(source_path, str) and document.get("status") != "cancelled":
                documents.setdefault(source_path, document)
        if len(items) < limit:
            break
        offset += limit
    return documents


def handle_skip_existing(existing: dict[str, Any], options: ImportOptions) -> dict[str, Any]:
    latest_version = latest_document_version(existing["document_id"], options)
    qdrant_points = 0
    if latest_version:
        qdrant_points = qdrant_count(latest_version["document_version_id"], options)
    return {
        "action": "skipped_existing",
        "status": "skipped",
        "document_id": existing["document_id"],
        "document_version_id": latest_version.get("document_version_id") if latest_version else None,
        "version_label": latest_version.get("version_label") if latest_version else None,
        "qdrant_points": qdrant_points,
    }


def import_existing_version(path: Path, rel_path: str, existing: dict[str, Any], options: ImportOptions) -> dict[str, Any]:
    latest_version = latest_document_version(existing["document_id"], options)
    if not latest_version:
        metadata = {
            **(existing.get("metadata") if isinstance(existing.get("metadata"), dict) else {}),
            "document_type": existing.get("document_type", "project_documentation"),
            "classification": existing.get("classification", "internal"),
            "status": existing.get("status", "valid"),
            "owner": existing.get("owner_id", "akl-team"),
            "area": existing.get("gestor_unit") or "project",
            "language": "cs",
            "source_system": "git",
            "tags": existing.get("tags", []),
        }
        return import_new_version(path, rel_path, existing, options, metadata)

    seed_ingestion_object(path, latest_version["source_file_uri"], options)
    ingestion = run_ingestion(existing["document_id"], latest_version["document_version_id"], latest_version["source_file_uri"], options)
    report = wait_for_ingestion_report(ingestion["job_id"], options)
    qdrant_points = qdrant_count(latest_version["document_version_id"], options)
    require_qdrant_points(latest_version["document_version_id"], report["chunks_created"], qdrant_points)
    return {
        "action": "reindexed_existing_version",
        "status": "imported",
        "document_id": existing["document_id"],
        "document_version_id": latest_version["document_version_id"],
        "version_label": latest_version.get("version_label"),
        "ingestion_job_id": ingestion["job_id"],
        "chunks_created": report["chunks_created"],
        "qdrant_points": qdrant_points,
    }


def import_new_version(
    path: Path,
    rel_path: str,
    existing: dict[str, Any],
    options: ImportOptions,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    patch_existing_document(existing["document_id"], path, rel_path, metadata, options)
    source_uri = source_uri_for(rel_path, options)
    seed_ingestion_object(path, source_uri, options)
    version = create_version(existing["document_id"], path, rel_path, source_uri, options)
    published = publish_if_valid(existing["document_id"], version, metadata, options)
    ingestion = run_ingestion(existing["document_id"], published["document_version_id"], source_uri, options)
    report = wait_for_ingestion_report(ingestion["job_id"], options)
    qdrant_points = qdrant_count(published["document_version_id"], options)
    require_qdrant_points(published["document_version_id"], report["chunks_created"], qdrant_points)
    return {
        "action": "created_new_version",
        "status": "imported",
        "document_id": existing["document_id"],
        "document_version_id": published["document_version_id"],
        "version_label": published.get("version_label"),
        "ingestion_job_id": ingestion["job_id"],
        "chunks_created": report["chunks_created"],
        "qdrant_points": qdrant_points,
    }


def import_new_document(path: Path, rel_path: str, options: ImportOptions, metadata: dict[str, Any]) -> dict[str, Any]:
    source_uri = source_uri_for(rel_path, options)
    seed_ingestion_object(path, source_uri, options)
    document = create_document(path, rel_path, metadata, options)
    version = create_version(document["document_id"], path, rel_path, source_uri, options)
    published = publish_if_valid(document["document_id"], version, metadata, options)
    ingestion = run_ingestion(document["document_id"], published["document_version_id"], source_uri, options)
    report = wait_for_ingestion_report(ingestion["job_id"], options)
    qdrant_points = qdrant_count(published["document_version_id"], options)
    require_qdrant_points(published["document_version_id"], report["chunks_created"], qdrant_points)
    return {
        "action": "created_document",
        "status": "imported",
        "document_id": document["document_id"],
        "document_version_id": published["document_version_id"],
        "version_label": published.get("version_label"),
        "ingestion_job_id": ingestion["job_id"],
        "chunks_created": report["chunks_created"],
        "qdrant_points": qdrant_points,
    }


def create_document(path: Path, rel_path: str, metadata: dict[str, Any], options: ImportOptions) -> dict[str, Any]:
    title = title_for_markdown(path)
    payload = {
        "title": title,
        "document_type": metadata["document_type"],
        "owner_id": metadata["owner"],
        "gestor_unit": metadata["area"],
        "classification": metadata["classification"],
        "tags": metadata["tags"],
        "metadata": document_metadata(path, rel_path, metadata),
        "access_policies": access_policies(options.subject_id, metadata["classification"]),
    }
    document = request_json(
        "POST",
        f"{options.registry_url}/api/v1/documents",
        payload,
        options=options,
        expected_status=201,
    )
    if metadata["status"] not in {"draft", "valid"}:
        document = patch_document(document["document_id"], {"status": metadata["status"]}, options)
    return document


def patch_existing_document(
    document_id: str,
    path: Path,
    rel_path: str,
    metadata: dict[str, Any],
    options: ImportOptions,
) -> None:
    payload = {
        "title": title_for_markdown(path),
        "document_type": metadata["document_type"],
        "owner_id": metadata["owner"],
        "gestor_unit": metadata["area"],
        "classification": metadata["classification"],
        "tags": metadata["tags"],
        "metadata": document_metadata(path, rel_path, metadata),
        "access_policies": access_policies(options.subject_id, metadata["classification"]),
    }
    patch_document(document_id, payload, options)


def patch_document(document_id: str, payload: dict[str, Any], options: ImportOptions) -> dict[str, Any]:
    return request_json("PATCH", f"{options.registry_url}/api/v1/documents/{document_id}", payload, options=options)


def create_version(
    document_id: str,
    path: Path,
    rel_path: str,
    source_uri: str,
    options: ImportOptions,
) -> dict[str, Any]:
    content = path.read_bytes()
    sha256 = f"sha256:{hashlib.sha256(content).hexdigest()}"
    payload = {
        "version_label": version_label(content),
        "valid_from": dt.date.today().isoformat(),
        "valid_to": None,
        "source_file_uri": source_uri,
        "file_hash": sha256,
        "change_summary": f"Import from docs folder: {rel_path}",
        "file": {
            "filename": path.name,
            "mime_type": "text/markdown",
            "size_bytes": len(content),
            "sha256": sha256,
            "uploaded_by": options.subject_id,
        },
    }
    try:
        return request_json(
            "POST",
            f"{options.registry_url}/api/v1/documents/{document_id}/versions",
            payload,
            options=options,
            expected_status=201,
        )
    except RuntimeError as exc:
        if "HTTP 409" not in str(exc):
            raise
        payload["version_label"] = f"{payload['version_label']}-{uuid.uuid4().hex[:6]}"
        return request_json(
            "POST",
            f"{options.registry_url}/api/v1/documents/{document_id}/versions",
            payload,
            options=options,
            expected_status=201,
        )


def publish_if_valid(
    document_id: str,
    version: dict[str, Any],
    metadata: dict[str, Any],
    options: ImportOptions,
) -> dict[str, Any]:
    if metadata.get("status", "valid") != "valid":
        return version
    published = request_json(
        "POST",
        f"{options.registry_url}/api/v1/documents/{document_id}/versions/{version['document_version_id']}/publish",
        options=options,
    )
    if published.get("status") != "valid":
        raise RuntimeError(f"Published version is not valid: {published}")
    return published


def latest_document_version(document_id: str, options: ImportOptions) -> dict[str, Any] | None:
    body = request_json(
        "GET",
        f"{options.registry_url}/api/v1/documents/{document_id}/versions?limit=100",
        options=options,
    )
    items = body.get("items") or []
    if not items:
        return None
    valid = [item for item in items if item.get("status") == "valid"]
    return valid[0] if valid else items[0]


def run_ingestion(
    document_id: str,
    document_version_id: str,
    source_uri: str,
    options: ImportOptions,
) -> dict[str, Any]:
    return request_json(
        "POST",
        f"{options.ingestion_url}/api/v1/ingestion/jobs",
        {
            "document_id": document_id,
            "document_version_id": document_version_id,
            "source_file_uri": source_uri,
            "parser_profile": "controlled_document",
            "ocr_enabled": True,
            "chunking_strategy": "legal_structured",
            "embedding_profile": "default",
        },
        options=options,
        expected_status=201,
    )


def wait_for_ingestion_report(job_id: str, options: ImportOptions) -> dict[str, Any]:
    endpoint = f"{options.ingestion_url}/api/v1/ingestion/jobs/{job_id}/report"
    deadline = time.monotonic() + options.timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            report = request_json("GET", endpoint, options=options)
            status = report.get("status")
            if status in TERMINAL_INGESTION_STATUSES:
                if status != "completed" and status != "completed_with_warnings":
                    raise RuntimeError(f"Ingestion failed for {job_id}: {report}")
                if int(report.get("chunks_created", 0)) < 1:
                    raise RuntimeError(f"Ingestion created no chunks for {job_id}: {report}")
                return report
        except Exception as exc:
            last_error = exc
        time.sleep(1)
    raise TimeoutError(f"Ingestion report was not ready for {job_id}: {last_error}")


def qdrant_count(document_version_id: str, options: ImportOptions) -> int:
    body = request_json(
        "POST",
        f"{options.qdrant_url}/collections/{options.qdrant_collection}/points/count",
        {
            "filter": {
                "must": [
                    {"key": "document_version_id", "match": {"value": document_version_id}},
                ]
            },
            "exact": True,
        },
        options=options,
        headers=qdrant_headers(),
    )
    return int(body.get("result", {}).get("count", 0))


def require_qdrant_points(document_version_id: str, chunks_created: int, qdrant_points: int) -> None:
    if qdrant_points < chunks_created:
        raise RuntimeError(
            f"Qdrant points for {document_version_id} are lower than chunks_created: "
            f"{qdrant_points} < {chunks_created}"
        )


def seed_ingestion_object(path: Path, source_uri: str, options: ImportOptions) -> None:
    parsed = urllib.parse.urlparse(source_uri)
    if parsed.scheme != "s3":
        raise ValueError(f"Only s3:// source URIs can be seeded into ingestion local storage: {source_uri}")
    target = Path("/data/object-storage") / parsed.netloc / parsed.path.lstrip("/")
    command = [
        "docker",
        "exec",
        "-i",
        options.ingestion_container,
        "sh",
        "-lc",
        f"mkdir -p {shlex.quote(str(target.parent))} && cat > {shlex.quote(str(target))}",
    ]
    subprocess.run(command, input=path.read_bytes(), check=True)


def source_uri_for(rel_path: str, options: ImportOptions) -> str:
    quoted_path = urllib.parse.quote(rel_path, safe="/._-")
    prefix = f"{options.storage_prefix}/" if options.storage_prefix else ""
    return f"s3://{options.storage_bucket}/{prefix}{quoted_path}"


def display_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def document_metadata(path: Path, rel_path: str, metadata: dict[str, Any]) -> dict[str, Any]:
    content = path.read_bytes()
    governance_metadata = {
        key: value
        for key, value in metadata.items()
        if key not in {"document_type", "classification", "status", "tags"}
    }
    return {
        **governance_metadata,
        "source_path": rel_path,
        "source_system": metadata["source_system"],
        "language": metadata["language"],
        "area": metadata["area"],
        "importer": "tools/import_docs_folder.py",
        "content_sha256": f"sha256:{hashlib.sha256(content).hexdigest()}",
    }


def access_policies(subject_id: str, classification: str) -> list[dict[str, Any]]:
    constraints = {"classification_max": classification}
    return [
        {
            "subjects": [f"user:{subject_id}", "role:reader", "role:admin"],
            "actions": ["document.read", "rag.query"],
            "constraints": constraints,
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
            "constraints": constraints,
        },
    ]


def title_for_markdown(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    frontmatter, body = parse_markdown_frontmatter(text)
    if isinstance(frontmatter.get("title"), str) and frontmatter["title"].strip():
        return frontmatter["title"].strip()
    text = body if frontmatter else text
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            title = re.sub(r"^#+\s*", "", stripped).strip()
            if title:
                return title[:300]
    return path.stem.replace("_", " ").replace("-", " ").strip().title()[:300]


def version_label(content: bytes) -> str:
    timestamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    digest = hashlib.sha256(content).hexdigest()[:10]
    return f"docs-{timestamp}-{digest}"


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    options: ImportOptions,
    expected_status: int = 200,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request_headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Request-ID": "docs-folder-import",
        "X-Correlation-ID": "docs-folder-import",
        "X-AKL-Subject": options.subject_id,
        "X-AKL-Roles": options.roles,
    }
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
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


def report_totals(files: list[Path], items: list[dict[str, Any]], errors: list[dict[str, str]]) -> dict[str, int]:
    return {
        "found_documents": len(files),
        "imported_documents": sum(1 for item in items if item.get("status") == "imported"),
        "skipped_documents": sum(1 for item in items if item.get("status") == "skipped"),
        "failed_documents": len(errors),
        "chunks_created": sum(int(item.get("chunks_created") or 0) for item in items),
        "qdrant_points": sum(int(item.get("qdrant_points") or 0) for item in items),
    }


def write_reports(report: dict[str, Any], json_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_path = json_path.with_suffix(".md")
    markdown_path.write_text(render_markdown_report(report), encoding="utf-8")


def render_markdown_report(report: dict[str, Any]) -> str:
    totals = report["totals"]
    lines = [
        "# Docs Import Report",
        "",
        f"- generated_at: `{report['generated_at']}`",
        f"- duration_seconds: `{report['duration_seconds']}`",
        f"- source: `{report['source']}`",
        f"- mode: `{report['mode']}`",
        f"- dry_run: `{report['dry_run']}`",
        f"- found_documents: `{totals['found_documents']}`",
        f"- imported_documents: `{totals['imported_documents']}`",
        f"- skipped_documents: `{totals['skipped_documents']}`",
        f"- failed_documents: `{totals['failed_documents']}`",
        f"- chunks_created: `{totals['chunks_created']}`",
        f"- qdrant_points: `{totals['qdrant_points']}`",
        "",
        "## Documents",
        "",
        "| Source | Action | Status | Chunks | Qdrant points | Error |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for item in report["documents"]:
        error = item.get("error") or {}
        message = str(error.get("message", "")).replace("|", "\\|")
        lines.append(
            "| "
            f"`{item['source_path']}` | "
            f"{item.get('action') or ''} | "
            f"{item.get('status') or ''} | "
            f"{item.get('chunks_created') or 0} | "
            f"{item.get('qdrant_points') or 0} | "
            f"{message} |"
        )
    if report["errors"]:
        lines.extend(["", "## Errors", ""])
        for error in report["errors"]:
            lines.append(f"- `{error['source_path']}`: {error['code']} - {error['message']}")
    lines.append("")
    return "\n".join(lines)


def print_summary(report: dict[str, Any], report_path: Path) -> None:
    totals = report["totals"]
    print("Docs folder import")
    print(f"found_documents={totals['found_documents']}")
    print(f"imported_documents={totals['imported_documents']}")
    print(f"skipped_documents={totals['skipped_documents']}")
    print(f"failed_documents={totals['failed_documents']}")
    print(f"chunks_created={totals['chunks_created']}")
    print(f"qdrant_points={totals['qdrant_points']}")
    print(f"report={report_path}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
