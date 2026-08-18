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


def plan_paths(paths: Iterable[str]) -> ImpactPlan:
    plan = ImpactPlan()
    for raw_path in paths:
        path = str(PurePosixPath(raw_path.strip()))
        if not path or path == ".":
            continue
        if path in DOCUMENTATION_FILES or path.startswith(DOCUMENTATION_PREFIXES):
            continue
        if path.startswith(".gitea/workflows/") or path.startswith("scripts/ci/") or path == (
            "tests/test_ci_affected_components.py"
        ):
            # CI plumbing has no production runtime owner. Repository standards
            # validate the workflow and classifier; release simulation is not
            # relevant unless production release code also changed.
            continue
        if path.startswith("apps/web/"):
            plan = plan.updated(web=True)
        elif path.startswith("services/registry-api/"):
            plan = plan.updated(registry_api=True)
        elif path.startswith("services/ingestion-service/"):
            plan = plan.updated(ingestion_service=True)
        elif path.startswith("services/rag-retrieval-service/"):
            plan = plan.updated(rag_retrieval_service=True)
        elif path.startswith("services/llm-gateway-service/"):
            plan = plan.updated(llm_gateway_service=True)
        elif path.startswith("services/evaluation-service/"):
            plan = plan.updated(evaluation_service=True)
        elif path.startswith("services/governance-service/"):
            plan = plan.updated(governance_service=True)
        elif path.startswith("infra/docker-compose/") or path in {
            ".env.example",
            ".env.local-prod.example",
        }:
            plan = plan.updated(compose=True, immutable_release=True)
        elif path.startswith("infra/ci/") or path.startswith("scripts/lib/") or path in {
            "scripts/deploy_docker_home_release.sh",
            "scripts/deploy_docker_home.sh",
            "scripts/check_immutable_release_workflow.sh",
            "scripts/verify_docker_home_release.sh",
        }:
            plan = plan.updated(immutable_release=True)
        elif path.startswith("contracts/") or path.startswith("openapi/"):
            return plan.with_all_runtime()
        elif path in {"package.json", "pnpm-lock.yaml"}:
            plan = plan.updated(web=True)
        else:
            return plan.with_all_runtime()
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
