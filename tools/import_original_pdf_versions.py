#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DOMAINS = ("cz-digital-governance", "security-compliance-cz")


@dataclass(frozen=True)
class Options:
    imports_root: Path
    storage_root: Path
    bucket: str
    domains: tuple[str, ...]
    report_path: Path
    apply: bool
    compose_file: Path
    env_file: Path | None
    registry_service: str
    actor_id: str
    roles: str
    ingestion_url: str
    qdrant_url: str
    qdrant_collection: str
    timeout_seconds: int
    keep_superseded_qdrant: bool


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)
    started = dt.datetime.now(dt.UTC)
    plan = discover_plan(options)
    planned_pdf_versions = sum(1 for item in plan if item.get("status") == "planned")
    missing_pdf_sources = sum(1 for item in plan if item.get("status") == "missing_pdf_source")
    report: dict[str, Any] = {
        "generated_at": started.isoformat().replace("+00:00", "Z"),
        "mode": "apply" if options.apply else "dry-run",
        "imports_root": str(options.imports_root),
        "storage_root": str(options.storage_root),
        "bucket": options.bucket,
        "domains": list(options.domains),
        "totals": {
            "planned_pdf_versions": planned_pdf_versions,
            "missing_pdf_sources": missing_pdf_sources,
            "copied_objects": 0,
            "created_versions": 0,
            "ingested_versions": 0,
            "failed_versions": 0,
        },
        "documents": plan,
        "errors": [],
    }

    if options.apply:
        try:
            copy_result = copy_pdf_objects(plan, options)
            report["totals"]["copied_objects"] = copy_result["copied_objects"]
            report["errors"].extend(copy_result["errors"])
            if copy_result["errors"]:
                write_reports(report, options.report_path)
                print_summary(report)
                return 1
            migration_result = run_registry_migration(plan, options)
            report["migration"] = migration_result
            report["totals"]["created_versions"] = migration_result["totals"]["created_versions"]
            report["totals"]["ingested_versions"] = migration_result["totals"]["ingested_versions"]
            report["totals"]["failed_versions"] = migration_result["totals"]["failed_versions"]
            report["errors"].extend(migration_result.get("errors", []))
        except Exception as exc:
            report["errors"].append(
                {
                    "source_path": None,
                    "code": exc.__class__.__name__,
                    "message": str(exc),
                }
            )

    report["finished_at"] = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    write_reports(report, options.report_path)
    print_summary(report)
    return 1 if report["errors"] else 0


def parse_args(argv: list[str] | None) -> Options:
    parser = argparse.ArgumentParser(description="Import original PDF files as current AKB document versions.")
    parser.add_argument("--imports-root", default="/srv/akl/imports", help="Root containing <domain>/source and <domain>/raw folders.")
    parser.add_argument("--storage-root", default="/srv/seaweedfs/akl", help="Host object-storage root mounted into AKB services.")
    parser.add_argument("--bucket", default="akl-documents")
    parser.add_argument("--domain", action="append", dest="domains", help="Domain folder to process. Can be repeated.")
    parser.add_argument("--report", default="reports/original_pdf_import_report.json")
    parser.add_argument("--apply", action="store_true", help="Mutate object storage, Registry, Ingestion and Qdrant. Default is dry-run.")
    parser.add_argument("--compose-file", default="infra/docker-compose/docker-compose.docker-home.yml")
    parser.add_argument("--env-file", default="/srv/akl/env/akl.prod.env")
    parser.add_argument("--registry-service", default="registry-api")
    parser.add_argument("--actor-id", default="original-pdf-import")
    parser.add_argument("--roles", default="admin,document_manager,service_ingestion")
    parser.add_argument("--ingestion-url", default="http://ingestion-service:8090/api/v1")
    parser.add_argument("--qdrant-url", default="http://qdrant:6333")
    parser.add_argument("--qdrant-collection", default="akl_document_chunks")
    parser.add_argument("--timeout-seconds", type=int, default=300)
    parser.add_argument("--keep-superseded-qdrant", action="store_true", help="Do not delete old Markdown Qdrant points after successful PDF ingestion.")
    args = parser.parse_args(argv)

    report_path = Path(args.report)
    if not report_path.is_absolute():
        report_path = ROOT / report_path
    compose_file = Path(args.compose_file)
    if not compose_file.is_absolute():
        compose_file = ROOT / compose_file
    env_file = Path(args.env_file) if args.env_file else None

    return Options(
        imports_root=Path(args.imports_root),
        storage_root=Path(args.storage_root),
        bucket=args.bucket,
        domains=tuple(args.domains or DEFAULT_DOMAINS),
        report_path=report_path,
        apply=bool(args.apply),
        compose_file=compose_file,
        env_file=env_file,
        registry_service=args.registry_service,
        actor_id=args.actor_id,
        roles=args.roles,
        ingestion_url=args.ingestion_url.rstrip("/"),
        qdrant_url=args.qdrant_url.rstrip("/"),
        qdrant_collection=args.qdrant_collection,
        timeout_seconds=args.timeout_seconds,
        keep_superseded_qdrant=bool(args.keep_superseded_qdrant),
    )


