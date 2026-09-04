#!/usr/bin/env python3
"""Create or reuse a content-addressed Python test environment for trusted CI."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "scripts/ci/gitea-python-test-locks.json"
MANIFEST_KEYS = {"python", "schema", "services"}
SERVICE_KEYS = {"input", "input_sha256", "lock", "lock_sha256"}
MARKER_KEYS = {"schema", "service", "python", "lock_sha256"}


class CachedEnvironmentError(RuntimeError):
    """Raised when a cached environment cannot be trusted."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_service(manifest_path: Path, service: str) -> dict[str, str]:
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    if set(document) != MANIFEST_KEYS:
        raise CachedEnvironmentError("CI_PYTHON_MANIFEST_NOT_CLOSED")
    if document.get("schema") != "akb-gitea-python-test-locks-1":
        raise CachedEnvironmentError("CI_PYTHON_MANIFEST_SCHEMA_INVALID")
    expected_python = f"{sys.version_info.major}.{sys.version_info.minor}"
    if document.get("python") != expected_python:
        raise CachedEnvironmentError("CI_PYTHON_INTERPRETER_DRIFT")
    services = document.get("services")
    if not isinstance(services, dict) or service not in services:
        raise CachedEnvironmentError("CI_PYTHON_SERVICE_UNKNOWN")
    entry = services[service]
    if not isinstance(entry, dict) or set(entry) != SERVICE_KEYS:
        raise CachedEnvironmentError("CI_PYTHON_SERVICE_NOT_CLOSED")
    return {key: str(value) for key, value in entry.items()}


def resolve_repo_file(raw_path: str) -> Path:
    candidate = (ROOT / raw_path).resolve()
    try:
        candidate.relative_to(ROOT.resolve())
    except ValueError as exc:
        raise CachedEnvironmentError("CI_PYTHON_PATH_OUTSIDE_REPOSITORY") from exc
    if not candidate.is_file():
        raise CachedEnvironmentError("CI_PYTHON_INPUT_MISSING")
    return candidate


def validate_entry(entry: dict[str, str]) -> Path:
    dependency_input = resolve_repo_file(entry["input"])
    lock_path = resolve_repo_file(entry["lock"])
    if sha256_file(dependency_input) != entry["input_sha256"]:
        raise CachedEnvironmentError("CI_PYTHON_DEPENDENCY_INPUT_DRIFT")
    if sha256_file(lock_path) != entry["lock_sha256"]:
        raise CachedEnvironmentError("CI_PYTHON_LOCK_DRIFT")
    lock_text = lock_path.read_text(encoding="utf-8")
    if "--hash=sha256:" not in lock_text:
        raise CachedEnvironmentError("CI_PYTHON_LOCK_NOT_HASHED")
    return lock_path


def python_identity() -> str:
    implementation = sys.implementation.name
    version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    return f"{implementation}-{version}"


def validate_cache_root(cache_root: Path) -> Path:
    if not cache_root.is_absolute():
        raise CachedEnvironmentError("CI_PYTHON_CACHE_ROOT_NOT_ABSOLUTE")
    resolved = cache_root.resolve(strict=False)
    if resolved == Path("/") or len(resolved.parts) < 4:
        raise CachedEnvironmentError("CI_PYTHON_CACHE_ROOT_UNSAFE")
    resolved.mkdir(parents=True, exist_ok=True, mode=0o755)
    return resolved


def expected_marker(service: str, lock_sha256: str) -> dict[str, str]:
    return {
        "schema": "akb-ci-python-env-2",
        "service": service,
        "python": python_identity(),
        "lock_sha256": lock_sha256,
    }


def validate_cached_environment(path: Path, marker: dict[str, str]) -> None:
    marker_path = path / ".akb-ci-environment.json"
    python_path = path / "bin/python"
    if not marker_path.is_file() or not python_path.is_file():
        raise CachedEnvironmentError("CI_PYTHON_CACHE_INCOMPLETE")
    actual = json.loads(marker_path.read_text(encoding="utf-8"))
    if set(actual) != MARKER_KEYS or actual != marker:
        raise CachedEnvironmentError("CI_PYTHON_CACHE_MARKER_DRIFT")


def ensure_environment(
    service: str,
    cache_root: Path,
    manifest_path: Path = DEFAULT_MANIFEST,
) -> tuple[Path, str]:
    entry = load_service(manifest_path, service)
    lock_path = validate_entry(entry)
    root = validate_cache_root(cache_root)
    marker = expected_marker(service, entry["lock_sha256"])
    key_material = json.dumps(marker, sort_keys=True, separators=(",", ":")).encode()
    cache_key = hashlib.sha256(key_material).hexdigest()
    target = root / service / cache_key
    if target.exists():
        validate_cached_environment(target, marker)
        return target, "hit"

    service_root = target.parent
    service_root.mkdir(parents=True, exist_ok=True, mode=0o755)
    try:
        # Python virtual environments embed their creation path and are not
        # relocatable. Build directly at the content-addressed final path;
        # the closed marker is written last, so interrupted builds remain
        # incomplete and are rejected on the next run.
        subprocess.run((sys.executable, "-m", "venv", str(target)), check=True)
        subprocess.run(
            (
                str(target / "bin/python"),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--require-hashes",
                "-r",
                str(lock_path),
            ),
            check=True,
        )
        (target / ".akb-ci-environment.json").write_text(
            json.dumps(marker, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        raise
    validate_cached_environment(target, marker)
    return target, "miss"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", required=True)
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate the closed manifest and dependency inputs without creating an environment.",
    )
    parser.add_argument(
        "--cache-root",
        type=Path,
        default=Path(os.environ.get("AKB_CI_PYTHON_ENV_ROOT", "/cache/akb-ci/python-envs")),
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.validate_only:
            entry = load_service(args.manifest, args.service)
            validate_entry(entry)
            print("validated")
            return 0
        path, status = ensure_environment(args.service, args.cache_root, args.manifest)
    except (CachedEnvironmentError, json.JSONDecodeError, OSError, subprocess.CalledProcessError) as exc:
        print(f"cached Python environment rejected: {exc}", file=sys.stderr)
        return 1
    print(f"cache={status}", file=sys.stderr)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
