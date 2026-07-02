#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import unicodedata
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DOMAINS = ("cz-digital-governance", "security-compliance-cz")
CONFIRMATION = "reset-documents"
TERMINAL_OK = {"completed", "completed_with_warnings"}
KNOWN_TITLE_REPAIRS = {
    "prvodce-zenm-aktiv-a-rizik-dle-vyhlky-o-kybernetick-bezpenosti": (
        "Průvodce zněním aktiv a rizik dle vyhlášky o kybernetické bezpečnosti"
    ),
    "prvodce-dokldn-poadavk-pro-zpis-sluby-cloud-computingu-v-1": (
        "Průvodce dokládáním požadavků pro zápis služby cloud computingu v.1"
    ),
    "prvodce-dokldn-poadavk-pro-zpis-sluby-cloud-computingu-v-1-2": (
        "Průvodce dokládáním požadavků pro zápis služby cloud computingu v.1.2"
    ),
    "ploha-1-vzorov-politika-systmu-zen-bezpenosti-informac": (
        "Příloha 1 - Vzorová politika systému řízení bezpečnosti informací"
    ),
}


@dataclass(frozen=True)
class Options:
    imports_root: Path
    storage_root: Path
    bucket: str
    domains: tuple[str, ...]
    report_path: Path
    apply: bool
    confirm: str | None
    include_markdown_fallback: bool
    compose_file: Path
    env_file: Path | None
    registry_service: str
    ingestion_service: str
    storage_writer_service: str
    storage_container_root: PurePosixPath
    actor_id: str
    owner_id: str
    roles: str
    qdrant_collection: str
    timeout_seconds: int


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)
    started = dt.datetime.now(dt.UTC)
    plan = discover_plan(options)
    report: dict[str, Any] = {
        "generated_at": started.isoformat().replace("+00:00", "Z"),
        "mode": "apply" if options.apply else "dry-run",
        "imports_root": str(options.imports_root),
        "storage_root": str(options.storage_root),
        "bucket": options.bucket,
        "domains": list(options.domains),
        "report_path": str(options.report_path),
        "include_markdown_fallback": options.include_markdown_fallback,
        "totals": plan_totals(plan),
        "documents": plan,
        "errors": [],
        "warnings": [],
    }

    if options.apply:
        if options.confirm != CONFIRMATION:
            report["errors"].append(
                {
                    "code": "CONFIRMATION_REQUIRED",
                    "message": f"Apply mode requires --confirm {CONFIRMATION}",
                }
            )
            write_reports(report, options.report_path)
            print_summary(report)
            return 1

        try:
            reset_result = reset_registry_documents(options)
            report["reset_registry"] = reset_result
            storage_result = reset_storage_and_copy(plan, options)
            report["storage"] = storage_result
            report["errors"].extend(storage_result.get("errors", []))
            if storage_result.get("errors"):
                write_reports(report, options.report_path)
                print_summary(report)
                return 1

            report["qdrant_reset"] = reset_qdrant_collection(options)
            report["job_store_reset"] = reset_ingestion_job_store(options)
            created = create_registry_documents(plan, options)
            report["created"] = created
            if created.get("errors"):
                report["errors"].extend(created["errors"])
                write_reports(report, options.report_path)
                print_summary(report)
                return 1

            llm_gateway_bearer_token = resolve_llm_gateway_bearer_token(options)
            ingestion = run_maintenance_ingestion(
                created.get("documents", []),
                options,
                llm_gateway_bearer_token=llm_gateway_bearer_token,
            )
            report["ingestion"] = ingestion
            published = publish_registry_results(ingestion.get("documents", []), options)
            report["published"] = published
            report["errors"].extend(ingestion.get("errors", []))
            report["errors"].extend(published.get("errors", []))
            report["totals"] = final_totals(report)
        except Exception as exc:
            report["errors"].append({"code": exc.__class__.__name__, "message": str(exc)})

    report["finished_at"] = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    write_reports(report, options.report_path)
    print_summary(report)
    return 1 if report["errors"] else 0


def parse_args(argv: list[str] | None) -> Options:
    parser = argparse.ArgumentParser(
        description="Reset AKB document corpus and import available original PDFs as the primary source."
    )
    parser.add_argument(
        "--imports-root",
        default="/srv/akl/imports",
        help="Root containing <domain>/source Markdown derivatives and <domain>/raw original PDFs.",
    )
    parser.add_argument(
        "--storage-root",
        default="/srv/seaweedfs/akl",
        help="Host object-storage root mounted into AKB services.",
    )
    parser.add_argument("--bucket", default="akl-documents")
    parser.add_argument("--domain", action="append", dest="domains", help="Domain folder to process. Can be repeated.")
    parser.add_argument("--report", default="reports/pdf_first_corpus_reset_report.json")
    parser.add_argument("--apply", action="store_true", help="Mutate Registry, object storage, ingestion jobs and Qdrant.")
    parser.add_argument("--confirm", help=f"Required with --apply. Must be {CONFIRMATION!r}.")
    parser.add_argument(
        "--include-markdown-fallback",
        action="store_true",
        help="Import Markdown derivatives when no matching raw PDF exists. Default is to skip them and report missing PDFs.",
    )
    parser.add_argument("--compose-file", default="infra/docker-compose/docker-compose.docker-home.yml")
    parser.add_argument("--env-file", default="/srv/akl/env/akl.prod.env")
    parser.add_argument("--registry-service", default="registry-api")
    parser.add_argument("--ingestion-service", default="ingestion-service")
    parser.add_argument(
        "--storage-writer-service",
        default="web",
        help="Compose service used as fallback writer when the host user cannot write object storage.",
    )
    parser.add_argument("--storage-container-root", default="/data/object-storage")
    parser.add_argument("--actor-id", default="pdf-first-corpus-reset")
    parser.add_argument("--owner-id", default="akb-document-curator")
    parser.add_argument("--roles", default="admin,document_manager,service_ingestion,service_rag")
    parser.add_argument("--qdrant-collection", default="akl_document_chunks")
    parser.add_argument("--timeout-seconds", type=int, default=900)
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
        confirm=args.confirm,
        include_markdown_fallback=bool(args.include_markdown_fallback),
        compose_file=compose_file,
        env_file=env_file,
        registry_service=args.registry_service,
        ingestion_service=args.ingestion_service,
        storage_writer_service=args.storage_writer_service,
        storage_container_root=PurePosixPath(args.storage_container_root),
        actor_id=args.actor_id,
        owner_id=args.owner_id,
        roles=args.roles,
        qdrant_collection=args.qdrant_collection,
        timeout_seconds=args.timeout_seconds,
    )


