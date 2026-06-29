#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

PROFILE_ID = "stratos-okf-v1"
DEFAULT_TENANT_ID = "stratos"
DEFAULT_SOURCE_SYSTEM = "okf"
DEFAULT_OWNER = "akb-team"
DEFAULT_CLASSIFICATION = "internal"
DEFAULT_STATUS = "valid"
DEFAULT_LANGUAGE = "cs"

DOCUMENT_TYPE_BY_OKF_TYPE = {
    "api": "project_documentation",
    "contract": "contract",
    "contract_summary": "contract",
    "decision": "project_documentation",
    "metric": "project_documentation",
    "policy": "policy",
    "process": "methodology",
    "regulation": "regulation",
    "risk": "project_documentation",
    "runbook": "project_documentation",
    "system": "project_documentation",
}


@dataclass(frozen=True)
class OkfConcept:
    path: Path
    rel_path: str
    frontmatter: dict[str, Any]
    body: str


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "validate":
        report = validate_bundle(resolve_path(args.source))
    elif args.command == "plan-import":
        report = plan_import(resolve_path(args.source))
    elif args.command == "export-from-report":
        report = export_from_import_report(
            report_path=resolve_path(args.import_report),
            output_dir=resolve_path(args.output),
            overwrite=args.overwrite,
        )
    else:
        raise ValueError(f"Unsupported command {args.command!r}")
    write_report(report, resolve_path(args.report) if args.report else None)
    print(json.dumps(summary_for_cli(report), ensure_ascii=False, indent=2))
    return 1 if report.get("errors") else 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate and transform STRATOS Open Knowledge Format bundles for AKB.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate", help="Validate an OKF bundle directory.")
    validate.add_argument("--source", required=True, help="OKF bundle directory.")
    validate.add_argument("--report", default="reports/okf_validate_report.json")

    plan = subparsers.add_parser("plan-import", help="Create a dry-run AKB metadata import plan from an OKF bundle.")
    plan.add_argument("--source", required=True, help="OKF bundle directory.")
    plan.add_argument("--report", default="reports/okf_import_plan.json")

    export = subparsers.add_parser("export-from-report", help="Create an OKF bundle from an AKB docs import report.")
    export.add_argument("--import-report", required=True, help="Existing import_docs_folder JSON report.")
    export.add_argument("--output", required=True, help="Target OKF bundle directory.")
    export.add_argument("--overwrite", action="store_true", help="Replace existing target files.")
    export.add_argument("--report", default="reports/okf_export_report.json")
    return parser.parse_args(argv)


def resolve_path(value: str | Path) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (ROOT / path).resolve()


def validate_bundle(source: Path) -> dict[str, Any]:
    started = utc_now()
    concepts: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for index, path in enumerate(discover_markdown_files(source), start=1):
        rel_path = path.relative_to(source).as_posix()
        try:
            concept = read_okf_concept(path, source)
            concept_errors = validate_concept(concept)
            if concept_errors:
                errors.extend(concept_errors)
            concepts.append(concept_report_item(index, concept, concept_errors))
        except Exception as exc:
            errors.append({"source_path": rel_path, "code": exc.__class__.__name__, "message": str(exc)})
            concepts.append({
                "index": index,
                "source_path": rel_path,
                "status": "invalid",
                "type": None,
                "title": None,
                "errors": [errors[-1]],
            })
    finished = utc_now()
    return base_report("okf_validate", source, started, finished, concepts, errors)


def plan_import(source: Path) -> dict[str, Any]:
    validation = validate_bundle(source)
    plans: list[dict[str, Any]] = []
    errors = list(validation["errors"])
    for item in validation["concepts"]:
        if item["status"] != "valid":
            plans.append({**item, "metadata": None})
            continue
        concept = read_okf_concept(source / item["source_path"], source)
        metadata = akb_metadata_from_okf(concept.frontmatter, concept.rel_path)
        plans.append({**item, "metadata": metadata})
    return {
        **validation,
        "kind": "okf_import_plan",
        "errors": errors,
        "concepts": plans,
    }


