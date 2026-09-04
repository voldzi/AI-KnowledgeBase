#!/usr/bin/env python3
"""Reproducible, isolated Docker Desktop preflight for an AKB candidate."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from typing import Sequence


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ci"))

from affected_components import (  # noqa: E402
    ImpactPlan,
    impact_profile,
    plan_paths,
)


PYTHON_BASE = "python:3.12-slim@sha256:e5c9fa26ffb76e11e0f054f30dc2523a2f9693f0c36c0cf1e39b27e152d899fc"
HARD_BUILD_STOP_GIB = 5
SUMMARY_KEYS = {
    "schema",
    "commit",
    "working_tree_dirty",
    "base",
    "snapshot_sha256",
    "impact_profile",
    "platform",
    "status",
    "checks",
    "total_duration_ms",
    "cache",
    "trusted_gitea_ci_required",
}
CHECK_KEYS = {"id", "status", "duration_ms", "cache", "image_digest"}
FORBIDDEN_NAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".npmrc",
    ".netrc",
    "id_rsa",
    "id_ed25519",
}
FORBIDDEN_SUFFIXES = {".key", ".p12", ".pfx", ".jks", ".keystore"}
EXPECTED_WEB_SCRIPTS = {
    "semantic-registry:check": "node scripts/sync-ssp-semantic-registry.mjs --check",
    "typecheck": "tsc --noEmit",
    "test": "node --conditions=react-server --import tsx --test tests/*.test.ts",
    "build": "node scripts/check-director-copilot-v2-contracts.mjs && next build --webpack",
}


@dataclass(frozen=True)
class ServiceSpec:
    component: str
    directory: str
    dependency_input: str
    lock: str


PYTHON_SERVICES = (
    ServiceSpec("registry_api", "registry-api", "services/registry-api/pyproject.toml", "infra/ci/local-fast-check/locks/registry-api.test.lock"),
    ServiceSpec("ingestion_service", "ingestion-service", "services/ingestion-service/requirements.txt", "services/ingestion-service/requirements.c4.lock"),
    ServiceSpec("rag_retrieval_service", "rag-retrieval-service", "services/rag-retrieval-service/requirements.txt", "services/rag-retrieval-service/requirements.c4.lock"),
    ServiceSpec("llm_gateway_service", "llm-gateway-service", "services/llm-gateway-service/requirements.txt", "infra/ci/local-fast-check/locks/llm-gateway-service.test.lock"),
    ServiceSpec("evaluation_service", "evaluation-service", "services/evaluation-service/requirements.txt", "services/evaluation-service/requirements.c4.lock"),
    ServiceSpec("governance_service", "governance-service", "services/governance-service/requirements.txt", "infra/ci/local-fast-check/locks/governance-service.test.lock"),
)


class LocalCheckError(RuntimeError):
    pass


def run(
    command: Sequence[str],
    *,
    cwd: Path = ROOT,
    check: bool = True,
    capture: bool = True,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        list(command),
        cwd=cwd,
        text=True,
        capture_output=capture,
        check=False,
        env=env,
    )
    if check and result.returncode:
        detail = (result.stderr or result.stdout or "no command output").strip()
        raise LocalCheckError(f"command failed ({command[0]}): {detail[-2000:]}")
    return result


def git(*args: str, cwd: Path = ROOT) -> str:
    return run(("git", *args), cwd=cwd).stdout.strip()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def collect_changed_paths(base: str) -> list[str]:
    commands = (
        ("diff", "--name-only", f"{base}...HEAD", "--"),
        ("diff", "--cached", "--name-only", "--"),
        ("diff", "--name-only", "--"),
        ("ls-files", "--others", "--exclude-standard"),
    )
    paths: set[str] = set()
    for command in commands:
        paths.update(line for line in git(*command).splitlines() if line)
    return sorted(paths)


def _safe_snapshot_path(raw: str) -> PurePosixPath:
    relative = PurePosixPath(raw)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise LocalCheckError("LOCAL_CI_UNSAFE_SOURCE_PATH")
    lowered = relative.name.lower()
    if lowered in FORBIDDEN_NAMES or lowered.endswith(tuple(FORBIDDEN_SUFFIXES)):
        raise LocalCheckError(f"LOCAL_CI_FORBIDDEN_SOURCE_FILE:{relative}")
    if lowered.startswith(".env") and lowered not in {
        ".env.example",
        ".env.local-prod.example",
    }:
        raise LocalCheckError(f"LOCAL_CI_FORBIDDEN_SOURCE_FILE:{relative}")
    return relative


def create_sanitized_snapshot(root: Path, destination: Path) -> str:
    result = subprocess.run(
        ("git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"),
        cwd=root,
        capture_output=True,
        check=True,
    )
    digest = hashlib.sha256()
    for encoded in sorted(item for item in result.stdout.split(b"\0") if item):
        raw = os.fsdecode(encoded)
        relative = _safe_snapshot_path(raw)
        source = root / Path(*relative.parts)
        try:
            mode = source.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
            raise LocalCheckError(f"LOCAL_CI_UNSAFE_SOURCE_TYPE:{relative}")
        target = destination / Path(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        os.chmod(target, stat.S_IMODE(mode) & 0o755)
        payload = target.read_bytes()
        digest.update(str(relative).encode("utf-8") + b"\0")
        digest.update(hashlib.sha256(payload).digest())

    for forbidden in (destination / ".env", destination / ".git", destination / ".npmrc"):
        if forbidden.exists():
            raise LocalCheckError("LOCAL_CI_SNAPSHOT_CONTAINS_FORBIDDEN_PATH")
    return digest.hexdigest()


def validate_hash_lock(path: Path) -> None:
    if not path.is_file():
        raise LocalCheckError(f"LOCAL_CI_LOCK_MISSING:{path.name}")
    text = path.read_text(encoding="utf-8")
    if re.search(r"(^|\s)(-e\s|--index-url|--extra-index-url|https?://|\s@\s)", text):
        raise LocalCheckError(f"LOCAL_CI_UNLOCKED_DEPENDENCY:{path.name}")
    requirements = [
        line.strip()
        for line in text.splitlines()
        if line and not line[0].isspace() and not line.startswith("#")
    ]
    if not requirements or any("==" not in line for line in requirements):
        raise LocalCheckError(f"LOCAL_CI_UNLOCKED_DEPENDENCY:{path.name}")
    if text.count("--hash=sha256:") < len(requirements):
        raise LocalCheckError(f"LOCAL_CI_MISSING_DEPENDENCY_HASH:{path.name}")


def validate_dependency_binding(spec: ServiceSpec, snapshot: Path) -> None:
    manifest_path = snapshot / "infra/ci/local-fast-check/dependency-locks.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if set(manifest) != {"schema", "python", "services"}:
            raise KeyError("closed manifest")
        if manifest["schema"] != "akb-local-fast-check-dependency-locks-1" or manifest["python"] != "3.12":
            raise KeyError("identity")
        entry = manifest["services"][spec.component]
        if set(entry) != {"input", "input_sha256", "lock", "lock_sha256"}:
            raise KeyError("closed service")
        if set(manifest["services"]) != {item.component for item in PYTHON_SERVICES}:
            raise KeyError("complete services")
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise LocalCheckError("LOCAL_CI_DEPENDENCY_MANIFEST_INVALID") from exc
    if entry["input"] != spec.dependency_input or entry["lock"] != spec.lock:
        raise LocalCheckError(f"LOCAL_CI_DEPENDENCY_BINDING_DRIFT:{spec.directory}")
    if sha256_file(snapshot / spec.dependency_input) != entry["input_sha256"]:
        raise LocalCheckError(f"LOCAL_CI_DEPENDENCY_INPUT_DRIFT:{spec.directory}")
    if sha256_file(snapshot / spec.lock) != entry["lock_sha256"]:
        raise LocalCheckError(f"LOCAL_CI_DEPENDENCY_LOCK_DRIFT:{spec.directory}")


def validate_web_scripts(package_json: Path) -> None:
    try:
        scripts = json.loads(package_json.read_text(encoding="utf-8"))["scripts"]
    except (KeyError, json.JSONDecodeError) as exc:
        raise LocalCheckError("LOCAL_CI_WEB_PACKAGE_INVALID") from exc
    actual = {name: scripts.get(name) for name in EXPECTED_WEB_SCRIPTS}
    if actual != EXPECTED_WEB_SCRIPTS:
        raise LocalCheckError("LOCAL_CI_WEB_SCRIPT_DRIFT")


def docker_available() -> None:
    run(("docker", "version", "--format", "{{.Server.Version}}"))
    run(("docker", "buildx", "version"))


def require_build_space() -> None:
    free_gib = shutil.disk_usage(ROOT).free / (1024 ** 3)
    if free_gib < HARD_BUILD_STOP_GIB:
        raise LocalCheckError("LOCAL_CI_DISK_CRITICAL")


def image_id(tag: str) -> str | None:
    result = run(("docker", "image", "inspect", "--format", "{{.Id}}", tag), check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def image_tag(kind: str, platform: str, inputs: Sequence[Path]) -> str:
    digest = hashlib.sha256()
    digest.update(platform.encode())
    for path in inputs:
        # Snapshot roots are intentionally random; only logical names and bytes
        # may participate in a reusable image identity.
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return f"akb/local-fast-check-{kind}:{digest.hexdigest()[:20]}"


def build_python_image(spec: ServiceSpec, snapshot: Path, platform: str, require_cache: bool) -> tuple[str, str, str]:
    lock = snapshot / spec.lock
    validate_hash_lock(lock)
    validate_dependency_binding(spec, snapshot)
    dockerfile = snapshot / "infra/ci/local-fast-check/Dockerfile.python"
    tag = image_tag(
        spec.directory,
        platform,
        (snapshot / "infra/ci/local-fast-check/Dockerfile.python", snapshot / spec.dependency_input, lock),
    )
    cached = image_id(tag)
    if cached:
        return tag, cached, "hit"
    if require_cache:
        raise LocalCheckError(f"LOCAL_CI_IMAGE_CACHE_MISS:{spec.directory}")
    require_build_space()
    run(
        (
            "docker", "buildx", "build", "--load", "--platform", platform,
            "--file", str(dockerfile),
            "--build-arg", f"LOCK_PATH={spec.lock}",
            "--build-arg", f"LOCK_SHA256={sha256_file(lock)}",
            "--build-arg", f"PIP_CACHE_ID=akb-local-ci-pip-{spec.directory}-{platform.replace('/', '-')}",
            "--tag", tag, str(snapshot),
        )
    )
    built = image_id(tag)
    if not built:
        raise LocalCheckError(f"LOCAL_CI_IMAGE_BUILD_UNVERIFIED:{spec.directory}")
    return tag, built, "miss"


def build_web_image(snapshot: Path, platform: str, require_cache: bool) -> tuple[str, str, str]:
    dockerfile = snapshot / "infra/ci/local-fast-check/Dockerfile.web"
    inputs = (
        dockerfile,
        snapshot / "apps/web/package.json",
        snapshot / "apps/web/pnpm-lock.yaml",
        snapshot / "apps/web/pnpm-workspace.yaml",
    )
    tag = image_tag("web", platform, inputs)
    cached = image_id(tag)
    if cached:
        return tag, cached, "hit"
    if require_cache:
        raise LocalCheckError("LOCAL_CI_IMAGE_CACHE_MISS:web")
    require_build_space()
    run(
        (
            "docker", "buildx", "build", "--load", "--platform", platform,
            "--file", str(snapshot / "infra/ci/local-fast-check/Dockerfile.web"),
            "--build-arg", f"PNPM_CACHE_ID=akb-local-ci-pnpm-{platform.replace('/', '-')}",
            "--tag", tag, str(snapshot),
        )
    )
    built = image_id(tag)
    if not built:
        raise LocalCheckError("LOCAL_CI_IMAGE_BUILD_UNVERIFIED:web")
    return tag, built, "miss"


def isolated_docker_run_prefix(snapshot: Path, platform: str) -> list[str]:
    return [
        "docker", "run", "--rm", "--platform", platform,
        "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true", "--pids-limit", "512",
        "--user", "65532:65532",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=512m,uid=65532,gid=65532,mode=0700",
        "--tmpfs", "/work:rw,exec,nosuid,nodev,size=6g,uid=65532,gid=65532,mode=0700",
        "--mount", f"type=bind,src={snapshot},dst=/source,readonly",
        "--env", "HOME=/tmp/home",
        "--env", "PYTHONDONTWRITEBYTECODE=1",
    ]


def run_python_check(spec: ServiceSpec, snapshot: Path, platform: str, require_cache: bool) -> dict[str, object]:
    started = time.monotonic()
    tag, digest, cache = build_python_image(spec, snapshot, platform, require_cache)
    command = (
        "mkdir -p /tmp/home /work/repo && cp -R /source/. /work/repo/ && "
        f"cd /work/repo/services/{spec.directory} && "
        "PYTHONPATH=. python -m pytest -q -p no:cacheprovider"
    )
    run((*isolated_docker_run_prefix(snapshot, platform), tag, command))
    return check_result(spec.component, started, cache, digest)


def run_web_check(snapshot: Path, platform: str, require_cache: bool) -> dict[str, object]:
    started = time.monotonic()
    validate_web_scripts(snapshot / "apps/web/package.json")
    tag, digest, cache = build_web_image(snapshot, platform, require_cache)
    command = (
        "mkdir -p /tmp/home /work/repo && cp -R /source/. /work/repo/ && "
        "cd /work/repo/apps/web && ln -s /opt/web/node_modules node_modules && "
        "node scripts/sync-ssp-semantic-registry.mjs --check && "
        "node node_modules/typescript/bin/tsc --noEmit && "
        "node --conditions=react-server --import tsx --test tests/*.test.ts && "
        "node scripts/check-director-copilot-v2-contracts.mjs && "
        "node node_modules/next/dist/bin/next build --webpack"
    )
    run((*isolated_docker_run_prefix(snapshot, platform), tag, command))
    return check_result("web", started, cache, digest)


def run_boundary_check(snapshot: Path, platform: str, require_cache: bool) -> dict[str, object]:
    started = time.monotonic()
    digest = image_id(PYTHON_BASE)
    cache = "hit"
    if not digest:
        if require_cache:
            raise LocalCheckError("LOCAL_CI_IMAGE_CACHE_MISS:security-boundary")
        run(("docker", "pull", "--platform", platform, PYTHON_BASE))
        digest = image_id(PYTHON_BASE)
        cache = "miss"
    if not digest:
        raise LocalCheckError("LOCAL_CI_IMAGE_PULL_UNVERIFIED:security-boundary")
    run(
        (*isolated_docker_run_prefix(snapshot, platform), PYTHON_BASE,
         "sh", "-c", "python /source/scripts/ci/local_container_security_probe.py")
    )
    return check_result("container_security_boundary", started, cache, digest)


def run_repository_standards(snapshot: Path) -> dict[str, object]:
    started = time.monotonic()
    commands = (
        ("bash", "scripts/validate-skeleton.sh"),
        ("ruby", "scripts/generate_openapi_index.rb", "--check"),
        (sys.executable, "-m", "json.tool", "openapi/openapi.json"),
        (sys.executable, "tests/test_ci_affected_components.py"),
        (sys.executable, "tests/test_local_fast_check.py"),
    )
    for command in commands:
        run(command, cwd=snapshot)
    return check_result("repository_standards", started, "not-applicable", None)


def run_compose_check(snapshot: Path) -> dict[str, object]:
    started = time.monotonic()
    env = {**os.environ, "COMPOSE_DISABLE_ENV_FILE": "1"}
    commands = (
        ("docker", "compose", "--env-file", ".env.example", "-f", "infra/docker-compose/docker-compose.dev.yml", "config", "--quiet"),
        ("docker", "compose", "--env-file", ".env.local-prod.example", "-f", "infra/docker-compose/docker-compose.dev.yml", "-f", "infra/docker-compose/docker-compose.local-prod.yml", "config", "--quiet"),
    )
    for command in commands:
        run(command, cwd=snapshot, env=env)
    return check_result("compose", started, "not-applicable", None)


def check_result(identifier: str, started: float, cache: str, digest: str | None) -> dict[str, object]:
    return {
        "id": identifier,
        "status": "passed",
        "duration_ms": round((time.monotonic() - started) * 1000),
        "cache": cache,
        "image_digest": digest,
    }


def validate_summary(document: dict[str, object]) -> None:
    if set(document) != SUMMARY_KEYS or document.get("schema") != "akb-local-fast-check-1":
        raise LocalCheckError("LOCAL_CI_SUMMARY_SCHEMA_INVALID")
    checks = document.get("checks")
    if not isinstance(checks, list) or any(set(item) != CHECK_KEYS for item in checks):
        raise LocalCheckError("LOCAL_CI_SUMMARY_SCHEMA_INVALID")
    cache = document.get("cache")
    if not isinstance(cache, dict) or set(cache) != {
        "mode", "image_hits", "image_misses", "buildkit_scopes", "automatic_prune"
    }:
        raise LocalCheckError("LOCAL_CI_SUMMARY_SCHEMA_INVALID")
    encoded = json.dumps(document, sort_keys=True)
    if re.search(r"(?i)(token|secret|password|document[_ -]?content|prompt|answer)[=:]", encoded):
        raise LocalCheckError("LOCAL_CI_SUMMARY_SENSITIVE_DATA")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--production-sha")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--platform", default="linux/arm64", choices=("linux/arm64", "linux/amd64"))
    parser.add_argument("--jobs", type=int, default=3)
    parser.add_argument("--summary", type=Path)
    parser.add_argument("--paths-file", type=Path, help=argparse.SUPPRESS)
    parser.add_argument(
        "--skip-install",
        action="store_true",
        help="offline/warm mode: require all dependency images to be present",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.jobs < 1 or args.jobs > len(PYTHON_SERVICES) + 2:
        raise SystemExit("--jobs must be between 1 and 8")
    if args.paths_file and os.environ.get("AKB_LOCAL_FAST_CHECK_TESTING") != "1":
        raise SystemExit("--paths-file is restricted to the test harness")
    started = time.monotonic()
    baseline = [sys.executable, "scripts/ci/check_working_baseline.py", "--base", args.base]
    if args.production_sha:
        baseline.extend(("--production-sha", args.production_sha))
    run(baseline, capture=False)

    paths = (
        args.paths_file.read_text(encoding="utf-8").splitlines()
        if args.paths_file
        else collect_changed_paths(args.base)
    )
    if args.full:
        plan = ImpactPlan().with_all_runtime()
        profile = "full:operator-requested"
    else:
        plan = plan_paths(paths)
        profile = impact_profile(paths)

    commit = git("rev-parse", "HEAD")
    base_sha = git("rev-parse", f"{args.base}^{{commit}}")
    working_tree_dirty = bool(git("status", "--porcelain"))
    print(f"impact_profile={profile}")
    for key, value in plan.as_dict().items():
        print(f"{key}={'true' if value else 'false'}")

    try:
        docker_available()
        free_gib = shutil.disk_usage(ROOT).free / (1024 ** 3)
        if free_gib < 10:
            print(f"warning=LOCAL_CI_DISK_CRITICAL free_gib={free_gib:.1f}", file=sys.stderr)
        elif free_gib < 20:
            print(f"warning=LOCAL_CI_DISK_LOW free_gib={free_gib:.1f}", file=sys.stderr)

        with tempfile.TemporaryDirectory(prefix="akb-local-ci-") as temporary:
            snapshot = Path(temporary) / "source"
            snapshot.mkdir(mode=0o700)
            snapshot_digest = create_sanitized_snapshot(ROOT, snapshot)

            checks = [run_repository_standards(snapshot)]
            selected: list[tuple[str, object]] = []
            for spec in PYTHON_SERVICES:
                if plan.as_dict()[spec.component]:
                    selected.append((spec.component, spec))
            if plan.web:
                selected.append(("web", None))

            if selected:
                checks.append(run_boundary_check(snapshot, args.platform, args.skip_install))
                with ThreadPoolExecutor(max_workers=min(args.jobs, len(selected))) as pool:
                    futures = {}
                    for identifier, spec in selected:
                        future = (
                            pool.submit(run_web_check, snapshot, args.platform, args.skip_install)
                            if identifier == "web"
                            else pool.submit(run_python_check, spec, snapshot, args.platform, args.skip_install)
                        )
                        futures[future] = identifier
                    for future in as_completed(futures):
                        checks.append(future.result())
            if plan.compose:
                checks.append(run_compose_check(snapshot))
            if plan.immutable_release:
                # The trusted immutable release simulation remains solely in Gitea.
                # Local verification proves its scripts are syntactically valid.
                release_started = time.monotonic()
                for script in (
                    "scripts/check_immutable_release_workflow.sh",
                    "scripts/deploy_docker_home_release.sh",
                    "scripts/verify_docker_home_release.sh",
                ):
                    run(("bash", "-n", script), cwd=snapshot)
                checks.append(check_result("immutable_release_static", release_started, "not-applicable", None))

            checks.sort(key=lambda item: str(item["id"]))
            cache = {
                "mode": "require-existing" if args.skip_install else "build-on-miss",
                "image_hits": sum(item["cache"] == "hit" for item in checks),
                "image_misses": sum(item["cache"] == "miss" for item in checks),
                "buildkit_scopes": "separate-per-service",
                "automatic_prune": False,
            }
            summary = {
                "schema": "akb-local-fast-check-1",
                "commit": commit,
                "working_tree_dirty": working_tree_dirty,
                "base": base_sha,
                "snapshot_sha256": snapshot_digest,
                "impact_profile": profile,
                "platform": args.platform,
                "status": "passed",
                "checks": checks,
                "total_duration_ms": round((time.monotonic() - started) * 1000),
                "cache": cache,
                "trusted_gitea_ci_required": True,
            }
            validate_summary(summary)
            summary_path = args.summary or ROOT / "reports/local-fast-check/latest.json"
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            print(json.dumps(summary, sort_keys=True))
            print("Local preflight passed; trusted exact-SHA Gitea CI is still required.")
            return 0
    except (LocalCheckError, OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"Local preflight blocked: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
