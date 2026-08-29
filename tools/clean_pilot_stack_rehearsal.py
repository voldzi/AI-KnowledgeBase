#!/usr/bin/env python3
"""Fail-closed preflight for a real, disposable AKB clean-pilot stack."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
from typing import Any

SCHEMA = "akb-clean-pilot-stack-bundle-1"
PROJECT_PREFIX = "akb-cpe1-"
MARKER = ".akb-clean-pilot-real-stack-v1"
REQUIRED_IMAGES = {"postgresql", "s3-object-storage", "opensearch", "qdrant", "registry-api", "ingestion-service", "rag-retrieval-service", "evaluation-service", "web"}
REQUIRED_SURFACES = {"registry", "search", "retrieval", "chat", "preview", "download", "citation", "source-open", "export", "publication"}
PRODUCTION_TOKENS = {"docker.home.cz", "zeleznalady.cz", "stratos.", "login.", "/srv/akl", "/srv/stratos"}
PRODUCTION_ENV_KEYS = {"AKL_DATABASE_URL", "DATABASE_URL", "AKL_S3_ENDPOINT", "AKL_OPENSEARCH_BASE_URL", "AKL_QDRANT_BASE_URL", "AKL_OIDC_ISSUER", "AKL_STRATOS_AUTH_ME_URL", "AKL_STRATOS_POLICY_BINDINGS_URL"}
SHA256 = re.compile(r"^[a-f0-9]{64}$")
RUN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{7,39}$")
IMAGE = re.compile(r"^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64})$")
STORE_CLASSES = {
    "registry-metadata-and-immutable-versions", "object-storage", "ingest-job-state",
    "search-index", "vector-index", "citations-and-source-open", "rag-and-chat",
    "evaluation", "audit", "cache-session-authorization",
}


def stop(code: str) -> None:
    raise RuntimeError(code)


def _walk_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from _walk_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_strings(item)


def image_bundle_digest(images: dict[str, str]) -> str:
    canonical = json.dumps(images, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(canonical).hexdigest()


def tree_digest(root: Path, paths: list[str]) -> str:
    digest = hashlib.sha256()
    files: list[Path] = []
    for item in paths:
        path = root / item
        files.extend(sorted(p for p in ([path] if path.is_file() else path.rglob("*")) if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"))
    for path in sorted(set(files), key=lambda value: value.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix().encode()
        content = path.read_bytes()
        digest.update(len(relative).to_bytes(8, "big") + relative)
        digest.update(len(content).to_bytes(8, "big") + content)
    return digest.hexdigest()


def validate_source_commit(bundle: dict[str, Any], current_commit: str) -> None:
    if bundle.get("sourceCommit") != current_commit:
        stop("SOURCE_COMMIT_MISMATCH")


def validate_bundle(bundle: dict[str, Any]) -> None:
    expected = {"schemaVersion", "repository", "sourceCommit", "migrationBundleSha256", "imageBundleSha256", "images", "surfaces", "networkPolicy", "credentialPolicy", "productionConnectivity", "composePath"}
    if set(bundle) != expected:
        stop("BUNDLE_FIELDS_NOT_CLOSED")
    if bundle["schemaVersion"] != SCHEMA or bundle["repository"] != "AKB/ai-knowledgebase":
        stop("BUNDLE_IDENTITY_INVALID")
    if not re.fullmatch(r"[a-f0-9]{40}", str(bundle["sourceCommit"])):
        stop("SOURCE_COMMIT_INVALID")
    if not SHA256.fullmatch(str(bundle["migrationBundleSha256"])) or not SHA256.fullmatch(str(bundle["imageBundleSha256"])):
        stop("BUNDLE_DIGEST_INVALID")
    images = bundle["images"]
    if not isinstance(images, dict) or set(images) != REQUIRED_IMAGES:
        stop("IMAGE_SET_INCOMPLETE")
    if any(not IMAGE.fullmatch(str(value)) for value in images.values()):
        stop("IMAGE_NOT_IMMUTABLE")
    if bundle["imageBundleSha256"] != image_bundle_digest(images):
        stop("IMAGE_BUNDLE_DIGEST_MISMATCH")
    if set(bundle["surfaces"]) != REQUIRED_SURFACES:
        stop("SURFACE_SET_INCOMPLETE")
    if bundle["networkPolicy"] != "internal-no-egress" or bundle["credentialPolicy"] != "generated-ephemeral-only" or bundle["productionConnectivity"] is not False:
        stop("ISOLATION_POLICY_INVALID")
    if bundle["composePath"] != "infra/clean-pilot/docker-compose.rehearsal.yml":
        stop("COMPOSE_PATH_INVALID")
    lowered = "\n".join(_walk_strings(bundle)).lower()
    if any(token in lowered for token in PRODUCTION_TOKENS):
        stop("PRODUCTION_LIKE_TARGET_FORBIDDEN")


def validate_migration_bundle(bundle: dict[str, Any], repository_root: Path) -> None:
    expected = tree_digest(repository_root, ["services/registry-api/alembic", "infra/postgres/init"])
    if bundle["migrationBundleSha256"] != expected:
        stop("MIGRATION_BUNDLE_DIGEST_MISMATCH")


def validate_environment(environment: dict[str, str]) -> None:
    if environment.get("DOCKER_HOST", "").strip() not in {"", "unix:///var/run/docker.sock"}:
        stop("REMOTE_DOCKER_HOST_FORBIDDEN")
    if PRODUCTION_ENV_KEYS.intersection(environment):
        stop("EXTERNAL_ENDPOINT_ENV_FORBIDDEN")


def prepare_marker(root: Path, run_id: str) -> Path:
    if not RUN_ID.fullmatch(run_id):
        stop("RUN_ID_INVALID")
    target = root.resolve() / f"{PROJECT_PREFIX}{run_id}"
    if target.exists():
        marker = target / MARKER
        if not marker.is_file():
            stop("DISPOSABLE_MARKER_REQUIRED")
        if any(path.name != MARKER for path in target.iterdir()):
            stop("DISPOSABLE_TARGET_NOT_EMPTY")
        stop("DISPOSABLE_PROJECT_ALREADY_EXISTS")
    target.mkdir(parents=True)
    (target / MARKER).write_text(f"clean-pilot-epoch-1:{run_id}\n", encoding="utf-8")
    return target


def verify_stale_denials(results: dict[str, str]) -> None:
    if set(results) != REQUIRED_SURFACES or any(value != "denied" for value in results.values()):
        stop("STALE_ID_NOT_DENIED_ON_ALL_SURFACES")


def preflight(bundle_path: Path, marker_root: Path, run_id: str, current_commit: str) -> dict[str, Any]:
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    validate_bundle(bundle)
    validate_source_commit(bundle, current_commit)
    repository_root = Path(__file__).resolve().parents[1]
    validate_migration_bundle(bundle, repository_root)
    validate_environment(dict(os.environ))
    compose = Path(bundle["composePath"])
    if not compose.is_file():
        stop("REAL_STACK_COMPOSE_MISSING")
    target = prepare_marker(marker_root, run_id)
    return {"schemaVersion": "akb-clean-pilot-stack-preflight-result-1", "repository": "AKB/ai-knowledgebase", "runId": run_id, "project": f"{PROJECT_PREFIX}{run_id}", "markerCreated": target.joinpath(MARKER).is_file(), "productionConnectivity": False, "authority": "SOURCE_ONLY", "result": "PASS"}


def _run(command: list[str], *, env: dict[str, str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True)
    if check and result.returncode:
        stop("REHEARSAL_COMMAND_FAILED")
    return result


def _secret(length: int = 32) -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(length)).decode().rstrip("=")


def compose_environment(bundle: dict[str, Any], run_id: str) -> dict[str, str]:
    suffixes = {
        "postgresql": "POSTGRESQL", "s3-object-storage": "S3_OBJECT_STORAGE",
        "opensearch": "OPENSEARCH", "qdrant": "QDRANT", "registry-api": "REGISTRY_API",
        "ingestion-service": "INGESTION_SERVICE", "rag-retrieval-service": "RAG_RETRIEVAL_SERVICE",
        "evaluation-service": "EVALUATION_SERVICE", "web": "WEB",
    }
    values = {
        "AKB_REHEARSAL_PROJECT": f"{PROJECT_PREFIX}{run_id}",
        "AKB_REHEARSAL_RUN_ID": run_id,
        "AKB_REHEARSAL_POSTGRES_PASSWORD": _secret(),
        "AKB_REHEARSAL_S3_ACCESS_KEY": f"rehearsal-{secrets.token_hex(8)}",
        "AKB_REHEARSAL_S3_SECRET_KEY": _secret(),
        "AKB_REHEARSAL_SESSION_SECRET": _secret(48),
        "AKB_REHEARSAL_DOWNLOAD_SECRET": _secret(48),
        "AKB_REHEARSAL_UPLOAD_SECRET": _secret(48),
    }
    values.update({f"AKB_IMAGE_{suffixes[name]}": image for name, image in bundle["images"].items()})
    return values


def _compose(repository_root: Path, project: str, env: dict[str, str], *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    command = ["docker", "compose", "-p", project, "-f", "infra/clean-pilot/docker-compose.rehearsal.yml", *args]
    return _run(command, env={**os.environ, **env}, cwd=repository_root, check=check)


def verify_isolated_compose(repository_root: Path, project: str, env: dict[str, str]) -> None:
    result = _compose(repository_root, project, env, "config", "--format", "json")
    config = json.loads(result.stdout)
    if any(service.get("ports") for service in config["services"].values()):
        stop("PUBLISHED_PORT_FORBIDDEN")
    networks = config.get("networks", {})
    if len(networks) != 1 or not next(iter(networks.values())).get("internal"):
        stop("NO_EGRESS_NETWORK_REQUIRED")
    rendered = result.stdout.lower()
    if any(token in rendered for token in PRODUCTION_TOKENS):
        stop("PRODUCTION_LIKE_TARGET_FORBIDDEN")


def _probe(repository_root: Path, project: str, env: dict[str, str]) -> dict[str, Any]:
    script = r'''
import json, os, pathlib, urllib.error, urllib.request
from sqlalchemy import create_engine, inspect, text

def http(method, url, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method=method, headers={"content-type":"application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read().decode(errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode(errors="replace")

engine = create_engine(os.environ["AKL_DATABASE_URL"])
inspector = inspect(engine)
tables = inspector.get_table_names()
with engine.connect() as connection:
    counts = {table: int(connection.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar_one()) for table in tables}

business = {
 "registry-metadata-and-immutable-versions": sum(counts.get(t,0) for t in ["documents","document_versions","controlled_document_packages","controlled_document_package_members","document_publications","document_files","external_document_refs"]),
 "ingest-job-state": counts.get("ingestion_attempts",0),
 "citations-and-source-open": sum(counts.get(t,0) for t in ["document_files","document_extractions"]),
 "rag-and-chat": sum(counts.get(t,0) for t in ["assistant_conversations","assistant_messages","assistant_conversation_shares","assistant_feedback"]),
 "audit": sum(counts.get(t,0) for t in ["audit_events","integration_idempotency_records","workflow_tasks"]),
 "cache-session-authorization": sum(counts.get(t,0) for t in ["web_sessions","policies","role_mappings","assignments","profiles"]),
}

os_status, os_body = http("GET", "http://opensearch:9200/_cat/indices?format=json")
if os_status != 200: raise SystemExit("OPENSEARCH_PROBE_FAILED")
business["search-index"] = sum(int(item.get("docs.count","0")) for item in json.loads(os_body) if not item.get("index","").startswith("."))
qd_status, qd_body = http("GET", "http://qdrant:6333/collections")
if qd_status != 200: raise SystemExit("QDRANT_PROBE_FAILED")
collections = json.loads(qd_body).get("result",{}).get("collections",[])
points = 0
for collection in collections:
    status, body = http("GET", "http://qdrant:6333/collections/" + collection["name"])
    if status != 200: raise SystemExit("QDRANT_COLLECTION_PROBE_FAILED")
    points += int(json.loads(body).get("result",{}).get("points_count") or 0)
business["vector-index"] = points
stale = "cpe-stale-00000000"
probes = {
 "registry": http("GET", f"http://registry-api:8000/api/v1/documents/{stale}"),
 "search": http("POST", "http://rag-retrieval-service:8080/api/v1/rag/retrieve", {"query":"stale","top_k":1,"filters":{"document_ids":[stale]}}),
 "retrieval": http("POST", "http://rag-retrieval-service:8080/api/v1/rag/retrieve", {"query":"stale","top_k":1,"filters":{"document_ids":[stale]}}),
 "chat": http("GET", f"http://rag-retrieval-service:8080/api/v1/assistant/conversations/{stale}"),
 "preview": http("GET", f"http://web:3000/api/documents/source/preview?document_id={stale}&version_id={stale}"),
 "download": http("GET", f"http://web:3000/api/documents/source/content?document_id={stale}&version_id={stale}"),
 "citation": http("GET", f"http://web:3000/api/assistant/citations/{stale}/open"),
 "source-open": http("POST", f"http://web:3000/api/documents/{stale}/versions/{stale}/source/open", {}),
 "export": http("POST", "http://web:3000/api/assistant/reports/export", {"conversation_id":stale}),
 "publication": http("GET", f"http://registry-api:8000/api/v1/documents/{stale}/versions/{stale}/publication"),
}
denials = {}
for name,(status,body) in probes.items():
    parsed = {}
    try: parsed = json.loads(body) if body else {}
    except Exception: pass
    empty_retrieval = name in {"search","retrieval"} and status == 200 and not (parsed.get("chunks") or parsed.get("results"))
    denials[name] = "denied" if status in {400,401,403,404,409,422} or empty_retrieval else "accepted"
print(json.dumps({"stores":business,"stale":denials,"tableCount":len(tables)},sort_keys=True))
'''
    encoded = base64.b64encode(script.encode()).decode()
    command = ["exec", "-T", "registry-api", "python", "-c", f"import base64;exec(base64.b64decode('{encoded}'))"]
    result = _compose(repository_root, project, env, *command)
    data = json.loads(result.stdout.strip().splitlines()[-1])
    filesystem_probes = {
        "object-storage": ("s3-object-storage", "find /data -type f ! -path '/data/.minio.sys/*' | wc -l"),
        "ingest-volume": ("ingestion-service", "find /data/ingestion-jobs -type f | wc -l"),
        "evaluation": ("evaluation-service", "find /data/evaluation-datasets /data/evaluation-reports -type f | wc -l"),
    }
    measured: dict[str, int] = {}
    for name, (service, command) in filesystem_probes.items():
        probe = _compose(repository_root, project, env, "exec", "-T", service, "sh", "-c", command)
        measured[name] = int(probe.stdout.strip())
    data["stores"]["object-storage"] = measured["object-storage"]
    data["stores"]["ingest-job-state"] += measured["ingest-volume"]
    data["stores"]["evaluation"] = measured["evaluation"]
    if set(data["stores"]) != STORE_CLASSES:
        stop("STORE_CLASS_SET_INCOMPLETE")
    if any(value != 0 for value in data["stores"].values()):
        stop("DISPOSABLE_STORE_NOT_EMPTY")
    verify_stale_denials(data["stale"])
    return data


def verify_cleanup(repository_root: Path, project: str, env: dict[str, str], target: Path) -> None:
    marker = target / MARKER
    if marker.read_text(encoding="utf-8") != f"clean-pilot-epoch-1:{env['AKB_REHEARSAL_RUN_ID']}\n":
        stop("DISPOSABLE_MARKER_INVALID")
    _compose(repository_root, project, env, "down", "--volumes", "--remove-orphans")
    for kind in ("container", "volume", "network"):
        result = _run(["docker", kind, "ls", "-q", "--filter", f"label=com.docker.compose.project={project}"], env=os.environ.copy(), cwd=repository_root)
        if result.stdout.strip():
            stop("DISPOSABLE_CLEANUP_INCOMPLETE")


def execute_rehearsal(bundle_path: Path, marker_root: Path, run_id: str, current_commit: str) -> dict[str, Any]:
    result = preflight(bundle_path, marker_root, run_id, current_commit)
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    repository_root = Path(__file__).resolve().parents[1]
    project = result["project"]
    target = marker_root.resolve() / project
    env = compose_environment(bundle, run_id)
    verify_isolated_compose(repository_root, project, env)
    started = False
    try:
        _compose(repository_root, project, env, "up", "-d", "--wait")
        started = True
        first = _probe(repository_root, project, env)
        _compose(repository_root, project, env, "up", "-d", "--wait")
        second = _probe(repository_root, project, env)
        if first != second:
            stop("SECOND_BOOTSTRAP_NOT_NOOP")
        result.update({"stores": first["stores"], "staleIdSurfaces": first["stale"], "secondBootstrap": "NO_OP", "result": "PASS"})
    finally:
        if started:
            verify_cleanup(repository_root, project, env, target)
            result["cleanup"] = "PASS"
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-manifest", type=Path, required=True)
    parser.add_argument("--marker-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--preflight-only", action="store_true")
    args = parser.parse_args()
    if args.preflight_only:
        result = preflight(args.bundle_manifest, args.marker_root, args.run_id, args.source_commit)
    else:
        result = execute_rehearsal(args.bundle_manifest, args.marker_root, args.run_id, args.source_commit)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