def export_from_import_report(report_path: Path, output_dir: Path, overwrite: bool = False) -> dict[str, Any]:
    if not report_path.exists():
        raise FileNotFoundError(f"Import report not found: {report_path}")
    if output_dir.exists() and any(output_dir.iterdir()) and not overwrite:
        raise FileExistsError(f"Output directory is not empty: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    source_root = source_root_from_import_report(report_path)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    documents = report.get("documents") if isinstance(report.get("documents"), list) else []
    concepts: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    started = utc_now()
    for index, document in enumerate(documents, start=1):
        if not isinstance(document, dict):
            continue
        source_path = str(document.get("source_path") or "").strip()
        if not source_path:
            continue
        try:
            target_rel = normalized_markdown_path(source_path)
            target_path = output_dir / target_rel
            target_path.parent.mkdir(parents=True, exist_ok=True)
            source_path_abs = source_root / source_path
            body = source_path_abs.read_text(encoding="utf-8", errors="replace") if source_path_abs.exists() else f"# {document.get('title') or target_path.stem}\n"
            frontmatter = okf_frontmatter_from_import_item(document)
            target_path.write_text(render_okf_markdown(frontmatter, strip_existing_frontmatter(body)), encoding="utf-8")
            concepts.append({
                "index": index,
                "source_path": target_rel,
                "status": "exported",
                "type": frontmatter["type"],
                "title": frontmatter.get("title"),
            })
        except Exception as exc:
            rel = source_path or f"document-{index}"
            error = {"source_path": rel, "code": exc.__class__.__name__, "message": str(exc)}
            errors.append(error)
            concepts.append({"index": index, "source_path": rel, "status": "failed", "errors": [error]})
    manifest = {
        "profile": PROFILE_ID,
        "generated_at": utc_now_iso(),
        "source_import_report": display_path(report_path),
        "concept_count": len([item for item in concepts if item.get("status") == "exported"]),
    }
    (output_dir / "okf-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    finished = utc_now()
    return base_report("okf_export", output_dir, started, finished, concepts, errors)


def discover_markdown_files(source: Path) -> list[Path]:
    if not source.exists() or not source.is_dir():
        raise FileNotFoundError(f"OKF source folder not found: {source}")
    return sorted(path for path in source.rglob("*.md") if path.is_file())


def read_okf_concept(path: Path, source_root: Path | None = None) -> OkfConcept:
    root = source_root or path.parent
    text = path.read_text(encoding="utf-8", errors="replace")
    frontmatter, body = parse_markdown_frontmatter(text)
    return OkfConcept(path=path, rel_path=path.relative_to(root).as_posix(), frontmatter=frontmatter, body=body)


def validate_concept(concept: OkfConcept) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    okf_type = str(concept.frontmatter.get("type") or "").strip()
    if not okf_type:
        errors.append({"source_path": concept.rel_path, "code": "MISSING_TYPE", "message": "OKF concept must define frontmatter field 'type'."})
    title = str(concept.frontmatter.get("title") or "").strip()
    if not title and not markdown_title(concept.body):
        errors.append({"source_path": concept.rel_path, "code": "MISSING_TITLE", "message": "OKF concept should define title or start with a Markdown heading."})
    tags = concept.frontmatter.get("tags")
    if tags is not None and not isinstance(tags, list):
        errors.append({"source_path": concept.rel_path, "code": "INVALID_TAGS", "message": "OKF field 'tags' must be a list."})
    return errors


def parse_markdown_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    normalized = text.replace("\r\n", "\n")
    if not normalized.startswith("---\n"):
        return {}, text
    end = normalized.find("\n---", 4)
    if end < 0:
        raise ValueError("Frontmatter block starts with --- but has no closing --- line.")
    frontmatter_text = normalized[4:end].strip()
    body_start = normalized.find("\n", end + 4)
    body = normalized[body_start + 1:] if body_start >= 0 else ""
    return parse_simple_yaml(frontmatter_text), body


def strip_existing_frontmatter(text: str) -> str:
    frontmatter, body = parse_markdown_frontmatter(text)
    return body if frontmatter else text


def akb_metadata_from_okf(
    frontmatter: dict[str, Any],
    rel_path: str,
    defaults: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base = dict(defaults or {})
    okf_type = str(frontmatter.get("type") or "").strip()
    if not okf_type:
        raise ValueError(f"OKF concept {rel_path} has no required 'type' field.")
    document_type = str(frontmatter.get("document_type") or base.get("document_type") or DOCUMENT_TYPE_BY_OKF_TYPE.get(okf_type, "project_documentation"))
    classification = str(frontmatter.get("classification") or base.get("classification") or DEFAULT_CLASSIFICATION)
    status = str(frontmatter.get("status") or base.get("status") or DEFAULT_STATUS)
    owner = str(frontmatter.get("owner") or frontmatter.get("owner_id") or frontmatter.get("steward") or base.get("owner") or DEFAULT_OWNER)
    area = str(frontmatter.get("area") or frontmatter.get("domain") or base.get("area") or okf_type)
    language = str(frontmatter.get("language") or base.get("language") or DEFAULT_LANGUAGE)
    source_system = str(frontmatter.get("external_system") or frontmatter.get("source_system") or base.get("source_system") or DEFAULT_SOURCE_SYSTEM)
    tags = sorted({
        "okf",
        f"okf-type:{slugify(okf_type)}",
        f"area:{slugify(area)}",
        *(str(tag) for tag in base.get("tags") or []),
        *(str(tag) for tag in frontmatter.get("tags") or []),
    })
    metadata = {
        **base,
        **profile_metadata(frontmatter),
        "document_type": document_type,
        "classification": classification,
        "status": status,
        "owner": owner,
        "area": area,
        "language": language,
        "source_system": source_system,
        "tags": tags,
        "okf_profile": PROFILE_ID,
        "okf_type": okf_type,
        "okf_source_path": rel_path,
    }
    if "tenant_id" not in metadata:
        metadata["tenant_id"] = DEFAULT_TENANT_ID
    return metadata


def profile_metadata(frontmatter: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "akb_document_id",
        "akb_document_version_id",
        "canonical_open_url",
        "domain",
        "entity_id",
        "entity_type",
        "external_ref",
        "external_system",
        "owner",
        "retention_class",
        "source_file_uri",
        "source_uri",
        "steward",
        "tenant_id",
        "title",
    }
    return {key: value for key, value in frontmatter.items() if key in allowed and value not in (None, "")}


def okf_frontmatter_from_import_item(item: dict[str, Any]) -> dict[str, Any]:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    document_type = str(metadata.get("document_type") or "project_documentation")
    okf_type = str(metadata.get("okf_type") or okf_type_for_document_type(document_type, metadata))
    frontmatter: dict[str, Any] = {
        "type": okf_type,
        "title": item.get("title") or metadata.get("title"),
        "tenant_id": metadata.get("tenant_id") or DEFAULT_TENANT_ID,
        "classification": metadata.get("classification") or DEFAULT_CLASSIFICATION,
        "document_type": document_type,
        "status": metadata.get("status") or DEFAULT_STATUS,
        "owner": metadata.get("owner") or DEFAULT_OWNER,
        "language": metadata.get("language") or DEFAULT_LANGUAGE,
        "source_system": metadata.get("source_system") or DEFAULT_SOURCE_SYSTEM,
        "source_uri": item.get("source_file_uri") or metadata.get("source_file_uri") or metadata.get("source_uri"),
        "akb_document_id": item.get("document_id"),
        "akb_document_version_id": item.get("document_version_id"),
        "tags": sorted(str(tag) for tag in metadata.get("tags") or []),
    }
    return {key: value for key, value in frontmatter.items() if value not in (None, "", [])}


def okf_type_for_document_type(document_type: str, metadata: dict[str, Any]) -> str:
    normalized = slugify(document_type)
    if normalized in {"contract", "smlouva"}:
        return "contract_summary"
    if normalized in {"policy", "internal-policy", "politika"}:
        return "policy"
    if normalized in {"regulation", "regulace", "law", "zakon"}:
        return "regulation"
    if normalized in {"methodology", "methodika"}:
        return "process"
    domain = slugify(str(metadata.get("domain") or ""))
    if "api" in domain:
        return "api"
    if "operations" in domain:
        return "runbook"
    return "document"


def render_okf_markdown(frontmatter: dict[str, Any], body: str) -> str:
    return f"---\n{render_simple_yaml(frontmatter)}---\n\n{body.lstrip()}"


def render_simple_yaml(values: dict[str, Any]) -> str:
    lines: list[str] = []
    for key in sorted(values):
        value = values[key]
        if isinstance(value, list):
            lines.append(f"{key}: [{', '.join(yaml_scalar(item) for item in value)}]")
        else:
            lines.append(f"{key}: {yaml_scalar(value)}")
    return "\n".join(lines) + "\n"


def yaml_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    if not text or re.search(r"[:#\\[\\]{},&*!|>'\"%@`\\s]", text):
        return json.dumps(text, ensure_ascii=False)
    return text


def parse_simple_yaml(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    current_key: str | None = None
    current_list: list[Any] | None = None
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        stripped = line.strip()
        if indent == 0:
            key, value = split_yaml_pair(stripped)
            if value == "":
                result[key] = []
                current_key = key
                current_list = result[key]
            else:
                result[key] = parse_scalar(value)
                current_key = None
                current_list = None
            continue
        if current_key and current_list is not None and stripped.startswith("- "):
            current_list.append(parse_scalar(stripped[2:].strip()))
            continue
        raise ValueError(f"Unsupported OKF frontmatter line: {raw_line}")
    return result


def split_yaml_pair(value: str) -> tuple[str, str]:
    if ":" not in value:
        raise ValueError(f"Expected key: value pair in OKF frontmatter line: {value}")
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
        return [strip_quotes(item.strip()) for item in split_inline_list(inner)]
    return strip_quotes(value)


def split_inline_list(value: str) -> list[str]:
    items: list[str] = []
    current: list[str] = []
    quote: str | None = None
    for char in value:
        if quote:
            current.append(char)
            if char == quote:
                quote = None
            continue
        if char in {"'", '"'}:
            quote = char
            current.append(char)
            continue
        if char == ",":
            items.append("".join(current))
            current = []
            continue
        current.append(char)
    items.append("".join(current))
    return items


def strip_quotes(value: str) -> str:
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value


def concept_report_item(index: int, concept: OkfConcept, errors: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "index": index,
        "source_path": concept.rel_path,
        "status": "invalid" if errors else "valid",
        "type": concept.frontmatter.get("type"),
        "title": concept.frontmatter.get("title") or markdown_title(concept.body),
        "errors": errors,
    }


def base_report(kind: str, source: Path, started: dt.datetime, finished: dt.datetime, concepts: list[dict[str, Any]], errors: list[dict[str, str]]) -> dict[str, Any]:
    valid_count = len([item for item in concepts if item.get("status") in {"valid", "exported"}])
    return {
        "kind": kind,
        "profile": PROFILE_ID,
        "generated_at": finished.isoformat().replace("+00:00", "Z"),
        "started_at": started.isoformat().replace("+00:00", "Z"),
        "finished_at": finished.isoformat().replace("+00:00", "Z"),
        "duration_seconds": round((finished - started).total_seconds(), 3),
        "source": display_path(source),
        "totals": {
            "concepts": len(concepts),
            "valid_concepts": valid_count,
            "invalid_concepts": len(concepts) - valid_count,
            "errors": len(errors),
        },
        "concepts": concepts,
        "errors": errors,
    }


def source_root_from_import_report(report_path: Path) -> Path:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    source = str(report.get("source") or ".")
    path = Path(source)
    return path if path.is_absolute() else (ROOT / path)


def normalized_markdown_path(path: str) -> str:
    clean = path.replace("\\", "/").strip("/")
    if not clean.lower().endswith(".md"):
        clean = f"{clean}.md"
    return clean


def markdown_title(body: str) -> str | None:
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
    return None


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def write_report(report: dict[str, Any], path: Path | None) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def summary_for_cli(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": report.get("kind"),
        "profile": report.get("profile"),
        "source": report.get("source"),
        "totals": report.get("totals"),
    }


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def utc_now_iso() -> str:
    return utc_now().isoformat().replace("+00:00", "Z")


def display_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


if __name__ == "__main__":
    raise SystemExit(main())
