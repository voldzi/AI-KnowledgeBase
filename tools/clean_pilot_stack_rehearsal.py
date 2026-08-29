#!/usr/bin/env python3
"""Fail-closed preflight for a real, disposable AKB clean-pilot stack."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
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
IMAGE = re.compile(r"^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$")


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
    validate_environment(dict(os.environ))
    compose = Path(bundle["composePath"])
    if not compose.is_file():
        stop("REAL_STACK_COMPOSE_MISSING")
    target = prepare_marker(marker_root, run_id)
    return {"schemaVersion": "akb-clean-pilot-stack-preflight-result-1", "repository": "AKB/ai-knowledgebase", "runId": run_id, "project": f"{PROJECT_PREFIX}{run_id}", "markerCreated": target.joinpath(MARKER).is_file(), "productionConnectivity": False, "authority": "SOURCE_ONLY", "result": "PASS"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-manifest", type=Path, required=True)
    parser.add_argument("--marker-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--preflight-only", action="store_true")
    args = parser.parse_args()
    result = preflight(args.bundle_manifest, args.marker_root, args.run_id, args.source_commit)
    if not args.preflight_only:
        stop("REAL_STACK_EXECUTION_REQUIRES_APPROVED_COMPOSE_AND_PROBE")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