def discover_plan(options: Options) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    index = 0
    for domain in options.domains:
        source_root = options.imports_root / domain / "source"
        raw_root = options.imports_root / domain / "raw"
        if not source_root.exists():
            continue
        for markdown_path in sorted(source_root.rglob("*.md")):
            index += 1
            rel_path = markdown_path.relative_to(source_root).as_posix()
            pdf_path = raw_root / f"{markdown_path.stem}.pdf"
            metadata = parse_markdown_metadata(markdown_path, pdf_path=pdf_path if pdf_path.exists() else None)
            if pdf_path.exists():
                source_path = pdf_path
                source_kind = "pdf"
                source_uri = f"s3://{options.bucket}/{domain}/{rel_path[:-3]}.pdf"
                object_key = f"{domain}/{rel_path[:-3]}.pdf"
                mime_type = "application/pdf"
            elif options.include_markdown_fallback:
                source_path = markdown_path
                source_kind = "markdown_fallback"
                source_uri = f"s3://{options.bucket}/{domain}/{rel_path}"
                object_key = f"{domain}/{rel_path}"
                mime_type = "text/markdown"
            else:
                items.append(
                    {
                        "index": index,
                        "domain": domain,
                        "source_path": rel_path,
                        "title": metadata["title"],
                        "status": "missing_pdf_source",
                        "markdown_path": str(markdown_path),
                        "expected_pdf_path": str(pdf_path),
                        "canonical_url": metadata.get("canonical_url"),
                        "source_pdf_url": metadata.get("source_pdf_url"),
                    }
                )
                continue

            content = source_path.read_bytes()
            sha256 = f"sha256:{hashlib.sha256(content).hexdigest()}"
            declared_pdf_sha256 = metadata.get("declared_pdf_sha256")
            warnings = []
            if source_kind == "pdf" and declared_pdf_sha256 and f"sha256:{declared_pdf_sha256}" != sha256:
                warnings.append("DECLARED_PDF_SHA256_MISMATCH")
            items.append(
                {
                    "index": index,
                    "domain": domain,
                    "source_path": rel_path,
                    "title": metadata["title"],
                    "status": "planned",
                    "source_kind": source_kind,
                    "markdown_path": str(markdown_path),
                    "source_file_path": str(source_path),
                    "source_file_uri": source_uri,
                    "object_key": object_key,
                    "filename": source_path.name,
                    "mime_type": mime_type,
                    "size_bytes": len(content),
                    "sha256": sha256,
                    "document_type": metadata["document_type"],
                    "classification": metadata["classification"],
                    "language": metadata.get("language", "cs"),
                    "canonical_url": metadata.get("canonical_url"),
                    "source_pdf_url": metadata.get("source_pdf_url"),
                    "title_source": metadata.get("title_source"),
                    "summary": metadata.get("summary"),
                    "tags": metadata["tags"],
                    "warnings": warnings,
                }
            )
    return items


def parse_markdown_metadata(path: Path, *, pdf_path: Path | None = None) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    heading_title = ""
    metadata: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and not heading_title:
            candidate = stripped.lstrip("#").strip()
            if candidate:
                heading_title = candidate[:300]
            continue
        if not stripped.startswith("- ") or ":" not in stripped:
            continue
        key, value = stripped[2:].split(":", 1)
        metadata[normalize_key(key)] = value.strip()

    title, title_source = select_document_title(
        path=path,
        heading_title=heading_title,
        metadata=metadata,
        pdf_path=pdf_path,
    )
    classification = (metadata.get("klasifikace") or "public").lower()
    if classification not in {"public", "internal", "restricted", "confidential"}:
        classification = "internal"
    source_type = (metadata.get("typ zdroje") or "").lower()
    document_type = document_type_for(title=title, source_type=source_type)
    tags = tags_for(path=path, title=title, source_type=source_type, document_type=document_type)

    return {
        "title": title,
        "document_type": document_type,
        "classification": classification,
        "language": metadata.get("jazyk") or "cs",
        "canonical_url": metadata.get("kanonicka url"),
        "source_pdf_url": metadata.get("zdroj pdf"),
        "declared_pdf_sha256": metadata.get("sha-256 pdf"),
        "summary": metadata.get("shrnuti pro akb"),
        "title_source": title_source,
        "tags": tags,
    }


def select_document_title(
    *,
    path: Path,
    heading_title: str = "",
    metadata: dict[str, str] | None = None,
    pdf_path: Path | None = None,
) -> tuple[str, str]:
    metadata = metadata or {}
    candidates: list[tuple[str, str]] = []
    for key in ("nazev", "titul", "title"):
        candidates.append((f"metadata:{key}", metadata.get(key, "")))
    candidates.extend(
        [
            ("markdown_heading", heading_title),
            ("catalog_title", metadata.get("puvodni katalogova polozka", "")),
            ("pdf_metadata", title_from_pdf_metadata(pdf_path)),
            ("pdf_first_page", title_from_pdf_first_page(pdf_path)),
            ("source_pdf_url", title_from_url(metadata.get("zdroj pdf", ""))),
            ("path_stem", path.stem.replace("-", " ").replace("_", " ")),
        ]
    )
    scored = [
        (title_quality_score(title, source), source, clean_title(title))
        for source, title in candidates
        if clean_title(title)
    ]
    if not scored:
        return "Veřejný PDF dokument", "fallback"
    _, source, title = max(scored, key=lambda item: item[0])
    repaired_title = known_title_repair(path=path, candidates=[title])
    normalized_title = normalize_key(title)
    if repaired_title and (looks_like_czech_diacritics_loss(normalized_title) or looks_generic_title(normalized_title)):
        return repaired_title[:300], "known_title_repair"
    return title[:300], source


