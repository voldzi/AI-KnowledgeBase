#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONFIRMATION = "RESET-AKB-EPOCH"


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)
    before = inventory(options)
    report: dict[str, Any] = {
        "schema_version": "akb-epoch-reset-report-1",
        "generated_at": now(),
        "mode": "apply" if options.apply else "dry-run",
        "before": before,
        "actions": [],
        "errors": [],
    }
    if not options.apply:
        write_report(options.report, report)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0

    try:
        verify_apply_guard(options)
        report["backup_manifest"] = verified_manifest_summary(options.backup_manifest)
        report["actions"].append(reset_registry(options))
        report["actions"].append(clear_object_storage(options))
        report["actions"].append(delete_http_resource(options, "qdrant", options.qdrant_url))
        report["actions"].append(delete_http_resource(options, "opensearch", options.opensearch_url))
        report["actions"].append(clear_service_path(options, options.ingestion_service, "/data/ingestion-jobs"))
        report["actions"].append(clear_service_path(options, options.evaluation_service, "/data/evaluation-datasets"))
        report["actions"].append(clear_service_path(options, options.evaluation_service, "/data/evaluation-reports"))
        report["after"] = inventory(options)
        assert_zero_state(report["after"])
        report["verified_at"] = now()
    except Exception as exc:
        report["errors"].append({"code": exc.__class__.__name__, "message": str(exc)})

    write_report(options.report, report)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 1 if report["errors"] else 0


def parse_args(argv: list[str] | None):
    parser = argparse.ArgumentParser(description="Guarded full AKB data epoch reset. Dry-run is the default.")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm")
    parser.add_argument("--backup-manifest", type=Path)
    parser.add_argument("--report", type=Path, default=ROOT / "reports/akb_epoch_reset_report.json")
    parser.add_argument("--compose-file", type=Path, default=ROOT / "infra/docker-compose/docker-compose.docker-home.yml")
    parser.add_argument("--env-file", type=Path, default=Path("/srv/akl/env/akl.prod.env"))
    parser.add_argument("--registry-service", default="registry-api")
    parser.add_argument("--ingestion-service", default="ingestion-service")
    parser.add_argument("--evaluation-service", default="evaluation-service")
    parser.add_argument("--object-storage-root", type=Path, default=Path("/srv/seaweedfs/akl"))
    parser.add_argument("--bucket", default="akl-documents")
    parser.add_argument("--qdrant-url", default="http://qdrant:6333/collections/akl_document_chunks")
    parser.add_argument("--opensearch-url", default="http://opensearch:9200/akl_document_chunks")
    return parser.parse_args(argv)


