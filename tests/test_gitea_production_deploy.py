from __future__ import annotations

import importlib.util
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
GATE_PATH = ROOT / "infra/ci/gitea-runner/check_production_deploy_gate.py"
GATE_SPEC = importlib.util.spec_from_file_location("production_gate", GATE_PATH)
assert GATE_SPEC and GATE_SPEC.loader
production_gate = importlib.util.module_from_spec(GATE_SPEC)
GATE_SPEC.loader.exec_module(production_gate)


class ProductionGateTests(unittest.TestCase):
    def test_trusted_ci_requires_push_success_and_exact_sha(self) -> None:
        sha = "a" * 40
        valid = {
            "head_sha": sha,
            "event": "push",
            "conclusion": "success",
            "path": ".gitea/workflows/ci.yaml",
        }
        self.assertTrue(production_gate.is_trusted_ci_run(valid, sha))
        for key, value in (
            ("head_sha", "b" * 40),
            ("event", "workflow_dispatch"),
            ("conclusion", "failure"),
            ("path", ".gitea/workflows/deploy-production.yaml"),
            ("head_branch", "feature/untrusted"),
        ):
            changed = {**valid, key: value}
            self.assertFalse(production_gate.is_trusted_ci_run(changed, sha))

    def test_gate_requires_current_main_and_matching_successful_ci(self) -> None:
        sha = "c" * 40
        with tempfile.TemporaryDirectory() as directory:
            token_file = Path(directory) / "token"
            token_file.write_text("redacted", encoding="utf-8")
            token_file.chmod(stat.S_IRUSR | stat.S_IWUSR)
            args = type(
                "Args",
                (),
                {
                    "sha": sha,
                    "repository": "AKB/ai-knowledgebase",
                    "gitea_url": "https://git.home.cz",
                    "token_file": token_file,
                },
            )()
            responses = [
                {"commit": {"id": sha}},
                {
                    "workflow_runs": [
                        {
                            "id": 74,
                            "head_sha": sha,
                            "event": "push",
                            "status": "success",
                            "name": "AKB CI",
                        }
                    ]
                },
            ]
            with patch.object(production_gate, "get_json", side_effect=responses):
                self.assertEqual(production_gate.verify_gate(args), 0)

    def test_gate_rejects_missing_ci_and_token_symlink(self) -> None:
        sha = "d" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            token_file = root / "token"
            token_file.write_text("redacted", encoding="utf-8")
            token_file.chmod(stat.S_IRUSR | stat.S_IWUSR)
            token_link = root / "token-link"
            token_link.symlink_to(token_file)
            with self.assertRaises(RuntimeError):
                production_gate.read_token(token_link)

            args = type(
                "Args",
                (),
                {
                    "sha": sha,
                    "repository": "AKB/ai-knowledgebase",
                    "gitea_url": "https://git.home.cz",
                    "token_file": token_file,
                },
            )()
            responses = [{"commit": {"id": sha}}, {"workflow_runs": []}]
            with patch.object(production_gate, "get_json", side_effect=responses):
                with self.assertRaises(RuntimeError):
                    production_gate.verify_gate(args)

    def test_gateway_rejects_unrecognized_command(self) -> None:
        gateway = ROOT / "infra/ci/gitea-runner/host/akb-gitea-deploy-gateway.sh"
        result = subprocess.run(
            ["bash", str(gateway), "shell", "anything"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("anything", result.stderr)

    def test_gateway_detached_worker_drops_forced_command_context(self) -> None:
        gateway = (
            ROOT / "infra/ci/gitea-runner/host/akb-gitea-deploy-gateway.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("env -u SSH_ORIGINAL_COMMAND setsid", gateway)

    def test_deploy_workflow_is_manual_and_uses_only_restricted_secrets(self) -> None:
        workflow = (ROOT / ".gitea/workflows/deploy-production.yaml").read_text(
            encoding="utf-8"
        )
        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("\n  push:", workflow)
        self.assertIn("runs-on: akb-gitea-ci", workflow)
        self.assertIn("secrets.AKB_PRODUCTION_DEPLOY_SSH_KEY", workflow)
        self.assertIn("secrets.AKB_PRODUCTION_DEPLOY_KNOWN_HOSTS", workflow)
        self.assertNotIn("AKL_PROD_ENV", workflow)
        self.assertNotIn("secrets.GITHUB_TOKEN", workflow)


if __name__ == "__main__":
    unittest.main()
