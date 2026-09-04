#!/usr/bin/env python3
"""Classify an AKB change set for the trusted Gitea CI workflow.

Unknown paths deliberately select every runtime component.  The classifier is
an optimisation only: it must never make an uncertain change cheaper to test.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


RUNTIME_COMPONENTS = (
    "web",
    "registry_api",
    "ingestion_service",
    "rag_retrieval_service",
    "llm_gateway_service",
    "evaluation_service",
    "governance_service",
)


@dataclass(frozen=True)
class ImpactPlan:
    web: bool = False
    registry_api: bool = False
    ingestion_service: bool = False
    rag_retrieval_service: bool = False
    llm_gateway_service: bool = False
    evaluation_service: bool = False
    governance_service: bool = False
    compose: bool = False
    immutable_release: bool = False

    def with_all_runtime(self) -> "ImpactPlan":
        return ImpactPlan(
            **{component: True for component in RUNTIME_COMPONENTS},
            compose=True,
            immutable_release=True,
        )

    def updated(self, **values: bool) -> "ImpactPlan":
        current = self.as_dict()
        current.update(values)
        return ImpactPlan(**current)

    def as_dict(self) -> dict[str, bool]:
        return {
            "web": self.web,
            "registry_api": self.registry_api,
            "ingestion_service": self.ingestion_service,
            "rag_retrieval_service": self.rag_retrieval_service,
            "llm_gateway_service": self.llm_gateway_service,
            "evaluation_service": self.evaluation_service,
            "governance_service": self.governance_service,
            "compose": self.compose,
            "immutable_release": self.immutable_release,
        }


DOCUMENTATION_PREFIXES = ("docs/",)
DOCUMENTATION_FILES = {"README.md", "AGENTS.md", "CLAUDE.md", "LICENSE"}


def _impact_owner(raw_path: str) -> str | None:
    """Return one unambiguous owner, or ``full`` for uncertain/shared input."""

    path = str(PurePosixPath(raw_path.strip()))
    if not path or path == ".":
        return None
    if path in DOCUMENTATION_FILES or path.startswith(DOCUMENTATION_PREFIXES):
        return None
    if (
        path.startswith(".gitea/workflows/")
        or path.startswith("scripts/ci/")
        or path.startswith("infra/ci/local-fast-check/")
        or path in {
            "tests/test_ci_affected_components.py",
            "tests/test_ci_cached_python_env.py",
            "tests/test_clean_pilot_c4_registry.py",
            "tests/test_local_fast_check.py",
            "tests/test_working_baseline.py",
        }
    ):
        return "ci"
    if path.startswith("apps/web/") or path in {"package.json", "pnpm-lock.yaml"}:
        return "web"
    if path.startswith("services/registry-api/"):
        return "registry_api"
    if path.startswith("services/ingestion-service/"):
        return "ingestion_service"
    if path.startswith("services/rag-retrieval-service/"):
        return "rag_retrieval_service"
    if path.startswith("services/llm-gateway-service/"):
        return "llm_gateway_service"
    if path.startswith("services/evaluation-service/"):
        return "evaluation_service"
    if path.startswith("services/governance-service/"):
        return "governance_service"
    if path.startswith("infra/docker-compose/") or path in {
        ".env.example",
        ".env.local-prod.example",
    }:
        return "compose"
    if path in {
        "scripts/docling_local_smoke.py",
        "scripts/provision_docling_model_bundle.sh",
        "scripts/setup_docling_local.sh",
        "scripts/verify_docling_provision_source.py",
    }:
        return "docling_release"
    if path in {
        "scripts/check_docker_home_compose_render.sh",
        "tests/test_docling_production_release.py",
    }:
        return "docling_runtime_config"
    if path.startswith("infra/ci/") or path.startswith("scripts/lib/") or path in {
        "scripts/deploy_docker_home_release.sh",
        "scripts/deploy_docker_home.sh",
        "scripts/check_immutable_release_workflow.sh",
        "scripts/verify_docker_home_release.sh",
    }:
        return "immutable_release"
    if path.startswith("contracts/") or path.startswith("openapi/"):
        return "full"
    return "full"


def impact_profile(paths: Iterable[str]) -> str:
    """Describe why a change is narrow, empty, or forced to the full suite."""

    owners = {_impact_owner(path) for path in paths}
    owners.discard(None)
    if not owners or owners == {"ci"}:
        return "repository-only"
    if "full" in owners:
        return "full:unknown-or-shared"
    if owners == {"docling_release"}:
        return "narrow:docling_release"
    if owners and owners.issubset({"docling_release", "docling_runtime_config"}):
        return "narrow:docling_runtime_config"
    runtime = owners.intersection(RUNTIME_COMPONENTS)
    release = owners.intersection({"compose", "immutable_release"})
    if len(runtime) > 1 or (runtime and release) or ("ci" in owners and len(owners) > 1):
        return "full:mixed"
    if len(runtime) == 1:
        return f"narrow:{next(iter(runtime))}"
    if owners == {"compose"}:
        return "narrow:compose"
    if owners == {"immutable_release"}:
        return "narrow:immutable_release"
    return "full:mixed"


def plan_paths(paths: Iterable[str]) -> ImpactPlan:
    path_list = list(paths)
    profile = impact_profile(path_list)
    if profile.startswith("full:"):
        return ImpactPlan().with_all_runtime()

    owners = {_impact_owner(path) for path in path_list}
    owners.discard(None)
    plan = ImpactPlan()
    for owner in owners:
        if owner in RUNTIME_COMPONENTS:
            plan = plan.updated(**{owner: True})
        elif owner == "compose":
            plan = plan.updated(compose=True, immutable_release=True)
        elif owner == "immutable_release":
            plan = plan.updated(immutable_release=True)
        elif owner == "docling_release":
            plan = plan.updated(ingestion_service=True, immutable_release=True)
        elif owner == "docling_runtime_config":
            plan = plan.updated(
                ingestion_service=True,
                compose=True,
                immutable_release=True,
            )
    return plan


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths_file", help="newline-delimited changed paths")
    parser.add_argument(
        "--github-output",
        help="write Gitea/GitHub Actions output syntax to this file",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    paths = Path(args.paths_file).read_text(encoding="utf-8").splitlines()
    plan = plan_paths(paths)
    rendered = "\n".join(
        f"{key}={'true' if value else 'false'}" for key, value in plan.as_dict().items()
    ) + "\n"
    if args.github_output:
        Path(args.github_output).write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