def verify_apply_guard(options) -> None:
    if options.confirm != CONFIRMATION:
        raise RuntimeError(f"Apply requires --confirm {CONFIRMATION}")
    if options.backup_manifest is None or not options.backup_manifest.is_file():
        raise RuntimeError("Apply requires --backup-manifest pointing to a verified manifest")
    manifest = json.loads(options.backup_manifest.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != "akb-backup-verification-1":
        raise RuntimeError("Backup manifest schema_version is not supported")
    if manifest.get("backup_verified") is not True or manifest.get("isolated_restore_tested") is not True:
        raise RuntimeError("Backup manifest must confirm backup verification and isolated restore")
    if not isinstance(manifest.get("backup_sha256"), str) or not re.fullmatch(
        r"[a-f0-9]{64}", manifest["backup_sha256"]
    ):
        raise RuntimeError("Backup manifest must contain a SHA-256 digest")


def verified_manifest_summary(path: Path | None) -> dict[str, Any]:
    assert path is not None
    manifest = json.loads(path.read_text(encoding="utf-8"))
    return {
        "path": str(path),
        "backup_id": manifest.get("backup_id"),
        "backup_sha256": manifest.get("backup_sha256"),
        "backup_verified": True,
        "isolated_restore_tested": True,
    }


def inventory(options) -> dict[str, Any]:
    bucket = safe_bucket_path(options.object_storage_root, options.bucket)
    return {
        "registry": registry_inventory(options),
        "object_storage": directory_inventory(bucket),
        "qdrant": http_count(options, options.qdrant_url, kind="qdrant"),
        "opensearch": http_count(options, options.opensearch_url, kind="opensearch"),
        "ingestion_jobs": service_path_count(options, options.ingestion_service, "/data/ingestion-jobs"),
        "evaluation_datasets": service_path_count(options, options.evaluation_service, "/data/evaluation-datasets"),
        "evaluation_reports": service_path_count(options, options.evaluation_service, "/data/evaluation-reports"),
    }


def registry_inventory(options) -> dict[str, Any]:
    code = """
import json
from sqlalchemy import func, select
from app.database import SessionLocal
from app.database import Base
import app.models  # noqa
with SessionLocal() as db:
    counts = {table.name: db.execute(select(func.count()).select_from(table)).scalar_one() for table in Base.metadata.sorted_tables}
    samples = {}
    for name in ("documents", "document_versions", "audit_events"):
        table = Base.metadata.tables.get(name)
        if table is not None:
            primary_key = list(table.primary_key.columns)[0]
            samples[name] = list(db.execute(select(primary_key).limit(5)).scalars())
    print(json.dumps({"counts": counts, "samples": samples}, default=str))
"""
    return run_registry_code(options, code)


def reset_registry(options) -> dict[str, Any]:
    code = """
import json
from sqlalchemy import delete, func, select
from app.database import SessionLocal, Base
import app.models  # noqa
with SessionLocal() as db:
    before = {table.name: db.execute(select(func.count()).select_from(table)).scalar_one() for table in Base.metadata.sorted_tables}
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(delete(table))
    db.commit()
    after = {table.name: db.execute(select(func.count()).select_from(table)).scalar_one() for table in Base.metadata.sorted_tables}
    print(json.dumps({"component": "registry", "before": before, "after": after}))
"""
    return run_registry_code(options, code)


def run_registry_code(options, code: str) -> dict[str, Any]:
    command = compose_command(options) + ["exec", "-T", options.registry_service, "python", "-"]
    completed = subprocess.run(command, input=code, text=True, capture_output=True, timeout=300)
    if completed.returncode != 0:
        raise RuntimeError(f"Registry maintenance failed: {sanitized(completed.stderr or completed.stdout)}")
    return json.loads(completed.stdout)


def clear_object_storage(options) -> dict[str, Any]:
    bucket = safe_bucket_path(options.object_storage_root, options.bucket)
    before = directory_inventory(bucket)
    if bucket.exists():
        for child in bucket.iterdir():
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()
    return {"component": "object_storage", "before": before, "after": directory_inventory(bucket)}


def safe_bucket_path(root: Path, bucket: str) -> Path:
    resolved_root = root.resolve()
    target = (resolved_root / bucket).resolve()
    if target == resolved_root or resolved_root not in target.parents:
        raise RuntimeError("Object-storage bucket path is outside the configured root")
    return target


def delete_http_resource(options, component: str, url: str) -> dict[str, Any]:
    code = f"""
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen
try:
    with urlopen(Request({url!r}, method="DELETE"), timeout=20) as response:
        status = response.status
except HTTPError as exc:
    if exc.code != 404:
        raise
    status = 404
print(json.dumps({{"component": {component!r}, "delete_status": status}}))
"""
    return run_service_python(options, options.ingestion_service, code)


def http_count(options, url: str, *, kind: str) -> dict[str, Any]:
    count_url = f"{url}/points/count" if kind == "qdrant" else f"{url}/_count"
    payload = {} if kind == "qdrant" else {"query": {"match_all": {}}}
    code = f"""
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen
request = Request({count_url!r}, method="POST", data=json.dumps({payload!r}).encode("utf-8"), headers={{"Content-Type": "application/json"}})
try:
    with urlopen(request, timeout=20) as response:
        body = json.loads(response.read())
    count = body.get("result", {{}}).get("count", 0) if {kind!r} == "qdrant" else body.get("count", 0)
    result = {{"exists": True, "count": int(count)}}
except HTTPError as exc:
    if exc.code != 404:
        raise
    result = {{"exists": False, "count": 0}}
print(json.dumps(result))
"""
    return run_service_python(options, options.ingestion_service, code)


def run_service_python(options, service: str, code: str) -> dict[str, Any]:
    command = compose_command(options) + ["exec", "-T", service, "python", "-"]
    completed = subprocess.run(command, input=code, text=True, capture_output=True, timeout=120)
    if completed.returncode != 0:
        raise RuntimeError(f"Maintenance call through {service} failed: {sanitized(completed.stderr or completed.stdout)}")
    return json.loads(completed.stdout)


def clear_service_path(options, service: str, path: str) -> dict[str, Any]:
    before = service_path_count(options, service, path)
    command = compose_command(options) + ["exec", "-T", service, "sh", "-c", f"find {path} -mindepth 1 -delete"]
    completed = subprocess.run(command, text=True, capture_output=True, timeout=120)
    if completed.returncode != 0:
        raise RuntimeError(f"Could not clear {service}:{path}: {sanitized(completed.stderr)}")
    return {"component": f"{service}:{path}", "before": before, "after": service_path_count(options, service, path)}


def service_path_count(options, service: str, path: str) -> dict[str, Any]:
    command = compose_command(options) + ["exec", "-T", service, "sh", "-c", f"find {path} -type f | wc -l"]
    completed = subprocess.run(command, text=True, capture_output=True, timeout=60)
    if completed.returncode != 0:
        return {"available": False, "count": None}
    return {"available": True, "count": int(completed.stdout.strip() or 0)}


def compose_command(options) -> list[str]:
    command = ["docker", "compose"]
    if options.env_file and options.env_file.is_file():
        command += ["--env-file", str(options.env_file)]
    command += ["-f", str(options.compose_file)]
    return command


def directory_inventory(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False, "files": 0, "bytes": 0}
    files = [item for item in path.rglob("*") if item.is_file()]
    return {"exists": True, "files": len(files), "bytes": sum(item.stat().st_size for item in files)}


def assert_zero_state(state: dict[str, Any]) -> None:
    nonzero_tables = {name: count for name, count in state["registry"]["counts"].items() if count}
    failures = {
        "registry": nonzero_tables,
        "object_storage": state["object_storage"].get("files"),
        "qdrant": state["qdrant"].get("count"),
        "opensearch": state["opensearch"].get("count"),
        "ingestion_jobs": state["ingestion_jobs"].get("count"),
        "evaluation_datasets": state["evaluation_datasets"].get("count"),
        "evaluation_reports": state["evaluation_reports"].get("count"),
    }
    unavailable = [
        key
        for key in ("ingestion_jobs", "evaluation_datasets", "evaluation_reports")
        if state[key].get("available") is not True
    ]
    if nonzero_tables or unavailable or any(value not in (0, {}) for key, value in failures.items() if key != "registry"):
        raise RuntimeError(f"AKB reset verification failed: {failures}")


def write_report(path: Path, report: dict[str, Any]) -> None:
    target = path if path.is_absolute() else ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def sanitized(value: str) -> str:
    return " ".join(value.strip().split())[:500]


def now() -> str:
    return dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    sys.exit(main())