def clean_title(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip(" -–—:\t\r\n")


def known_title_repair(*, path: Path, candidates: list[str]) -> str:
    identifiers = [path.stem, path.as_posix(), *candidates]
    for identifier in identifiers:
        normalized = slugify(identifier)
        for broken_slug, title in sorted(KNOWN_TITLE_REPAIRS.items(), key=lambda item: len(item[0]), reverse=True):
            if normalized == broken_slug or normalized.startswith(f"{broken_slug}-"):
                return title
    return ""


def title_from_url(url: str) -> str:
    if not url:
        return ""
    import urllib.parse

    parsed = urllib.parse.urlparse(url)
    name = urllib.parse.unquote(Path(parsed.path.rstrip("/") or "").name)
    return re.sub(r"\.pdf$", "", name, flags=re.IGNORECASE).replace("_", " ").replace("-", " ")


def title_from_pdf_metadata(pdf_path: Path | None) -> str:
    if not pdf_path or not pdf_path.exists():
        return ""
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(pdf_path.read_bytes()))
        metadata = reader.metadata
        return clean_title(getattr(metadata, "title", "") or "")
    except Exception:
        return ""


def title_from_pdf_first_page(pdf_path: Path | None) -> str:
    if not pdf_path or not pdf_path.exists():
        return ""
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(pdf_path.read_bytes()))
        if not reader.pages:
            return ""
        text = reader.pages[0].extract_text() or ""
    except Exception:
        return ""
    for line in text.splitlines()[:20]:
        candidate = clean_title(line)
        if is_plausible_title(candidate):
            return candidate
    return ""


def is_plausible_title(value: str) -> bool:
    normalized = normalize_key(value)
    if len(value) < 8 or len(value) > 180:
        return False
    if normalized.startswith(("strana ", "page ")):
        return False
    if re.fullmatch(r"[\d\s./:-]+", value):
        return False
    return any(char.isalpha() for char in value)


def title_quality_score(value: str, source: str) -> int:
    title = clean_title(value)
    if not title:
        return -1000
    normalized = normalize_key(title)
    score = min(len(title), 120)
    if any(char in "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ" for char in title):
        score += 70
    score += {
        "metadata:nazev": 45,
        "metadata:titul": 45,
        "metadata:title": 35,
        "catalog_title": 40,
        "pdf_metadata": 35,
        "pdf_first_page": 30,
        "markdown_heading": 20,
        "source_pdf_url": 5,
        "path_stem": -45,
    }.get(source, 0)
    if looks_generic_title(normalized):
        score -= 80
    if looks_like_slug_title(title):
        score -= 35
    if looks_like_czech_diacritics_loss(normalized):
        score -= 65
    return score


def looks_generic_title(normalized: str) -> bool:
    return normalized in {
        "zde",
        "download",
        "soubor",
        "dokument",
        "pdf",
        "verejny pdf dokument",
        "architektura egovernmentu",
        "digitalni ekonomika",
        "egovernment cloud",
        "library",
        "ostatni publikace",
        "podpurne materialy",
        "strategie akcni plan",
        "umela inteligence",
        "zpravy o cinnosti digitalni a informacni agentury",
    }


def looks_like_slug_title(value: str) -> bool:
    if any(char in value for char in "_-"):
        return True
    words = value.split()
    return len(words) >= 5 and not any(char in "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ" for char in value)


def looks_like_czech_diacritics_loss(normalized: str) -> bool:
    suspicious_tokens = {
        "prvodce",
        "znenm",
        "zenm",
        "vyhlky",
        "bezpenosti",
        "dokldn",
        "informac",
        "ploha",
        "poadavk",
        "sluby",
        "systmu",
        "kybernetick",
        "vzorov",
        "zen",
    }
    return bool(set(normalized.split()).intersection(suspicious_tokens))


def normalize_key(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
        .strip()
    )
    return " ".join(ascii_value.split())


def document_type_for(*, title: str, source_type: str) -> str:
    lowered = f"{title} {source_type}".lower()
    if "vyhlaska" in normalize_key(lowered) or "zákon" in lowered or "zakon" in normalize_key(lowered):
        return "regulation"
    if "metodik" in lowered or "pokyn" in lowered:
        return "methodology"
    if "strategie" in lowered or "koncepce" in lowered or "politika" in lowered:
        return "policy"
    if "manual" in lowered or "navod" in normalize_key(lowered):
        return "manual"
    return "other"


def tags_for(*, path: Path, title: str, source_type: str, document_type: str) -> list[str]:
    normalized_title = normalize_key(title)
    tags = {
        "pdf-first-corpus",
        "public-source",
        f"type:{document_type}",
    }
    path_parts = {normalize_key(part) for part in path.parts}
    if "regulations" in path_parts or document_type == "regulation":
        tags.add("legal")
    if "security" in normalize_key(str(path)) or "kyber" in normalized_title or "bezpec" in normalized_title:
        tags.add("cybersecurity")
    if "digital" in normalized_title or "egovernment" in normalized_title or "isvs" in normalized_title:
        tags.add("digital-government")
    if "utajovan" in normalized_title:
        tags.add("classified-information")
    if source_type:
        tags.add(f"source:{slugify(source_type)}")
    return sorted(tags)


