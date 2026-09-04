from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/ci"))

from ensure_cached_python_test_env import (  # noqa: E402
    CachedEnvironmentError,
    ensure_environment,
    load_service,
    main,
    validate_cache_root,
)


class CachedPythonEnvironmentTests(unittest.TestCase):
    def test_repository_manifest_is_closed_and_hash_bound(self) -> None:
        document = json.loads(
            (ROOT / "scripts/ci/gitea-python-test-locks.json").read_text()
        )
        self.assertEqual(set(document), {"python", "schema", "services"})
        self.assertEqual(
            set(document["services"]),
            {
                "evaluation_service",
                "governance_service",
                "ingestion_service",
                "llm_gateway_service",
                "rag_retrieval_service",
                "registry_api",
            },
        )
        for entry in document["services"].values():
            self.assertEqual(
                set(entry), {"input", "input_sha256", "lock", "lock_sha256"}
            )
            for path_key, digest_key in (("input", "input_sha256"), ("lock", "lock_sha256")):
                payload = (ROOT / entry[path_key]).read_bytes()
                self.assertEqual(hashlib.sha256(payload).hexdigest(), entry[digest_key])

    def test_unknown_service_and_open_manifest_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "python": f"{sys.version_info.major}.{sys.version_info.minor}",
                        "schema": "akb-gitea-python-test-locks-1",
                        "services": {},
                    }
                )
            )
            with self.assertRaisesRegex(CachedEnvironmentError, "SERVICE_UNKNOWN"):
                load_service(manifest, "missing")
            payload = json.loads(manifest.read_text())
            payload["unexpected"] = True
            manifest.write_text(json.dumps(payload))
            with self.assertRaisesRegex(CachedEnvironmentError, "MANIFEST_NOT_CLOSED"):
                load_service(manifest, "missing")

    def test_environment_is_ephemeral_and_uses_copied_interpreter(self) -> None:
        entry = {
            "input": "unused",
            "input_sha256": "b" * 64,
            "lock": "unused.lock",
            "lock_sha256": "a" * 64,
        }
        with tempfile.TemporaryDirectory() as temporary:
            cache_root = Path(temporary) / "akb" / "python-envs"

            commands: list[tuple[str, ...]] = []

            def fake_run(
                command: tuple[str, ...], *, check: bool, stdout: object
            ) -> None:
                self.assertTrue(check)
                self.assertIs(stdout, sys.stderr)
                commands.append(command)
                if command[1:4] == ("-m", "venv", "--copies"):
                    environment = Path(command[4])
                    (environment / "bin").mkdir(parents=True)
                    (environment / "bin/python").write_text("")

            with mock.patch(
                "ensure_cached_python_test_env.load_service", return_value=entry
            ), mock.patch(
                "ensure_cached_python_test_env.validate_entry",
                return_value=ROOT / "requirements.lock",
            ), mock.patch(
                "ensure_cached_python_test_env.subprocess.run", side_effect=fake_run
            ):
                environment, status = ensure_environment("registry_api", cache_root)

            self.assertEqual(status, "pip-cache-backed")
            self.assertEqual(environment.parent, cache_root.resolve())
            self.assertIn("--copies", commands[0])
            self.assertEqual(commands[-1][1:3], ("-I", "-c"))
            self.assertFalse((environment / ".akb-ci-environment.json").exists())

    def test_cache_root_must_be_absolute_and_scoped(self) -> None:
        with self.assertRaisesRegex(CachedEnvironmentError, "NOT_ABSOLUTE"):
            validate_cache_root(Path("relative"))
        with self.assertRaisesRegex(CachedEnvironmentError, "UNSAFE"):
            validate_cache_root(Path("/tmp"))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "akb" / "python-envs"
            self.assertEqual(validate_cache_root(root), root.resolve())

    def test_workflow_pins_tools_and_uses_isolated_ephemeral_envs(self) -> None:
        workflow = (ROOT / ".gitea/workflows/ci.yaml").read_text()
        self.assertIn("NPM_CONFIG_CACHE: /cache/akb-ci/npm", workflow)
        self.assertIn("PIP_CACHE_DIR: /cache/akb-ci/pip", workflow)
        self.assertIn("AKB_CI_PYTHON_ENV_ROOT: /tmp/akb-ci/python-envs", workflow)
        self.assertIn("@redocly/cli@2.51.1", workflow)
        self.assertNotIn("npx --yes @redocly/cli lint", workflow)
        self.assertNotIn("pip install --upgrade pip", workflow)
        self.assertIn("pytest==9.1.1", workflow)
        self.assertIn("--validate-only", workflow)
        self.assertIn("python3 tests/test_ci_cached_python_env.py", workflow)
        for service in (
            "registry_api",
            "ingestion_service",
            "rag_retrieval_service",
            "llm_gateway_service",
            "evaluation_service",
            "governance_service",
        ):
            self.assertIn(f"--service {service}", workflow)
        self.assertNotIn('${python_env}/bin/activate', workflow)
        self.assertEqual(workflow.count('${python_env}/bin/python" -m pytest'), 6)
        self.assertEqual(workflow.count("trap 'rm -rf \"${python_env}\"' EXIT"), 6)

    def test_validate_only_does_not_create_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            cache_root = Path(temporary) / "akb" / "python-envs"
            with mock.patch(
                "sys.argv",
                [
                    "ensure_cached_python_test_env.py",
                    "--service",
                    "registry_api",
                    "--cache-root",
                    str(cache_root),
                    "--validate-only",
                ],
            ), mock.patch(
                "ensure_cached_python_test_env.sys.version_info",
                SimpleNamespace(major=3, minor=11, micro=0),
            ):
                self.assertEqual(main(), 0)
            self.assertFalse(cache_root.exists())


if __name__ == "__main__":
    unittest.main()
