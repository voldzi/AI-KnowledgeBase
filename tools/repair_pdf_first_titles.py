#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from reset_pdf_first_corpus import DEFAULT_DOMAINS, ROOT, parse_markdown_metadata


CONFIRMATION = "repair-titles"


@dataclass(frozen=True)
class Options:
    imports_root: Path
    domains: tuple[str, ...]
    report_path: Path
    apply: bool
    confirm: str | None
    compose_file: Path
    env_file: Path | None
    registry_service: str
    actor_id: str


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)
    started = dt.datetime.now(dt.UTC)
    planned = discover_title_plan(options)
    report: dict[str, Any] = {
        "generated_at": started.isoformat().replace("+00:00", "Z"),
        "mode": "apply" if options.apply else "dry-run",
        "imports_root": str(options.imports_root),
        "domains": list(options.domains),
        "report_path": str(options.report_path),
        "planned_titles": planned,
        "totals": {
            "metadata_sources": len(planned),
            "updated_documents": 0,
            "unchanged_documents": 0,
            "missing_documents": 0,
        },
        "errors": [],
    }

    if options.apply:
        if options.confirm != CONFIRMATION:
            report["errors"].append(
                {
                    "code": "CONFIRMATION_REQUIRED",
                    "message": f"Apply mode requires --confirm {CONFIRMATION}",
                }
            )
        else:
            result = apply_title_repairs(planned, options)
            report["result"] = result
            report["totals"].update(result.get("totals") or {})
            report["errors"].extend(result.get("errors") or [])

    report["finished_at"] = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    write_reports(report, options.report_path)
    print_summary(report)
    return 1 if report["errors"] else 0


def parse_args(argv: list[str] | None) -> Options:
    parser = argparse.ArgumentParser(
        description="Repair PDF-first document titles in Registry from source markdown metadata."
    )
    parser.add_argument("--imports-root", default="/srv/akl/imports")
    parser.add_argument("--domain", action="append", dest="domains", help="Domain folder to process. Can be repeated.")
    parser.add_argument("--report", default="reports/pdf_first_title_repair_report.json")
    parser.add_argument("--apply", action="store_true", help="Patch matching Registry documents.")
    parser.add_argument("--confirm", help=f"Required with --apply. Must be {CONFIRMATION!r}.")
    parser.add_argument("--compose-file", default="infra/docker-compose/docker-compose.docker-home.yml")
    parser.add_argument("--env-file", default="/srv/akl/env/akl.prod.env")
    parser.add_argument("--registry-service", default="registry-api")
    parser.add_argument("--actor-id", default="pdf-first-title-repair")
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
        domains=tuple(args.domains or DEFAULT_DOMAINS),
        report_path=report_path,
        apply=bool(args.apply),
        confirm=args.confirm,
        compose_file=compose_file,
        env_file=env_file,
        registry_service=args.registry_service,
        actor_id=args.actor_id,
    )


def discover_title_plan(options: Options) -> list[dict[str, Any]]:
    planned: list[dict[str, Any]] = []
    for domain in options.domains:
        source_root = options.imports_root / domain / "source"
        raw_root = options.imports_root / domain / "raw"
        if not source_root.exists():
            continue
        for markdown_path in sorted(source_root.rglob("*.md")):
            rel_path = markdown_path.relative_to(source_root).as_posix()
            pdf_path = raw_root / f"{markdown_path.stem}.pdf"
            metadata = parse_markdown_metadata(markdown_path, pdf_path=pdf_path if pdf_path.exists() else None)
            planned.append(
                {
                    "domain": domain,
                    "source_path": rel_path,
                    "title": metadata["title"],
                    "title_source": metadata.get("title_source"),
                    "markdown_path": str(markdown_path),
                    "pdf_path": str(pdf_path) if pdf_path.exists() else None,
                }
            )
    return planned