def discover_plan(options: Options) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for domain in options.domains:
        source_root = options.imports_root / domain / "source"
        raw_root = options.imports_root / domain / "raw"
        if not source_root.exists():
            continue
        for markdown_path in sorted(source_root.rglob("*.md")):
            rel_path = markdown_path.relative_to(source_root).as_posix()
            pdf_path = raw_root / f"{markdown_path.stem}.pdf"
            if not pdf_path.exists():
                items.append(
                    {
                        "domain": domain,
                        "source_path": rel_path,
                        "markdown_path": str(markdown_path),
                        "pdf_path": str(pdf_path),
                        "status": "missing_pdf_source",
                    }
                )
                continue
            pdf_bytes = pdf_path.read_bytes()
            object_key = f"{domain}/{rel_path[:-3]}.pdf"
            items.append(
                {
                    "domain": domain,
                    "source_path": rel_path,
                    "title": title_for_markdown(markdown_path),
                    "markdown_path": str(markdown_path),
                    "pdf_path": str(pdf_path),
                    "markdown_source_uri": f"s3://{options.bucket}/{domain}/{rel_path}",
                    "pdf_source_uri": f"s3://{options.bucket}/{object_key}",
                    "object_key": object_key,
                    "filename": pdf_path.name,
                    "mime_type": "application/pdf",
                    "size_bytes": len(pdf_bytes),
                    "sha256": f"sha256:{hashlib.sha256(pdf_bytes).hexdigest()}",
                    "status": "planned",
                }
            )
    return items


