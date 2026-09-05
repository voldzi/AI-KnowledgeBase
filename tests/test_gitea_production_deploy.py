from __future__ import annotations

import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile
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
    @staticmethod
    def _docker_archive(sha: str, *, extra: bool = False) -> bytes:
        services = ["registry-api", "ingestion-service", "rag-retrieval-service", "evaluation-service", "governance-service", "llm-gateway-service", "web", "chat-web"]
        manifest = [{"Config": f"{index}.json", "RepoTags": [f"akl/{service}:{sha}"], "Layers": []} for index, service in enumerate(services)]
        if extra:
            manifest.append({"Config": "extra.json", "RepoTags": [f"akl/unexpected:{sha}"], "Layers": []})
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as archive:
            data = json.dumps(manifest).encode()
            info = tarfile.TarInfo("manifest.json")
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        return output.getvalue()

    def test_gateway_accepts_only_exact_prebuilt_image_set(self) -> None:
        sha = "a" * 40
        gateway = ROOT / "infra/ci/gitea-runner/host/akb-gitea-deploy-gateway.sh"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            docker = fake_bin / "docker"
            docker.write_text("""#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 ${2:-}" == "image inspect" ]]; then
  [[ -f "$FAKE_DOCKER_STATE" ]] || exit 1
  service="${@: -1}"; service="${service#akl/}"; service="${service%%:*}"
  if [[ "$*" == *org.opencontainers.image.revision* ]]; then printf '%s\\n' "$FAKE_SHA"
  elif [[ "$*" == *cz.zeleznalady.akl.compose-project* ]]; then printf 'akl\\n'
  elif [[ "$*" == *cz.zeleznalady.akl.service* ]]; then printf '%s\\n' "$service"
  fi
elif [[ "$1" == "load" ]]; then cat >/dev/null; touch "$FAKE_DOCKER_STATE"
else exit 2
fi
""")
            docker.chmod(0o755)
            timeout = fake_bin / "timeout"
            timeout.write_text("#!/usr/bin/env bash\nshift\nexec \"$@\"\n")
            timeout.chmod(0o755)
            sync = fake_bin / "sync"
            sync.write_text("#!/usr/bin/env bash\nexit 0\n")
            sync.chmod(0o755)
            environment = {
                **os.environ,
                "AKB_GATEWAY_TEST_MODE": "1",
                "AKL_RELEASE_ROOT": str(root / "release"),
                "PATH": f"{fake_bin}:{os.environ['PATH']}",
                "FAKE_SHA": sha,
                "FAKE_DOCKER_STATE": str(root / "docker-loaded"),
            }
            archive = self._docker_archive(sha)
            result = subprocess.run(
                ["bash", str(gateway), "import", sha, hashlib.sha256(archive).hexdigest()],
                input=archive, capture_output=True, env=environment,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            marker = root / "release/prebuilt" / f"{sha}.env"
            self.assertTrue(marker.is_file())
            self.assertEqual(marker.stat().st_mode & 0o077, 0)

            other_sha = "b" * 40
            (root / "docker-loaded").unlink()
            bad_archive = self._docker_archive(other_sha, extra=True)
            bad = subprocess.run(
                ["bash", str(gateway), "import", other_sha, hashlib.sha256(bad_archive).hexdigest()],
                input=bad_archive, capture_output=True, env={**environment, "FAKE_SHA": other_sha},
            )
            self.assertNotEqual(bad.returncode, 0)
            self.assertFalse((root / "release/prebuilt" / f"{other_sha}.env").exists())

    def test_api_client_uses_system_ca_without_token_in_process_args(self) -> None:
        token = "a" * 40

        def run_curl(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            self.assertNotIn(token, " ".join(command))
            config_path = Path(command[command.index("--config") + 1])
            self.assertEqual(config_path.stat().st_mode & 0o077, 0)
            self.assertIn(token, config_path.read_text(encoding="utf-8"))
            return subprocess.CompletedProcess(
                command,
                0,
                stdout='{"ok": true}',
                stderr="",
            )

        with (
            patch.object(production_gate.shutil, "which", return_value="/usr/bin/curl"),
            patch.object(production_gate.subprocess, "run", side_effect=run_curl),
        ):
            self.assertEqual(
                production_gate.get_json("https://git.home.cz/api/v1/version", token),
                {"ok": True},
            )

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

        gitea_run = {
            **valid,
            "path": "ci.yaml@refs/heads/main",
            "head_branch": "main",
        }
        self.assertTrue(production_gate.is_trusted_ci_run(gitea_run, sha))
        self.assertFalse(
            production_gate.is_trusted_ci_run(
                {**gitea_run, "path": "deploy-production.yaml@refs/heads/main"},
                sha,
            )
        )

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

    def test_gate_accepts_gitea_aggregate_failure_only_when_all_jobs_succeed(self) -> None:
        sha = "e" * 40
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
            aggregate_failure = {
                "id": 75,
                "head_sha": sha,
                "event": "push",
                "conclusion": "failure",
                "path": "ci.yaml@refs/heads/main",
                "head_branch": "main",
            }
            responses = [
                {"commit": {"id": sha}},
                {"workflow_runs": [aggregate_failure]},
                {"jobs": [{"conclusion": "success"}, {"status": "success"}]},
            ]
            with patch.object(production_gate, "get_json", side_effect=responses):
                self.assertEqual(production_gate.verify_gate(args), 0)

    def test_gate_rejects_gitea_aggregate_failure_with_any_non_success_job(self) -> None:
        sha = "f" * 40
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
            aggregate_failure = {
                "id": 76,
                "head_sha": sha,
                "event": "push",
                "conclusion": "failure",
                "path": "ci.yaml@refs/heads/main",
                "head_branch": "main",
            }
            responses = [
                {"commit": {"id": sha}},
                {"workflow_runs": [aggregate_failure]},
                {"jobs": [{"conclusion": "success"}, {"conclusion": "failure"}]},
            ]
            with patch.object(production_gate, "get_json", side_effect=responses):
                with self.assertRaises(RuntimeError):
                    production_gate.verify_gate(args)

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

    def test_prebuilt_import_is_closed_and_production_build_is_skipped(self) -> None:
        gateway = (ROOT / "infra/ci/gitea-runner/host/akb-gitea-deploy-gateway.sh").read_text()
        deploy = (ROOT / "scripts/deploy_docker_home_release.sh").read_text()
        publisher = (ROOT / "scripts/ci/publish_production_images.sh").read_text()
        workflow = (ROOT / ".gitea/workflows/deploy-production.yaml").read_text()

        self.assertIn('[[ "$archive_sha" =~ ^[0-9a-f]{64}$ ]]', gateway)
        self.assertIn('timeout 900 dd bs=1M', gateway)
        self.assertIn('gzip -t "$archive"', gateway)
        self.assertIn('schema=akb-prebuilt-image-import-1', gateway)
        self.assertIn('[[ "$revision" == "$release_sha"', gateway)
        self.assertIn('PREBUILT_IMAGES="true"', deploy)
        self.assertIn('if [[ "$PREBUILT_IMAGES" != "true" ]]; then', deploy)
        self.assertIn('Using prebuilt immutable images', deploy)
        self.assertIn('akb-production-image-manifest-1', publisher)
        self.assertEqual(publisher.count('build_image '), 8)
        self.assertIn('if docker pull "$target"', publisher)
        self.assertIn('Existing immutable image provenance is invalid', publisher)
        self.assertIn('docker save "${image_tags[@]}" | gzip -n', workflow)
        self.assertIn('akb-production-images-${{ github.sha }}', workflow)
        self.assertIn('verify_gitea_action_artifact.py', workflow)
        self.assertIn('"import ${RELEASE_SHA} ${archive_sha}"', workflow)
        self.assertLess(workflow.index("Require successful trusted main CI"), workflow.index("Build and publish immutable production images once"))
        self.assertLess(workflow.index("Build and publish immutable production images once"), workflow.index('"import ${RELEASE_SHA} ${archive_sha}"'))
        self.assertLess(workflow.index('"import ${RELEASE_SHA} ${archive_sha}"'), workflow.index('"deploy ${RELEASE_SHA}"'))

    def test_deploy_workflow_is_manual_and_uses_only_restricted_secrets(self) -> None:
        workflow = (ROOT / ".gitea/workflows/deploy-production.yaml").read_text(
            encoding="utf-8"
        )
        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("\n  push:", workflow)
        self.assertIn("runs-on: akb-gitea-ci", workflow)
        self.assertIn("GITEA_TOKEN: ${{ github.token }}", workflow)
        self.assertIn(
            "GITEA_TOKEN: ${{ secrets.AKB_GITEA_RELEASE_GATE_TOKEN }}",
            workflow,
        )
        self.assertIn("Gitea release-gate token is not configured.", workflow)
        self.assertIn("secrets.AKB_PRODUCTION_DEPLOY_SSH_KEY", workflow)
        self.assertIn("secrets.AKB_PRODUCTION_DEPLOY_KNOWN_HOSTS", workflow)
        self.assertIn("secrets.AKB_GITEA_PACKAGE_RW_TOKEN", workflow)
        self.assertIn("command -v ssh", workflow)
        self.assertIn("apt-get install -y -qq --no-install-recommends openssh-client", workflow)
        self.assertNotIn("AKL_PROD_ENV", workflow)
        self.assertNotIn("secrets.GITHUB_TOKEN", workflow)

        runner_dockerfile = (ROOT / "infra/ci/gitea-runner/Dockerfile").read_text(
            encoding="utf-8"
        )
        self.assertIn("openssh-client", runner_dockerfile)
        self.assertIn(
            "COPY --from=docker_cli /usr/local/libexec/docker/cli-plugins/docker-buildx ",
            runner_dockerfile,
        )
        self.assertIn("docker buildx version", runner_dockerfile)


    def test_release_classifier_ignores_only_declared_external_keycloak_sources(self) -> None:
        deploy_script = (ROOT / "scripts/deploy_docker_home_release.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "infra/keycloak/README.md|infra/keycloak/realm-akl.json|"
            "infra/keycloak/realm-stratos.json|"
            "infra/keycloak/update-stratos-public-routing.sh)",
            deploy_script,
        )
        self.assertIn(
            "services/*|apps/*|infra/reverse-proxy/*|infra/keycloak/*|",
            deploy_script,
        )
        self.assertIn("Release changes unsupported runtime path", deploy_script)


if __name__ == "__main__":
    unittest.main()
