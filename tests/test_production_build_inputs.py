from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/ci"))
from affected_components import plan_paths
from check_production_build_inputs import check_definitions, selected_definitions


class ProductionBuildInputsTests(unittest.TestCase):
    def test_impact_selection_is_fail_closed(self):
        self.assertEqual(len(selected_definitions(plan_paths(["unknown/runtime"]))), 8)
        self.assertEqual(len(selected_definitions(plan_paths(["infra/docker-compose/changed.yml"]))), 8)
        self.assertEqual(len(selected_definitions(plan_paths(["services/registry-api/app/main.py"]))), 1)
        self.assertEqual(len(selected_definitions(plan_paths(["apps/web/page.tsx"]))), 2)
        self.assertEqual(selected_definitions(plan_paths(["docs/operations.md"])), [])

    def test_no_credentials_or_source_are_sent_and_no_image_is_published(self):
        def run(command, **kwargs):
            context = Path(command[-1])
            self.assertEqual([p.name for p in context.iterdir()], ["Dockerfile"])
            for flag in ("--check", "linux/amd64", "none"):
                self.assertIn(flag, command)
            for flag in ("--load", "--push", "--secret", "--ssh", "--env-file", "--tag"):
                self.assertNotIn(flag, command)
            return subprocess.CompletedProcess(command, 0, "", "")
        with patch("check_production_build_inputs.subprocess.run", side_effect=run):
            result = check_definitions(ROOT, plan_paths(["apps/web/page.tsx"]), 1)
        self.assertEqual(set(result), {"schema", "status", "checks", "production_build_required", "release_authorized"})
        self.assertFalse(result["release_authorized"])
        self.assertTrue(result["production_build_required"])

    def test_docker_failure_stops_instead_of_falling_back_to_text_checks(self):
        with patch("check_production_build_inputs.subprocess.run", return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaisesRegex(ValueError, "REJECTED:registry-api"):
                check_definitions(ROOT, plan_paths(["services/registry-api/Dockerfile"]), 1)

    def test_epoch_missing_file_and_symlink_fail_closed(self):
        plan = plan_paths(["services/registry-api/Dockerfile"])
        with self.assertRaisesRegex(ValueError, "EPOCH_INVALID"):
            check_definitions(ROOT, plan, 0)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "MISSING_OR_SYMLINK"):
                check_definitions(root, plan, 1)
            target = root / "services/registry-api/Dockerfile"
            target.parent.mkdir(parents=True)
            target.symlink_to(ROOT / "services/registry-api/Dockerfile")
            with self.assertRaisesRegex(ValueError, "MISSING_OR_SYMLINK"):
                check_definitions(root, plan, 1)

    def test_ci_check_is_inside_required_impact_gate(self):
        workflow = (ROOT / ".gitea/workflows/ci.yaml").read_text()
        impact = workflow.split("  impact:", 1)[1].split("  standards:", 1)[0]
        self.assertIn("check_production_build_inputs.py", impact)
        immutable = workflow.split("  immutable-release:", 1)[1].split("  web:", 1)[0]
        self.assertIn("needs: [trusted-candidate, impact]", immutable)
        self.assertIn("check_same_sha_ci_gate.py", workflow)

    @unittest.skipUnless(os.environ.get("AKB_REAL_BUILDX_CHECK") == "1", "explicit local Docker integration test")
    def test_real_buildx_rejects_double_backslash_and_accepts_correct_definition(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "services/registry-api/Dockerfile"
            target.parent.mkdir(parents=True)
            plan = plan_paths(["services/registry-api/Dockerfile"])
            target.write_text("FROM scratch\nENV PIP_DEFAULT_TIMEOUT=300 " + "\\" * 2 + "\n    PIP_RETRIES=8\n")
            with self.assertRaisesRegex(ValueError, "REJECTED:registry-api"):
                check_definitions(root, plan, 1)
            target.write_text("FROM scratch\nENV PIP_DEFAULT_TIMEOUT=300 " + "\\" + "\n    PIP_RETRIES=8\n")
            self.assertEqual(check_definitions(root, plan, 1)["status"], "passed")


if __name__ == "__main__":
    unittest.main()