def title_for_markdown(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            title = stripped.lstrip("#").strip()
            if title:
                return title[:300]
    return path.stem.replace("-", " ").replace("_", " ").title()[:300]


def copy_pdf_objects(plan: list[dict[str, Any]], options: Options) -> dict[str, Any]:
    copied = 0
    errors: list[dict[str, str]] = []
    for item in plan:
        if item["status"] != "planned":
            continue
        source = Path(item["pdf_path"])
        target = options.storage_root / options.bucket / item["object_key"]
        try:
            if target.exists():
                current_hash = f"sha256:{hashlib.sha256(target.read_bytes()).hexdigest()}"
                if current_hash != item["sha256"]:
                    raise RuntimeError(f"Existing object hash differs for {item['object_key']}")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                copied += 1
        except Exception as exc:
            errors.append({"source_path": item["source_path"], "code": exc.__class__.__name__, "message": str(exc)})
    return {"copied_objects": copied, "errors": errors}


def run_registry_migration(plan: list[dict[str, Any]], options: Options) -> dict[str, Any]:
    planned = [item for item in plan if item["status"] == "planned"]
    plan_b64 = base64.b64encode(json.dumps(planned, ensure_ascii=False).encode("utf-8")).decode("ascii")
    code = registry_migration_code(
        plan_b64=plan_b64,
        actor_id=options.actor_id,
        roles=options.roles,
        ingestion_url=options.ingestion_url,
        qdrant_url=options.qdrant_url,
        qdrant_collection=options.qdrant_collection,
        timeout_seconds=options.timeout_seconds,
        delete_superseded_qdrant=not options.keep_superseded_qdrant,
    )
    command = ["docker", "compose"]
    if options.env_file:
        command.extend(["--env-file", str(options.env_file)])
    command.extend(["-f", str(options.compose_file), "exec", "-T", options.registry_service, "python", "-"])
    completed = subprocess.run(command, input=code, text=True, capture_output=True)
    if completed.returncode != 0:
        raise RuntimeError(f"Registry migration failed: {completed.stderr.strip() or completed.stdout.strip()}")
    return json.loads(completed.stdout)


def registry_migration_code(
    *,
    plan_b64: str,
    actor_id: str,
    roles: str,
    ingestion_url: str,
    qdrant_url: str,
    qdrant_collection: str,
    timeout_seconds: int,
    delete_superseded_qdrant: bool,
) -> str:
    return f"""
from __future__ import annotations

import base64
import datetime as dt
import json
import time
import urllib.error
import urllib.request

from sqlalchemy import select

from app.audit import add_audit_event
from app.database import SessionLocal
from app.models import Document, DocumentFile, DocumentVersion, make_id, utcnow

PLAN = json.loads(base64.b64decode({plan_b64!r}).decode("utf-8"))
ACTOR_ID = {actor_id!r}
ROLES = {roles!r}
INGESTION_URL = {ingestion_url!r}
QDRANT_URL = {qdrant_url!r}
QDRANT_COLLECTION = {qdrant_collection!r}
TIMEOUT_SECONDS = {int(timeout_seconds)!r}
DELETE_SUPERSEDED_QDRANT = {bool(delete_superseded_qdrant)!r}


def request_json(method, url, payload=None, expected_status=200):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={{
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Request-ID": "original-pdf-import",
            "X-Correlation-ID": "original-pdf-import",
            "X-AKL-Subject": ACTOR_ID,
            "X-AKL-Roles": ROLES,
        }},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            body = json.loads(raw) if raw else {{}}
            status = response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        raise RuntimeError(f"{{method}} {{url}} failed with HTTP {{exc.code}}: {{raw}}") from exc
    if status != expected_status:
        raise RuntimeError(f"{{method}} {{url}} returned HTTP {{status}}, expected {{expected_status}}: {{body}}")
    return body


def qdrant_count(version_id):
    body = request_json(
        "POST",
        f"{{QDRANT_URL}}/collections/{{QDRANT_COLLECTION}}/points/count",
        {{"filter": {{"must": [{{"key": "document_version_id", "match": {{"value": version_id}}}}]}}, "exact": True}},
    )
    return int(body.get("result", {{}}).get("count", 0))


def qdrant_delete(version_id):
    request_json(
        "POST",
        f"{{QDRANT_URL}}/collections/{{QDRANT_COLLECTION}}/points/delete?wait=true",
        {{"filter": {{"must": [{{"key": "document_version_id", "match": {{"value": version_id}}}}]}}}},
    )


def wait_for_ingestion(job_id):
    deadline = time.monotonic() + TIMEOUT_SECONDS
    endpoint = f"{{INGESTION_URL}}/ingestion/jobs/{{job_id}}/report"
    last_error = None
    while time.monotonic() < deadline:
        try:
            report = request_json("GET", endpoint)
            status = report.get("status")
            if status in {{"completed", "completed_with_warnings", "failed", "cancelled"}}:
                return report
        except Exception as exc:
            last_error = str(exc)
        time.sleep(1)
    raise TimeoutError(f"Ingestion report was not ready for {{job_id}}: {{last_error}}")


def find_document(db, item):
    candidates = list(db.execute(select(Document).where(Document.status != "cancelled")).scalars())
    for document in candidates:
        metadata = document.document_metadata or {{}}
        if metadata.get("source_path") != item["source_path"]:
            continue
        versions = list(db.execute(select(DocumentVersion).where(DocumentVersion.document_id == document.document_id)).scalars())
        if any(version.source_file_uri == item["markdown_source_uri"] for version in versions):
            return document, versions
    return None, []


created = []
results = []
errors = []
now = utcnow()
today = dt.date.today()

with SessionLocal() as db:
    for item in PLAN:
        try:
            document, versions = find_document(db, item)
            if document is None:
                results.append({{**item, "status": "skipped", "reason": "document_not_found"}})
                continue
            existing_pdf = [
                version for version in versions
                if version.source_file_uri == item["pdf_source_uri"] and version.file_hash == item["sha256"]
            ]
            if existing_pdf:
                results.append({{
                    **item,
                    "status": "skipped",
                    "reason": "pdf_version_already_exists",
                    "document_id": document.document_id,
                    "document_version_id": existing_pdf[0].document_version_id,
                }})
                continue
            label_base = f"origpdf-{{now.strftime('%Y%m%dT%H%M%SZ')}}-{{item['sha256'].split(':', 1)[1][:10]}}"
            labels = {{version.version_label for version in versions}}
            label = label_base
            counter = 2
            while label in labels:
                label = f"{{label_base}}-{{counter}}"
                counter += 1
            version = DocumentVersion(
                document_version_id=make_id("ver"),
                document_id=document.document_id,
                version_label=label,
                status="draft",
                valid_from=today,
                valid_to=None,
                source_file_uri=item["pdf_source_uri"],
                file_hash=item["sha256"],
                change_summary=f"Original PDF source import for {{item['source_path']}}",
                published_at=None,
            )
            db.add(version)
            db.flush()
            db.add(DocumentFile(
                document_id=document.document_id,
                document_version_id=version.document_version_id,
                uri=item["pdf_source_uri"],
                filename=item["filename"],
                mime_type=item["mime_type"],
                size_bytes=item["size_bytes"],
                sha256=item["sha256"],
                uploaded_by=ACTOR_ID,
            ))
            add_audit_event(
                db,
                actor_id=ACTOR_ID,
                event_type="document.original_source.version_created",
                resource_type="document_version",
                resource_id=version.document_version_id,
                metadata={{
                    "document_id": document.document_id,
                    "source_path": item["source_path"],
                    "source_file_uri": item["pdf_source_uri"],
                    "supersedes_after_ingestion": [v.document_version_id for v in versions if v.status == "valid"],
                }},
            )
            created.append({{
                **item,
                "document_id": document.document_id,
                "document_version_id": version.document_version_id,
                "version_label": version.version_label,
                "old_valid_version_ids": [v.document_version_id for v in versions if v.status == "valid"],
            }})
        except Exception as exc:
            db.rollback()
            errors.append({{"source_path": item.get("source_path"), "code": exc.__class__.__name__, "message": str(exc)}})
            raise
    db.commit()

for item in created:
    try:
        job = request_json(
            "POST",
            f"{{INGESTION_URL}}/ingestion/jobs",
            {{
                "document_id": item["document_id"],
                "document_version_id": item["document_version_id"],
                "source_file_uri": item["pdf_source_uri"],
                "parser_profile": "controlled_document",
                "ocr_enabled": True,
                "chunking_strategy": "legal_structured",
                "embedding_profile": "default",
            }},
            expected_status=201,
        )
        report = wait_for_ingestion(job["job_id"])
        if report.get("status") not in {{"completed", "completed_with_warnings"}} or int(report.get("chunks_created") or 0) < 1:
            raise RuntimeError(f"Ingestion did not complete with chunks: {{report}}")
        item["ingestion_job_id"] = job["job_id"]
        item["ingestion_status"] = report.get("status")
        item["chunks_created"] = int(report.get("chunks_created") or 0)
        item["qdrant_points"] = qdrant_count(item["document_version_id"])
        item["status"] = "ingested"
    except Exception as exc:
        item["status"] = "failed"
        item["error"] = {{"code": exc.__class__.__name__, "message": str(exc)}}
        errors.append({{"source_path": item["source_path"], "code": exc.__class__.__name__, "message": str(exc)}})

with SessionLocal() as db:
    for item in created:
        version = db.get(DocumentVersion, item["document_version_id"])
        document = db.get(Document, item["document_id"])
        if version is None or document is None:
            continue
        if item.get("status") == "ingested":
            version.status = "valid"
            version.published_at = utcnow()
            for old_version_id in item["old_valid_version_ids"]:
                old_version = db.get(DocumentVersion, old_version_id)
                if old_version is not None and old_version.document_version_id != version.document_version_id:
                    old_version.status = "superseded"
            document.status = "valid"
            metadata = dict(document.document_metadata or {{}})
            metadata["original_source_file_uri"] = item["pdf_source_uri"]
            metadata["original_source_imported_at"] = now.isoformat().replace("+00:00", "Z")
            metadata["text_derivative_source_file_uri"] = item["markdown_source_uri"]
            document.document_metadata = metadata
            add_audit_event(
                db,
                actor_id=ACTOR_ID,
                event_type="document.original_source.version_published",
                resource_type="document_version",
                resource_id=version.document_version_id,
                metadata={{
                    "document_id": document.document_id,
                    "source_path": item["source_path"],
                    "source_file_uri": item["pdf_source_uri"],
                    "old_valid_version_ids": item["old_valid_version_ids"],
                    "ingestion_job_id": item.get("ingestion_job_id"),
                }},
            )
        else:
            version.status = "archived"
            add_audit_event(
                db,
                actor_id=ACTOR_ID,
                event_type="document.original_source.version_archived_after_failed_ingestion",
                resource_type="document_version",
                resource_id=version.document_version_id,
                severity="warning",
                metadata={{"document_id": document.document_id, "source_path": item["source_path"], "error": item.get("error")}},
            )
    db.commit()

if DELETE_SUPERSEDED_QDRANT:
    for item in created:
        if item.get("status") != "ingested":
            continue
        deleted = []
        for old_version_id in item["old_valid_version_ids"]:
            try:
                qdrant_delete(old_version_id)
                deleted.append(old_version_id)
            except Exception as exc:
                item.setdefault("warnings", []).append(f"QDRANT_DELETE_FAILED {{old_version_id}}: {{exc}}")
        item["deleted_qdrant_version_ids"] = deleted

results.extend(created)
output = {{
    "totals": {{
        "planned_pdf_versions": len(PLAN),
        "created_versions": len(created),
        "ingested_versions": sum(1 for item in created if item.get("status") == "ingested"),
        "failed_versions": sum(1 for item in created if item.get("status") == "failed"),
    }},
    "documents": results,
    "errors": errors,
}}
print(json.dumps(output, ensure_ascii=False, indent=2))
"""


def write_reports(report: dict[str, Any], json_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_path = json_path.with_suffix(".md")
    markdown_path.write_text(render_markdown_report(report), encoding="utf-8")


def render_markdown_report(report: dict[str, Any]) -> str:
    totals = report["totals"]
    lines = [
        "# Original PDF Import Report",
        "",
        f"- generated_at: `{report['generated_at']}`",
        f"- mode: `{report['mode']}`",
        f"- planned_pdf_versions: `{totals['planned_pdf_versions']}`",
        f"- missing_pdf_sources: `{totals['missing_pdf_sources']}`",
        f"- copied_objects: `{totals['copied_objects']}`",
        f"- created_versions: `{totals['created_versions']}`",
        f"- ingested_versions: `{totals['ingested_versions']}`",
        f"- failed_versions: `{totals['failed_versions']}`",
        "",
        "## Documents",
        "",
        "| Domain | Source path | Status | PDF source URI | Version | Chunks | Qdrant |",
        "|---|---|---:|---|---|---:|---:|",
    ]
    documents = report.get("migration", {}).get("documents") if report.get("migration") else report["documents"]
    for item in documents:
        lines.append(
            "| "
            f"{item.get('domain', '')} | "
            f"`{item.get('source_path', '')}` | "
            f"{item.get('status', '')} | "
            f"`{item.get('pdf_source_uri', '')}` | "
            f"`{item.get('document_version_id', '')}` | "
            f"{item.get('chunks_created', 0) or 0} | "
            f"{item.get('qdrant_points', 0) or 0} |"
        )
    if report.get("errors"):
        lines.extend(["", "## Errors", ""])
        for error in report["errors"]:
            lines.append(f"- `{error.get('source_path')}`: {error.get('code')} - {error.get('message')}")
    lines.append("")
    return "\n".join(lines)


def print_summary(report: dict[str, Any]) -> None:
    totals = report["totals"]
    print("Original PDF import")
    print(f"mode={report['mode']}")
    print(f"planned_pdf_versions={totals['planned_pdf_versions']}")
    print(f"missing_pdf_sources={totals['missing_pdf_sources']}")
    print(f"copied_objects={totals['copied_objects']}")
    print(f"created_versions={totals['created_versions']}")
    print(f"ingested_versions={totals['ingested_versions']}")
    print(f"failed_versions={totals['failed_versions']}")
    print(f"errors={len(report['errors'])}")


if __name__ == "__main__":
    raise SystemExit(main())