def slugify(value: str) -> str:
    normalized = normalize_key(value)
    result = []
    previous_dash = False
    for char in normalized:
        if char.isalnum():
            result.append(char)
            previous_dash = False
        elif not previous_dash:
            result.append("-")
            previous_dash = True
    return "".join(result).strip("-")


def reset_registry_documents(options: Options) -> dict[str, Any]:
    return run_registry_code(registry_reset_code(options), options)


def create_registry_documents(plan: list[dict[str, Any]], options: Options) -> dict[str, Any]:
    planned = [item for item in plan if item.get("status") == "planned"]
    return run_registry_code(registry_create_code(planned, options), options)


def publish_registry_results(documents: list[dict[str, Any]], options: Options) -> dict[str, Any]:
    return run_registry_code(registry_publish_code(documents, options), options)


def run_registry_code(code: str, options: Options) -> dict[str, Any]:
    command = compose_command(options)
    command.extend(["exec", "-T", options.registry_service, "python", "-"])
    completed = subprocess.run(command, input=code, text=True, capture_output=True)
    if completed.returncode != 0:
        raise RuntimeError(f"Registry maintenance failed: {completed.stderr.strip() or completed.stdout.strip()}")
    return json.loads(completed.stdout)


def registry_reset_code(options: Options) -> str:
    return f"""
from __future__ import annotations

import json

from sqlalchemy import select

from app.audit import add_audit_event
from app.database import SessionLocal
from app.models import AuditEvent, Document, WorkflowTask

ACTOR_ID = {options.actor_id!r}

with SessionLocal() as db:
    documents = list(db.execute(select(Document)).scalars())
    document_ids = {{document.document_id for document in documents}}
    version_ids = {{version.document_version_id for document in documents for version in document.versions}}
    file_ids = {{file.file_id for document in documents for file in document.files}}
    external_ids = {{ref.external_document_id for document in documents for ref in document.external_refs}}
    audit_delete_ids = []
    for event in list(db.execute(select(AuditEvent)).scalars()):
        metadata = event.event_metadata or {{}}
        if (
            event.resource_id in document_ids
            or event.resource_id in version_ids
            or event.resource_id in file_ids
            or event.resource_id in external_ids
            or metadata.get("document_id") in document_ids
            or metadata.get("document_version_id") in version_ids
        ):
            audit_delete_ids.append(event.audit_event_id)
    tasks = list(db.execute(select(WorkflowTask)).scalars())
    deleted_tasks = 0
    for task in tasks:
        if task.document_id in document_ids or task.audit_event_id in audit_delete_ids:
            db.delete(task)
            deleted_tasks += 1
    deleted_documents = len(documents)
    for document in documents:
        db.delete(document)
    deleted_audits = 0
    for event in list(db.execute(select(AuditEvent).where(AuditEvent.audit_event_id.in_(audit_delete_ids))).scalars()):
        db.delete(event)
        deleted_audits += 1
    add_audit_event(
        db,
        actor_id=ACTOR_ID,
        event_type="document_corpus.reset",
        resource_type="document_corpus",
        resource_id="akb-document-corpus",
        severity="warning",
        metadata={{
            "delete_mode": "development_pdf_first_reset",
            "deleted_documents": deleted_documents,
            "deleted_versions": len(version_ids),
            "deleted_files": len(file_ids),
            "deleted_external_refs": len(external_ids),
            "deleted_workflow_tasks": deleted_tasks,
            "deleted_audit_events": deleted_audits,
        }},
    )
    db.commit()
    print(json.dumps({{
        "deleted_documents": deleted_documents,
        "deleted_versions": len(version_ids),
        "deleted_files": len(file_ids),
        "deleted_external_refs": len(external_ids),
        "deleted_workflow_tasks": deleted_tasks,
        "deleted_audit_events": deleted_audits,
    }}, ensure_ascii=False, indent=2))
"""


