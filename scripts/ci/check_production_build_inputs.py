#!/usr/bin/env python3
"""Fail early on production Dockerfile errors; never build or authorize a release."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time

from affected_components import ImpactPlan, plan_paths


ROOT = Path(__file__).resolve().parents[2]
DEFINITIONS = {
    "registry_api": ("registry-api", "services/registry-api/Dockerfile"),
    "ingestion_service": ("ingestion-service", "services/ingestion-service/Dockerfile"),
    "rag_retrieval_service": ("rag-retrieval-service", "services/rag-retrieval-service/Dockerfile"),
    "evaluation_service": ("evaluation-service", "services/evaluation-service/Dockerfile"),
    "governance_service": ("governance-service", "services/governance-service/Dockerfile"),
    "llm_gateway_service": ("llm-gateway-service", "services/llm-gateway-service/Dockerfile"),
}


def selected_definitions(plan: ImpactPlan) -> list[tuple[str, str]]:
    full = plan.compose or plan.immutable_release
    selected = [value for key, value in DEFINITIONS.items() if full or plan.as_dict()[key]]
    if full or plan.web:
        selected.extend((name, "apps/web/Dockerfile") for name in ("web", "chat-web"))
    return selected


def check_definitions(root: Path, plan: ImpactPlan, epoch: int) -> dict[str, object]:
    if epoch <= 0:
        raise ValueError("PRODUCTION_BUILD_SOURCE_EPOCH_INVALID")
    checks = []
    # Only Dockerfiles are sent to the builder. No .env, credentials, source
    # documents or Git checkout enter the empty check context. --check executes
    # no RUN instruction, creates no image and is not a production build proof.
    with tempfile.TemporaryDirectory(prefix="akb-build-definition-") as temporary:
        context = Path(temporary)
        for service, relative in selected_definitions(plan):
            started = time.monotonic()
            source = root / relative
            if source.is_symlink() or not source.is_file():
                raise ValueError("PRODUCTION_DOCKERFILE_MISSING_OR_SYMLINK")
            definition = source.read_bytes()
            dockerfile = context / "Dockerfile"
            dockerfile.write_bytes(definition)
            args = ["--build-arg", f"SOURCE_DATE_EPOCH={epoch}"]
            if service == "ingestion-service":
                args += ["--build-arg", "AKL_INSTALL_DOCLING=true"]
            if service in ("web", "chat-web"):
                args += ["--build-arg", f"AKL_IMAGE_SERVICE={service}",
                         "--build-arg", f"NEXT_PUBLIC_AKL_BASE_PATH={'/akb' if service == 'web' else ''}"]
            result = subprocess.run(
                ["docker", "buildx", "build", "--check", "--platform", "linux/amd64",
                 "--network", "none", "--file", str(dockerfile), *args, str(context)],
                text=True, capture_output=True, timeout=180, check=False,
            )
            if result.returncode:
                # Do not forward arbitrary build output into audit summaries.
                raise ValueError(f"PRODUCTION_BUILD_DEFINITION_REJECTED:{service}")
            checks.append({"service": service, "dockerfile_sha256": hashlib.sha256(definition).hexdigest(),
                           "duration_ms": round((time.monotonic() - started) * 1000), "status": "passed"})
    return {"schema": "akb-production-build-inputs-1", "status": "passed", "checks": checks,
            "production_build_required": True, "release_authorized": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paths-file", type=Path, required=True)
    parser.add_argument("--source-date-epoch", type=int, required=True)
    args = parser.parse_args()
    paths = args.paths_file.read_text().splitlines()
    plan = plan_paths(paths)
    if any(path in {"scripts/ci/check_production_build_inputs.py", "tests/test_production_build_inputs.py"} for path in paths):
        plan = ImpactPlan().with_all_runtime()
    try:
        print(json.dumps(check_definitions(ROOT, plan, args.source_date_epoch), sort_keys=True))
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        code = str(exc) if isinstance(exc, ValueError) else "PRODUCTION_BUILD_CHECK_UNAVAILABLE"
        print(json.dumps({"schema": "akb-production-build-inputs-1", "status": "failed", "reason": code,
                          "production_build_required": True, "release_authorized": False}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
