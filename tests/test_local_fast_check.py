from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ci"))

from affected_components import impact_profile, plan_paths  # noqa: E402
from local_fast_check import (  # noqa: E402
    LocalCheckError,
    create_sanitized_snapshot,
    image_tag,
    isolated_docker_run_prefix,
    PYTHON_SERVICES,
    validate_dependency_binding,
    validate_web_scripts,
    validate_summary,
)


class LocalFastCheckTests(unittest.TestCase):
    def test_narrow_change_selects_one_service(self) -> None:
        paths = ["services/ingestion-service/app/main.py", "docs/operations.md"]
        plan = plan_paths(paths)
        self.assertEqual(impact_profile(paths), "narrow:ingestion_service")
        self.assertTrue(plan.ingestion_service)
        self.assertEqual(sum(plan.as_dict().values()), 1)

    def test_mixed_and_unknown_changes_select_full_suite(self) -> None:
        mixed = ["apps/web/src/app/page.tsx", "services/registry-api/app/main.py"]
        self.assertEqual(impact_profile(mixed), "full:mixed")
        self.assertTrue(all(plan_paths(mixed).as_dict().values()))
        self.assertEqual(impact_profile(["unowned/new-runtime.txt"]), "full:unknown-or-shared")
        self.assertTrue(all(plan_paths(["unowned/new-runtime.txt"]).as_dict().values()))

    def test_snapshot_excludes_ignored_env_and_rejects_private_key(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary) / "repo"
            snapshot = Path(temporary) / "snapshot"
            repo.mkdir()
            snapshot.mkdir()
            subprocess.run(("git", "init", "-q"), cwd=repo, check=True)
            subprocess.run(("git", "config", "user.name", "AKB test"), cwd=repo, check=True)
            subprocess.run(("git", "config", "user.email", "test@example.invalid"), cwd=repo, check=True)
            (repo / ".gitignore").write_text(".env\n", encoding="utf-8")
            (repo / "safe.txt").write_text("safe\n", encoding="utf-8")
            (repo / ".env").write_text("SHOULD_NOT_BE_READ=1\n", encoding="utf-8")
            subprocess.run(("git", "add", ".gitignore", "safe.txt"), cwd=repo, check=True)
            create_sanitized_snapshot(repo, snapshot)
            self.assertTrue((snapshot / "safe.txt").is_file())
            self.assertFalse((snapshot / ".env").exists())
            shutil.rmtree(snapshot)
            snapshot.mkdir()
            (repo / "identity.key").write_text("not-a-real-key\n", encoding="utf-8")
            with self.assertRaisesRegex(LocalCheckError, "LOCAL_CI_FORBIDDEN_SOURCE_FILE"):
                create_sanitized_snapshot(repo, snapshot)

    def test_container_command_is_networkless_read_only_and_unprivileged(self) -> None:
        command = isolated_docker_run_prefix(Path("/tmp/source"), "linux/arm64")
        rendered = " ".join(command)
        for required in (
            "--network none",
            "--read-only",
            "--cap-drop ALL",
            "no-new-privileges:true",
            "dst=/source,readonly",
            "--user 65532:65532",
        ):
            self.assertIn(required, rendered)
        for forbidden in ("--env-file", "docker.sock", ".ssh", "deploy_docker_home"):
            self.assertNotIn(forbidden, rendered)

    def test_image_identity_is_independent_of_temporary_snapshot_root(self) -> None:
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            first_input = Path(first) / "requirements.lock"
            second_input = Path(second) / "requirements.lock"
            first_input.write_text("pytest==9.1.1 --hash=sha256:test\n")
            second_input.write_bytes(first_input.read_bytes())
            self.assertEqual(
                image_tag("service", "linux/arm64", (first_input,)),
                image_tag("service", "linux/arm64", (second_input,)),
            )

    def test_summary_is_closed_and_requires_trusted_ci(self) -> None:
        summary = {
            "schema": "akb-local-fast-check-1",
            "commit": "a" * 40,
            "working_tree_dirty": False,
            "base": "b" * 40,
            "snapshot_sha256": "c" * 64,
            "impact_profile": "narrow:web",
            "platform": "linux/arm64",
            "status": "passed",
            "checks": [{"id": "web", "status": "passed", "duration_ms": 1, "cache": "hit", "image_digest": "sha256:" + "d" * 64}],
            "total_duration_ms": 2,
            "cache": {"mode": "build-on-miss", "image_hits": 1, "image_misses": 0, "buildkit_scopes": "separate-per-service", "automatic_prune": False},
            "trusted_gitea_ci_required": True,
        }
        validate_summary(summary)
        summary["unexpected"] = "no"
        with self.assertRaisesRegex(LocalCheckError, "SUMMARY_SCHEMA_INVALID"):
            validate_summary(summary)

    def test_web_script_drift_is_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "package.json"
            package.write_text(json.dumps({"scripts": {"build": "unsafe"}}))
            with self.assertRaisesRegex(LocalCheckError, "LOCAL_CI_WEB_SCRIPT_DRIFT"):
                validate_web_scripts(package)

    def test_python_input_and_lock_are_cryptographically_bound(self) -> None:
        for spec in PYTHON_SERVICES:
            validate_dependency_binding(spec, ROOT)
        spec = PYTHON_SERVICES[0]
        with tempfile.TemporaryDirectory() as temporary:
            snapshot = Path(temporary) / "snapshot"
            shutil.copytree(ROOT / "infra", snapshot / "infra")
            target = snapshot / spec.dependency_input
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / spec.dependency_input, target)
            target.write_text(target.read_text() + "\n# drift\n")
            with self.assertRaisesRegex(LocalCheckError, "LOCAL_CI_DEPENDENCY_INPUT_DRIFT"):
                validate_dependency_binding(spec, snapshot)

    def test_local_entrypoint_cannot_authorize_release(self) -> None:
        source = (ROOT / "scripts/ci/local_fast_check.py").read_text(encoding="utf-8")
        self.assertNotIn("ssh docker.home.cz", source)
        self.assertIn('run(("bash", "-n", script)', source)
        self.assertIn("trusted_gitea_ci_required\": True", source)
        self.assertIn("AKB_LOCAL_FAST_CHECK_TESTING", source)
        workflow = (ROOT / ".gitea/workflows/ci.yaml").read_text(encoding="utf-8")
        self.assertIn("Persist same-SHA CI evidence", workflow)
        self.assertIn("akb-gitea-ci-evidence-${{ github.sha }}", workflow)

    def test_schema_is_valid_json_and_closed(self) -> None:
        schema = json.loads(
            (ROOT / "infra/ci/local-fast-check/local-fast-check-summary.schema.json").read_text()
        )
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(schema["properties"]["trusted_gitea_ci_required"]["const"], True)


if __name__ == "__main__":
    unittest.main()