def registry_create_code(plan: list[dict[str, Any]], options: Options) -> str:
    plan_b64 = b64_json(plan)
    return f"""
from __future__ import annotations

import base64
import datetime as dt
import json

from app.audit import add_audit_event
from app.database import SessionLocal
from app.models import (
    Document,
    DocumentAccessPolicy,
    DocumentAssignment,
    DocumentFile,
    DocumentVersion,
    make_id,
    utcnow,
)

PLAN = json.loads(base64.b64decode({plan_b64!r}).decode("utf-8"))
ACTOR_ID = {options.actor_id!r}
OWNER_ID = {options.owner_id!r}

def version_label(item):
    digest = item["sha256"].split(":", 1)[1][:10]
    return f"pdf-first-{{dt.datetime.now(dt.UTC).strftime('%Y%m%dT%H%M%SZ')}}-{{digest}}"

def access_policies(document_id, owner_id, classification):
    constraints = {{"classification_max": classification}}
    return [
        DocumentAccessPolicy(
            document_id=document_id,
            subjects=[f"user:{{owner_id}}", "role:admin", "role:document_manager", "role:service_ingestion", "role:service_rag", "role:stratos_service"],
            actions=[
                "document.read",
                "document.update",
                "document.version.create",
                "document.version.publish",
                "document.version.archive",
                "document.ingest",
                "document.reindex",
                "rag.query",
            ],
            constraints=constraints,
        ),
        DocumentAccessPolicy(
            document_id=document_id,
            subjects=["role:reader"],
            actions=["document.read", "rag.query"],
            constraints=constraints,
        ),
    ]

def assignments(document_id, owner_id, domain):
    return [
        DocumentAssignment(
            document_id=document_id,
            role="owner",
            subject_type="user",
            subject_id=owner_id,
            display_label=owner_id,
            is_primary=True,
            active=True,
            sla_days=5,
            assigned_by=ACTOR_ID,
            assignment_metadata={{"source": "pdf_first_corpus_reset"}},
        ),
        DocumentAssignment(
            document_id=document_id,
            role="gestor",
            subject_type="unit",
            subject_id=domain,
            display_label=domain,
            is_primary=True,
            active=True,
            sla_days=5,
            assigned_by=ACTOR_ID,
            assignment_metadata={{"source": "pdf_first_corpus_reset"}},
        ),
    ]

created = []
errors = []
today = dt.date.today()
now = utcnow()

with SessionLocal() as db:
    for item in PLAN:
        try:
            document_id = make_id("doc")
            version_id = make_id("ver")
            label = version_label(item)
            metadata = {{
                "source_path": item["source_path"],
                "source_system": "akb_pdf_first_import",
                "source_kind": item["source_kind"],
                "language": item.get("language", "cs"),
                "domain": item["domain"],
                "canonical_url": item.get("canonical_url"),
                "source_pdf_url": item.get("source_pdf_url"),
                "summary": item.get("summary"),
                "original_source_file_uri": item["source_file_uri"] if item["source_kind"] == "pdf" else None,
                "text_derivative_path": item["source_path"],
                "content_sha256": item["sha256"],
                "importer": "tools/reset_pdf_first_corpus.py",
                "imported_at": now.isoformat().replace("+00:00", "Z"),
            }}
            metadata = {{key: value for key, value in metadata.items() if value is not None}}
            document = Document(
                document_id=document_id,
                title=item["title"],
                document_type=item["document_type"],
                status="draft",
                classification=item["classification"],
                owner_id=OWNER_ID,
                gestor_unit=item["domain"],
                tags=item.get("tags") or [],
                document_metadata=metadata,
            )
            db.add(document)
            db.flush()
            for policy in access_policies(document_id, OWNER_ID, item["classification"]):
                db.add(policy)
            for assignment in assignments(document_id, OWNER_ID, item["domain"]):
                db.add(assignment)
            version = DocumentVersion(
                document_version_id=version_id,
                document_id=document_id,
                version_label=label,
                status="draft",
                valid_from=today,
                valid_to=None,
                source_file_uri=item["source_file_uri"],
                file_hash=item["sha256"],
                change_summary=f"PDF-first corpus import from {{item['source_path']}}",
            )
            db.add(version)
            db.flush()
            db.add(DocumentFile(
                document_id=document_id,
                document_version_id=version_id,
                uri=item["source_file_uri"],
                filename=item["filename"],
                mime_type=item["mime_type"],
                size_bytes=item["size_bytes"],
                sha256=item["sha256"],
                uploaded_by=ACTOR_ID,
            ))
            add_audit_event(
                db,
                actor_id=ACTOR_ID,
                event_type="document.pdf_first_import.created",
                resource_type="document",
                resource_id=document_id,
                metadata={{
                    "document_version_id": version_id,
                    "source_file_uri": item["source_file_uri"],
                    "source_kind": item["source_kind"],
                    "source_path": item["source_path"],
                }},
            )
            created.append({{**item, "document_id": document_id, "document_version_id": version_id, "version_label": label}})
        except Exception as exc:
            db.rollback()
            errors.append({{"source_path": item.get("source_path"), "code": exc.__class__.__name__, "message": str(exc)}})
            raise
    db.commit()

print(json.dumps({{"documents": created, "errors": errors}}, ensure_ascii=False, indent=2))
"""


def registry_publish_code(documents: list[dict[str, Any]], options: Options) -> str:
    documents_b64 = b64_json(documents)
    return f"""
from __future__ import annotations

import base64
import json

from app.audit import add_audit_event
from app.database import SessionLocal
from app.models import Document, DocumentVersion, utcnow

DOCUMENTS = json.loads(base64.b64decode({documents_b64!r}).decode("utf-8"))
ACTOR_ID = {options.actor_id!r}

published = []
errors = []

with SessionLocal() as db:
    for item in DOCUMENTS:
        try:
            document = db.get(Document, item["document_id"])
            version = db.get(DocumentVersion, item["document_version_id"])
            if document is None or version is None:
                errors.append({{"source_path": item.get("source_path"), "code": "REGISTRY_ROW_MISSING", "message": "Document or version is missing"}})
                continue
            metadata = dict(document.document_metadata or {{}})
            metadata.update({{
                "ingestion_job_id": item.get("ingestion_job_id"),
                "ingestion_status": item.get("ingestion_status"),
                "chunks_created": item.get("chunks_created", 0),
                "qdrant_points": item.get("qdrant_points", 0),
                "published_by_import": item.get("ingestion_status") in ["completed", "completed_with_warnings"],
                "published_at": utcnow().isoformat().replace("+00:00", "Z"),
            }})
            document.document_metadata = metadata
            if item.get("ingestion_status") in ["completed", "completed_with_warnings"] and int(item.get("chunks_created") or 0) > 0:
                version.status = "valid"
                version.published_at = utcnow()
                document.status = "valid"
                event_type = "document.pdf_first_import.published"
                severity = "info"
                item["status"] = "published"
            else:
                version.status = "archived"
                document.status = "archived"
                event_type = "document.pdf_first_import.failed"
                severity = "warning"
                item["status"] = "archived"
            add_audit_event(
                db,
                actor_id=ACTOR_ID,
                event_type=event_type,
                resource_type="document_version",
                resource_id=version.document_version_id,
                severity=severity,
                metadata={{
                    "document_id": document.document_id,
                    "source_file_uri": version.source_file_uri,
                    "source_path": item.get("source_path"),
                    "ingestion_job_id": item.get("ingestion_job_id"),
                    "ingestion_status": item.get("ingestion_status"),
                    "chunks_created": item.get("chunks_created", 0),
                    "errors": item.get("errors", []),
                }},
            )
            published.append(item)
        except Exception as exc:
            db.rollback()
            errors.append({{"source_path": item.get("source_path"), "code": exc.__class__.__name__, "message": str(exc)}})
            raise
    db.commit()

print(json.dumps({{"documents": published, "errors": errors}}, ensure_ascii=False, indent=2))
"""