def apply_title_repairs(planned: list[dict[str, Any]], options: Options) -> dict[str, Any]:
    code = f"""
import base64
import datetime as dt
import json

from sqlalchemy import select

from app.audit import add_audit_event
from app.database import SessionLocal
from app.models import Document

PLAN = json.loads(base64.b64decode({b64_json(planned)!r}).decode("utf-8"))
ACTOR_ID = {options.actor_id!r}

planned_by_key = {{
    (item["domain"], item["source_path"]): item
    for item in PLAN
}}
updated = []
unchanged = []
missing = []
errors = []

with SessionLocal() as db:
    documents = db.execute(select(Document)).scalars().all()
    by_key = {{}}
    for document in documents:
        metadata = dict(document.document_metadata or {{}})
        if metadata.get("source_system") != "akb_pdf_first_import":
            continue
        domain = metadata.get("domain")
        source_path = metadata.get("source_path") or metadata.get("text_derivative_path")
        if domain and source_path:
            by_key[(str(domain), str(source_path))] = document

    for key, item in planned_by_key.items():
        document = by_key.get(key)
        if document is None:
            missing.append(item)
            continue
        new_title = str(item.get("title") or "").strip()
        if not new_title or document.title == new_title:
            unchanged.append({{**item, "document_id": document.document_id, "current_title": document.title}})
            continue
        old_title = document.title
        metadata = dict(document.document_metadata or {{}})
        metadata.setdefault("original_import_title", old_title)
        metadata["title_repaired_at"] = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
        metadata["title_repair_source"] = item.get("title_source")
        document.title = new_title[:300]
        document.document_metadata = metadata
        add_audit_event(
            db,
            actor_id=ACTOR_ID,
            event_type="document.title_repaired",
            resource_type="document",
            resource_id=document.document_id,
            metadata={{
                "old_title": old_title,
                "new_title": document.title,
                "domain": item.get("domain"),
                "source_path": item.get("source_path"),
                "title_source": item.get("title_source"),
            }},
        )
        updated.append({{**item, "document_id": document.document_id, "old_title": old_title, "new_title": document.title}})
    db.commit()

print(json.dumps({{
    "updated": updated,
    "unchanged": unchanged,
    "missing": missing,
    "errors": errors,
    "totals": {{
        "updated_documents": len(updated),
        "unchanged_documents": len(unchanged),
        "missing_documents": len(missing),
    }},
}}, ensure_ascii=False, indent=2))
"""
    command = compose_command(options)
    command.extend(["exec", "-T", options.registry_service, "python", "-"])
    completed = subprocess.run(command, input=code, text=True, capture_output=True, timeout=180)
    if completed.returncode != 0:
        raise RuntimeError(f"Registry title repair failed: {completed.stderr.strip() or completed.stdout.strip()}")
    return json.loads(completed.stdout)


def compose_command(options: Options) -> list[str]:
    command = ["docker", "compose"]
    if options.env_file:
        command.extend(["--env-file", str(options.env_file)])
    command.extend(["-f", str(options.compose_file)])
    return command


def b64_json(value: Any) -> str:
    return base64.b64encode(json.dumps(value, ensure_ascii=False).encode("utf-8")).decode("ascii")


def write_reports(report: dict[str, Any], json_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_path = json_path.with_suffix(".md")
    markdown_path.write_text(render_markdown_report(report), encoding="utf-8")


def render_markdown_report(report: dict[str, Any]) -> str:
    totals = report["totals"]
    lines = [
        "# PDF-first Title Repair Report",
        "",
        f"- generated_at: `{report['generated_at']}`",
        f"- mode: `{report['mode']}`",
        f"- metadata_sources: `{totals.get('metadata_sources', 0)}`",
        f"- updated_documents: `{totals.get('updated_documents', 0)}`",
        f"- unchanged_documents: `{totals.get('unchanged_documents', 0)}`",
        f"- missing_documents: `{totals.get('missing_documents', 0)}`",
        f"- errors: `{len(report.get('errors') or [])}`",
        "",
        "## Planned Titles",
        "",
        "| Domain | Source | Title source | Title |",
        "|---|---|---|---|",
    ]
    for item in report.get("planned_titles", []):
        title = str(item.get("title") or "").replace("|", "\\|")
        lines.append(
            f"| {item.get('domain', '')} | `{item.get('source_path', '')}` | "
            f"{item.get('title_source', '')} | {title} |"
        )
    if report.get("result", {}).get("updated"):
        lines.extend(["", "## Updated", ""])
        for item in report["result"]["updated"]:
            lines.append(f"- `{item['document_id']}`: {item['old_title']} -> {item['new_title']}")
    if report.get("errors"):
        lines.extend(["", "## Errors", ""])
        for error in report["errors"]:
            lines.append(f"- {error.get('code')}: {error.get('message')}")
    lines.append("")
    return "\n".join(lines)


def print_summary(report: dict[str, Any]) -> None:
    totals = report["totals"]
    print("PDF-first title repair")
    print(f"mode={report['mode']}")
    print(f"metadata_sources={totals.get('metadata_sources', 0)}")
    print(f"updated_documents={totals.get('updated_documents', 0)}")
    print(f"unchanged_documents={totals.get('unchanged_documents', 0)}")
    print(f"missing_documents={totals.get('missing_documents', 0)}")
    print(f"errors={len(report.get('errors') or [])}")
    print(f"report={report.get('report_path', '') or ''}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
