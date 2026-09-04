from __future__ import annotations

import sys
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ci"))

from affected_components import RUNTIME_COMPONENTS, impact_profile, plan_paths  # noqa: E402


class AffectedComponentsTests(unittest.TestCase):
    def test_documentation_only_skips_runtime_jobs(self) -> None:
        self.assertEqual(
            plan_paths(["docs/operations.md", "README.md"]).as_dict(),
            {
                **{component: False for component in RUNTIME_COMPONENTS},
                "compose": False,
                "immutable_release": False,
            },
        )

    def test_ci_plumbing_uses_repository_standards_only(self) -> None:
        plan = plan_paths(
            [
                ".gitea/workflows/ci.yaml",
                "scripts/ci/affected_components.py",
                "tests/test_ci_affected_components.py",
                "tests/test_clean_pilot_c4_registry.py",
                "tests/test_working_baseline.py",
                "infra/ci/local-fast-check/Dockerfile.python",
            ]
        )
        self.assertEqual(
            plan.as_dict(),
            {
                **{component: False for component in RUNTIME_COMPONENTS},
                "compose": False,
                "immutable_release": False,
            },
        )

    def test_web_change_selects_only_web(self) -> None:
        plan = plan_paths(["apps/web/src/app/api/auth/login/route.ts"])
        self.assertTrue(plan.web)
        self.assertFalse(plan.registry_api)
        self.assertFalse(plan.compose)

    def test_service_change_selects_its_owner(self) -> None:
        plan = plan_paths(["services/rag-retrieval-service/app/main.py"])
        self.assertTrue(plan.rag_retrieval_service)
        self.assertFalse(plan.web)
        self.assertFalse(plan.registry_api)

    def test_release_contract_change_selects_contract_check_only(self) -> None:
        plan = plan_paths(["scripts/deploy_docker_home_release.sh"])
        self.assertTrue(plan.immutable_release)
        self.assertFalse(plan.web)
        self.assertFalse(plan.compose)

    def test_docling_release_paths_select_only_ingestion_release_surface(self) -> None:
        plan = plan_paths(
            [
                "scripts/provision_docling_model_bundle.sh",
                "scripts/prepare_docling_provision_mount.py",
                "scripts/docling_local_smoke.py",
                "scripts/setup_docling_local.sh",
                "scripts/verify_docling_provision_source.py",
                "scripts/check_docker_home_compose_render.sh",
                "tests/test_docling_production_release.py",
            ]
        )
        self.assertTrue(plan.ingestion_service)
        self.assertTrue(plan.compose)
        self.assertTrue(plan.immutable_release)
        self.assertFalse(plan.web)
        self.assertFalse(plan.registry_api)
        self.assertFalse(plan.rag_retrieval_service)
        self.assertFalse(plan.llm_gateway_service)
        self.assertFalse(plan.evaluation_service)
        self.assertFalse(plan.governance_service)

    def test_ci_and_docling_paths_fail_closed_to_full_ci(self) -> None:
        paths = [
            "scripts/ci/check_clean_pilot_c4_inputs.py",
            "scripts/provision_docling_model_bundle.sh",
        ]
        self.assertEqual(impact_profile(paths), "full:mixed")
        self.assertTrue(all(plan_paths(paths).as_dict().values()))

    def test_unknown_or_shared_change_fails_closed_to_full_ci(self) -> None:
        plan = plan_paths(["pyproject.toml"])
        self.assertTrue(all(plan.as_dict()[component] for component in RUNTIME_COMPONENTS))
        self.assertTrue(plan.compose)
        self.assertTrue(plan.immutable_release)

    def test_multiple_runtime_owners_fail_closed_to_full_ci(self) -> None:
        paths = [
            "apps/web/src/app/page.tsx",
            "services/rag-retrieval-service/app/main.py",
        ]
        plan = plan_paths(paths)
        self.assertEqual(impact_profile(paths), "full:mixed")
        self.assertTrue(all(plan.as_dict().values()))

    def test_runtime_and_release_change_fail_closed_to_full_ci(self) -> None:
        paths = [
            "services/registry-api/app/main.py",
            "scripts/deploy_docker_home_release.sh",
        ]
        self.assertEqual(impact_profile(paths), "full:mixed")
        self.assertTrue(all(plan_paths(paths).as_dict().values()))

    def test_ci_and_runtime_change_fail_closed_to_full_ci(self) -> None:
        paths = [
            "scripts/ci/local_fast_check.py",
            "services/registry-api/app/main.py",
        ]
        self.assertEqual(impact_profile(paths), "full:mixed")
        self.assertTrue(all(plan_paths(paths).as_dict().values()))


if __name__ == "__main__":
    unittest.main()