def reset_storage_and_copy(plan: list[dict[str, Any]], options: Options) -> dict[str, Any]:
    result: dict[str, Any] = {"cleared_bucket": options.bucket, "copied_objects": 0, "errors": []}
    bucket_root = options.storage_root / options.bucket
    try:
        if bucket_root.exists():
            for child in bucket_root.iterdir():
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()
        bucket_root.mkdir(parents=True, exist_ok=True)
    except PermissionError:
        clear_storage_via_container(options)

    for item in plan:
        if item.get("status") != "planned":
            continue
        source = Path(item["source_file_path"])
        target = options.storage_root / options.bucket / item["object_key"]
        try:
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
            except PermissionError:
                copy_object_via_container(source, item["object_key"], options)
            result["copied_objects"] += 1
        except Exception as exc:
            result["errors"].append(
                {
                    "source_path": item.get("source_path"),
                    "code": exc.__class__.__name__,
                    "message": str(exc),
                }
            )
    return result


def clear_storage_via_container(options: Options) -> None:
    bucket_path = options.storage_container_root / options.bucket
    script = (
        "set -eu\n"
        f"mkdir -p -- {shlex.quote(str(bucket_path))}\n"
        f"find {shlex.quote(str(bucket_path))} -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} +\n"
    )
    command = compose_command(options)
    command.extend(["exec", "-T", options.storage_writer_service, "sh", "-lc", script])
    completed = subprocess.run(command, text=True, capture_output=True)
    if completed.returncode != 0:
        raise RuntimeError(f"Container storage clear failed: {completed.stderr.strip() or completed.stdout.strip()}")


def copy_object_via_container(source: Path, object_key: str, options: Options) -> None:
    target = options.storage_container_root / options.bucket / object_key
    script = (
        "set -eu\n"
        f"mkdir -p -- {shlex.quote(str(target.parent))}\n"
        f"tmp={shlex.quote(str(target))}.tmp.$$\n"
        'cat > "$tmp"\n'
        'chmod 0644 "$tmp"\n'
        'chown 100:101 "$tmp" 2>/dev/null || true\n'
        f"mv \"$tmp\" {shlex.quote(str(target))}\n"
    )
    command = compose_command(options)
    command.extend(["exec", "-T", options.storage_writer_service, "sh", "-lc", script])
    completed = subprocess.run(command, input=source.read_bytes(), capture_output=True)
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace").strip()
        stdout = completed.stdout.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Container object copy failed for {object_key}: {stderr or stdout}")


def reset_qdrant_collection(options: Options) -> dict[str, Any]:
    code = f"""
import json
import urllib.error
import urllib.request

from app.config import load_settings

s = load_settings()
url = s.qdrant_base_url.rstrip("/") + "/collections/" + {options.qdrant_collection!r}
headers = {{"Accept": "application/json"}}
if s.qdrant_api_key:
    headers["api-key"] = s.qdrant_api_key
request = urllib.request.Request(url, method="DELETE", headers=headers)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        status = response.status
        body = response.read().decode("utf-8")
except urllib.error.HTTPError as exc:
    status = exc.code
    body = exc.read().decode("utf-8")
if status not in (200, 202, 404):
    raise SystemExit("Qdrant delete failed with HTTP %s: %s" % (status, body))
print(json.dumps({{"collection": {options.qdrant_collection!r}, "delete_status": status}}, indent=2))
"""
    return run_ingestion_code(code, options)


def reset_ingestion_job_store(options: Options) -> dict[str, Any]:
    code = """
import json

from app.config import load_settings

s = load_settings()
count = 0
s.job_store_path.mkdir(parents=True, exist_ok=True)
for path in s.job_store_path.glob("ing_*.json"):
    path.unlink()
    count += 1
print(json.dumps({"job_store_path": str(s.job_store_path), "deleted_jobs": count}, indent=2))
"""
    return run_ingestion_code(code, options)


def resolve_llm_gateway_bearer_token(options: Options) -> str | None:
    configured = os.environ.get("AKL_IMPORT_LLM_GATEWAY_BEARER_TOKEN")
    if configured:
        return configured
    result = run_registry_code(registry_fetch_keycloak_token_code(), options)
    token = result.get("access_token")
    return token if isinstance(token, str) and token else None


def registry_fetch_keycloak_token_code() -> str:
    return """
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

base = os.environ.get("AKL_KEYCLOAK_ADMIN_BASE_URL")
realm = os.environ.get("AKL_KEYCLOAK_REALM", "stratos")
client_id = os.environ.get("STRATOS_KEYCLOAK_DIRECTORY_CLIENT_ID")
client_secret = os.environ.get("STRATOS_KEYCLOAK_DIRECTORY_CLIENT_SECRET")

if not base or not client_id or not client_secret:
    print(json.dumps({"access_token": None, "available": False}))
    raise SystemExit(0)

url = f"{base.rstrip('/')}/realms/{realm}/protocol/openid-connect/token"
payload = urllib.parse.urlencode(
    {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    }
).encode("utf-8")
request = urllib.request.Request(
    url,
    data=payload,
    method="POST",
    headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
)
with urllib.request.urlopen(request, timeout=20) as response:
    body = json.loads(response.read().decode("utf-8"))
print(json.dumps({"access_token": body.get("access_token"), "available": bool(body.get("access_token"))}))
"""


def run_maintenance_ingestion(
    documents: list[dict[str, Any]],
    options: Options,
    *,
    llm_gateway_bearer_token: str | None,
) -> dict[str, Any]:
    code = ingestion_maintenance_code(
        documents,
        options,
        llm_gateway_bearer_token=llm_gateway_bearer_token,
    )
    return run_ingestion_code(code, options, timeout=options.timeout_seconds + 60)


def ingestion_maintenance_code(
    documents: list[dict[str, Any]],
    options: Options,
    *,
    llm_gateway_bearer_token: str | None,
) -> str:
    documents_b64 = b64_json(documents)
    return f"""
from __future__ import annotations

import asyncio
import base64
import json
import urllib.error
import urllib.request

from app.config import load_settings
from app.ids import make_id, utcnow
from app.object_storage import ObjectStorageClient
from app.pipeline import IngestionPipeline
from app.schemas import (
    Classification,
    DocumentMetadata,
    IngestionJobCreate,
    IngestionJobResponse,
    JobStatus,
    StoredJob,
)
from app.security import AuthContext
from app.store import JobStore
from chunkers.logical import LogicalStructureChunker
from embeddings.client import EmbeddingClient
from indexers.qdrant import QdrantIndexer
from parsers.router import ParserRouter

DOCUMENTS = json.loads(base64.b64decode({documents_b64!r}).decode("utf-8"))
ACTOR_ID = {options.actor_id!r}
ROLES = tuple(role.strip() for role in {options.roles!r}.split(",") if role.strip())
LLM_GATEWAY_BEARER_TOKEN = {llm_gateway_bearer_token!r}

class StaticRegistry:
    def __init__(self, documents):
        self.by_version = {{item["document_version_id"]: item for item in documents}}

    async def readiness(self):
        return "maintenance"

    async def require_authorized(self, **kwargs):
        return None

    async def get_document_metadata(self, document_id, document_version_id, *, auth_context=None):
        item = self.by_version[document_version_id]
        return DocumentMetadata(
            document_id=document_id,
            document_version_id=document_version_id,
            title=item.get("title"),
            version_label=item.get("version_label"),
            document_type=item.get("document_type"),
            status="valid",
            tags=item.get("tags") or [],
            classification=Classification(item.get("classification") or "internal"),
            access_scope=[
                "role:admin",
                "role:document_manager",
                "role:reader",
                "role:service_rag",
                "role:stratos_service",
            ],
        )

    async def write_audit_event(self, **kwargs):
        return None

def qdrant_count(settings, document_version_id):
    payload = {{
        "filter": {{"must": [{{"key": "document_version_id", "match": {{"value": document_version_id}}}}]}},
        "exact": True,
    }}
    headers = {{"Accept": "application/json", "Content-Type": "application/json"}}
    if settings.qdrant_api_key:
        headers["api-key"] = settings.qdrant_api_key
    request = urllib.request.Request(
        settings.qdrant_base_url.rstrip("/") + "/collections/" + settings.qdrant_collection + "/points/count",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
            return int(body.get("result", {{}}).get("count", 0))
    except Exception:
        return 0

async def main():
    settings = load_settings()
    store = JobStore(settings.job_store_path)
    registry = StaticRegistry(DOCUMENTS)
    pipeline = IngestionPipeline(
        store=store,
        registry=registry,
        object_storage=ObjectStorageClient(settings),
        parser_router=ParserRouter(settings),
        chunker=LogicalStructureChunker(settings),
        embedding_client=EmbeddingClient(settings),
        indexer=QdrantIndexer(settings),
    )
    auth_context = AuthContext(subject_id=ACTOR_ID, roles=ROLES, groups=(), bearer_token=LLM_GATEWAY_BEARER_TOKEN)
    results = []
    errors = []
    for item in DOCUMENTS:
        request = IngestionJobCreate(
            document_id=item["document_id"],
            document_version_id=item["document_version_id"],
            source_file_uri=item["source_file_uri"],
            parser_profile="controlled_document",
            ocr_enabled=True,
            chunking_strategy="legal_structured",
            embedding_profile="default",
        )
        job = IngestionJobResponse(
            job_id=make_id("ing"),
            status=JobStatus.queued,
            document_id=request.document_id,
            document_version_id=request.document_version_id,
            source_file_uri=request.source_file_uri,
            parser_profile=request.parser_profile,
            ocr_enabled=request.ocr_enabled,
            chunking_strategy=request.chunking_strategy,
            embedding_profile=request.embedding_profile,
            created_at=utcnow(),
        )
        try:
            stored = store.create(StoredJob(request=request, job=job))
            finished = await pipeline.run(stored, subject_id=ACTOR_ID, auth_context=auth_context)
            report = finished.report
            status = report.status.value if report else finished.job.status.value
            updated = {{
                **item,
                "ingestion_job_id": finished.job.job_id,
                "ingestion_status": status,
                "chunks_created": report.chunks_created if report else 0,
                "qdrant_points": qdrant_count(settings, item["document_version_id"]),
                "pages_processed": report.pages_processed if report else 0,
                "tables_detected": report.tables_detected if report else 0,
                "ocr_used": report.ocr_used if report else False,
                "warnings": [message.model_dump(mode="json") for message in report.warnings] if report else [],
                "errors": [message.model_dump(mode="json") for message in report.errors] if report else [],
            }}
            results.append(updated)
            if status not in {sorted(TERMINAL_OK)!r} or int(updated["chunks_created"]) < 1:
                errors.append({{"source_path": item.get("source_path"), "code": "INGESTION_FAILED", "message": json.dumps(updated.get("errors") or [])}})
        except Exception as exc:
            updated = {{
                **item,
                "ingestion_job_id": job.job_id,
                "ingestion_status": "failed",
                "chunks_created": 0,
                "errors": [{{"code": exc.__class__.__name__, "message": str(exc)}}],
            }}
            results.append(updated)
            errors.append({{"source_path": item.get("source_path"), "code": exc.__class__.__name__, "message": str(exc)}})
    print(json.dumps({{"documents": results, "errors": errors}}, ensure_ascii=False, indent=2))

asyncio.run(main())
"""


def run_ingestion_code(code: str, options: Options, *, timeout: int = 120) -> dict[str, Any]:
    command = compose_command(options)
    command.extend(["exec", "-T", options.ingestion_service, "python", "-"])
    completed = subprocess.run(command, input=code, text=True, capture_output=True, timeout=timeout)
    if completed.returncode != 0:
        raise RuntimeError(f"Ingestion maintenance failed: {completed.stderr.strip() or completed.stdout.strip()}")
    return json.loads(completed.stdout)


def qdrant_count(version_id: str, options: Options) -> int:
    code = f"""
import json
import urllib.request

from app.config import load_settings

s = load_settings()
payload = {{
    "filter": {{"must": [{{"key": "document_version_id", "match": {{"value": {version_id!r}}}}}]}},
    "exact": True,
}}
headers = {{"Accept": "application/json", "Content-Type": "application/json"}}
if s.qdrant_api_key:
    headers["api-key"] = s.qdrant_api_key
request = urllib.request.Request(
    s.qdrant_base_url.rstrip("/") + "/collections/" + {options.qdrant_collection!r} + "/points/count",
    data=json.dumps(payload).encode("utf-8"),
    method="POST",
    headers=headers,
)
with urllib.request.urlopen(request, timeout=30) as response:
    body = json.loads(response.read().decode("utf-8"))
print(json.dumps({{"count": int(body.get("result", {{}}).get("count", 0))}}))
"""
    result = run_ingestion_code(code, options)
    return int(result["count"])


def compose_command(options: Options) -> list[str]:
    command = ["docker", "compose"]
    if options.env_file:
        command.extend(["--env-file", str(options.env_file)])
    command.extend(["-f", str(options.compose_file)])
    return command


def b64_json(value: Any) -> str:
    return base64.b64encode(json.dumps(value, ensure_ascii=False).encode("utf-8")).decode("ascii")


def plan_totals(plan: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "found_markdown_derivatives": len(plan),
        "planned_documents": sum(1 for item in plan if item.get("status") == "planned"),
        "planned_pdf_documents": sum(1 for item in plan if item.get("source_kind") == "pdf"),
        "planned_markdown_fallback_documents": sum(1 for item in plan if item.get("source_kind") == "markdown_fallback"),
        "missing_pdf_sources": sum(1 for item in plan if item.get("status") == "missing_pdf_source"),
    }


def final_totals(report: dict[str, Any]) -> dict[str, int]:
    totals = dict(report.get("totals") or {})
    ingestion_docs = report.get("ingestion", {}).get("documents") or []
    published_docs = report.get("published", {}).get("documents") or []
    totals.update(
        {
            "created_documents": len(report.get("created", {}).get("documents") or []),
            "ingested_documents": sum(1 for item in ingestion_docs if item.get("ingestion_status") in TERMINAL_OK),
            "published_documents": sum(1 for item in published_docs if item.get("status") == "published"),
            "failed_documents": len(report.get("errors") or []),
            "chunks_created": sum(int(item.get("chunks_created") or 0) for item in ingestion_docs),
        }
    )
    return totals


def write_reports(report: dict[str, Any], json_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_path = json_path.with_suffix(".md")
    markdown_path.write_text(render_markdown_report(report), encoding="utf-8")


def render_markdown_report(report: dict[str, Any]) -> str:
    totals = report["totals"]
    lines = [
        "# PDF-first Corpus Reset Report",
        "",
        f"- generated_at: `{report['generated_at']}`",
        f"- mode: `{report['mode']}`",
        f"- planned_documents: `{totals.get('planned_documents', 0)}`",
        f"- planned_pdf_documents: `{totals.get('planned_pdf_documents', 0)}`",
        f"- missing_pdf_sources: `{totals.get('missing_pdf_sources', 0)}`",
        f"- created_documents: `{totals.get('created_documents', 0)}`",
        f"- ingested_documents: `{totals.get('ingested_documents', 0)}`",
        f"- published_documents: `{totals.get('published_documents', 0)}`",
        f"- chunks_created: `{totals.get('chunks_created', 0)}`",
        f"- errors: `{len(report.get('errors') or [])}`",
        "",
        "## Documents",
        "",
        "| Domain | Source | Kind | Status | Title | Chunks | URI |",
        "|---|---|---:|---:|---|---:|---|",
    ]
    documents = report.get("published", {}).get("documents") or report.get("ingestion", {}).get("documents") or report["documents"]
    for item in documents:
        title = str(item.get("title") or "").replace("|", "\\|")
        lines.append(
            "| "
            f"{item.get('domain', '')} | "
            f"`{item.get('source_path', '')}` | "
            f"{item.get('source_kind', '')} | "
            f"{item.get('status') or item.get('ingestion_status') or ''} | "
            f"{title} | "
            f"{item.get('chunks_created', 0) or 0} | "
            f"`{item.get('source_file_uri', '')}` |"
        )
    missing = [item for item in report["documents"] if item.get("status") == "missing_pdf_source"]
    if missing:
        lines.extend(["", "## Missing PDF Sources", ""])
        for item in missing:
            lines.append(f"- `{item['domain']}/{item['source_path']}` - {item.get('title')}")
    if report.get("errors"):
        lines.extend(["", "## Errors", ""])
        for error in report["errors"]:
            lines.append(f"- `{error.get('source_path', '')}`: {error.get('code')} - {error.get('message')}")
    lines.append("")
    return "\n".join(lines)


def print_summary(report: dict[str, Any]) -> None:
    totals = report["totals"]
    print("PDF-first corpus reset")
    print(f"mode={report['mode']}")
    print(f"planned_documents={totals.get('planned_documents', 0)}")
    print(f"planned_pdf_documents={totals.get('planned_pdf_documents', 0)}")
    print(f"missing_pdf_sources={totals.get('missing_pdf_sources', 0)}")
    print(f"created_documents={totals.get('created_documents', 0)}")
    print(f"ingested_documents={totals.get('ingested_documents', 0)}")
    print(f"published_documents={totals.get('published_documents', 0)}")
    print(f"chunks_created={totals.get('chunks_created', 0)}")
    print(f"errors={len(report.get('errors') or [])}")
    print(f"report={report.get('report_path', '') or ''}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
