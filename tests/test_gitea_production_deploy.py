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
        manifest = [{"Config": f"{index}.json", "RepoTags": [f"akb/{service}:{sha}"], "Layers": []} for index, service in enumerate(services)]
        if extra:
            manifest.append({"Config": "extra.json", "RepoTags": [f"akb/unexpected:{sha}"], "Layers": []})
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
  service="${@: -1}"; service="${service#akb/}"; service="${service%%:*}"
  if [[ "$*" == *org.opencontainers.image.revision* ]]; then printf '%s\\n' "$FAKE_SHA"
  elif [[ "$*" == *cz.zeleznalady.akl.compose-project* ]]; then printf 'akb\\n'
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

    def test_first_akb_cutover_restores_legacy_containers_after_failed_bootstrap(self) -> None:
        sha = "a" * 40
        legacy_id = "b" * 64
        target_id = "c" * 64
        gateway = ROOT / "infra/ci/gitea-runner/host/akb-gitea-deploy-gateway.sh"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            docker = fake_bin / "docker"
            docker.write_text(f"""#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' \"$*\" >>\"$FAKE_DOCKER_LOG\"
if [[ \"$1 ${'{'}2:-{'}'}\" == \"ps -aq\" ]]; then
  if [[ \"$*\" == *'project=akl'* ]]; then printf '{legacy_id}\\n'
  elif [[ \"$*\" == *'project=akb'* ]]; then printf '{target_id}\\n'
  fi
elif [[ \"$1\" == \"stop\" || \"$1\" == \"start\" ]]; then exit 0
else exit 2
fi
""")
            docker.chmod(0o755)
            sync = fake_bin / "sync"
            sync.write_text("#!/usr/bin/env bash\nexit 0\n")
            sync.chmod(0o755)
            release = root / "release"
            (release / "git" / "AI-KnowledgeBase.git").mkdir(parents=True)
            archive_path = root / "target.tar"
            with tarfile.open(archive_path, mode="w") as archive:
                script = b"#!/usr/bin/env bash\nexit 1\n"
                info = tarfile.TarInfo("scripts/bootstrap_docker_home_target.sh")
                info.mode = 0o755
                info.size = len(script)
                archive.addfile(info, io.BytesIO(script))
            git = fake_bin / "git"
            git.write_text("""#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *" archive "* ]]; then cat "$FAKE_GIT_ARCHIVE"; fi
""")
            git.chmod(0o755)
            operation = release / "ci-deployments" / f"20260907T120000Z-{sha[:12]}-123"
            operation.mkdir(parents=True)
            (operation / "release-sha").write_text(f"{sha}\n")
            (operation / "forward-fix-from").write_text("none\n")
            log = root / "docker.log"
            environment = {
                **os.environ,
                "AKL_RELEASE_ROOT": str(release),
                "PATH": f"{fake_bin}:{os.environ['PATH']}",
                "FAKE_DOCKER_LOG": str(log),
                "FAKE_GIT_ARCHIVE": str(archive_path),
            }
            result = subprocess.run(
                ["bash", str(gateway), "--internal-run", operation.name, sha],
                capture_output=True,
                text=True,
                env=environment,
            )
            diagnostic = result.stderr
            if log.exists():
                diagnostic += log.read_text(encoding="utf-8")
            if (operation / "status").exists():
                diagnostic += (operation / "status").read_text(encoding="utf-8")
            self.assertEqual(result.returncode, 0, diagnostic)
            actions = log.read_text(encoding="utf-8")
            self.assertIn(f"stop --time 30 {legacy_id}", actions)
            self.assertIn(f"stop --time 30 {target_id}", actions)
            self.assertIn(f"start {legacy_id}", actions)
            self.assertLess(actions.index(f"stop --time 30 {legacy_id}"), actions.index(f"start {legacy_id}"))
            self.assertIn("state=failed", (operation / "status").read_text(encoding="utf-8"))

    def test_forward_fix_uses_recovery_wrapper_inside_legacy_cutover(self) -> None:
        failed_sha = "a" * 40
        target_sha = "b" * 40
        legacy_id = "c" * 64
        gateway = ROOT / "infra/ci/gitea-runner/host/akb-gitea-deploy-gateway.sh"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            docker_log = root / "docker.log"
            recovery_log = root / "recovery.log"
            docker = fake_bin / "docker"
            docker.write_text(f"""#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$FAKE_DOCKER_LOG"
if [[ "$1 ${'{'}2:-{'}'}" == "ps -aq" && "$*" == *'project=akl'* ]]; then
  printf '{legacy_id}\\n'
elif [[ "$1" == "stop" ]]; then
  exit 0
else
  exit 2
fi
""")
            docker.chmod(0o755)
            git = fake_bin / "git"
            git.write_text("#!/usr/bin/env bash\nexit 0\n")
            git.chmod(0o755)
            sync = fake_bin / "sync"
            sync.write_text("#!/usr/bin/env bash\nexit 0\n")
            sync.chmod(0o755)

            release = root / "release"
            (release / "git" / "AI-KnowledgeBase.git").mkdir(parents=True)
            failed_release = release / "releases" / failed_sha
            (failed_release / "scripts").mkdir(parents=True)
            recovery = failed_release / "scripts" / "rollback_docker_home_release.sh"
            recovery.write_text("""#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >"$FAKE_RECOVERY_LOG"
""")
            recovery.chmod(0o755)
            operation = release / "ci-deployments" / f"20260908T120000Z-{target_sha[:12]}-123"
            operation.mkdir(parents=True)
            (operation / "release-sha").write_text(f"{target_sha}\n")
            (operation / "forward-fix-from").write_text(f"{failed_sha}\n")
            environment = {
                **os.environ,
                "AKL_RELEASE_ROOT": str(release),
                "PATH": f"{fake_bin}:{os.environ['PATH']}",
                "FAKE_DOCKER_LOG": str(docker_log),
                "FAKE_RECOVERY_LOG": str(recovery_log),
            }
            result = subprocess.run(
                ["bash", str(gateway), "--internal-run", operation.name, target_sha, failed_sha],
                capture_output=True,
                text=True,
                env=environment,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                recovery_log.read_text(encoding="utf-8").strip(),
                f"--failed-sha {failed_sha} --forward-fix-sha {target_sha}",
            )
            self.assertIn(f"stop --time 30 {legacy_id}", docker_log.read_text(encoding="utf-8"))
            status = (operation / "status").read_text(encoding="utf-8")
            self.assertIn("state=succeeded", status)
            self.assertIn(f"forward_fix_from={failed_sha}", status)

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

    def test_gateway_rejects_conflicting_legacy_and_canonical_roots(self) -> None:
        gateway = ROOT / "infra/ci/gitea-runner/host/akb-gitea-deploy-gateway.sh"
        result = subprocess.run(
            ["bash", str(gateway), "status", "20260907T120000Z-aaaaaaaaaaaa-1"],
            check=False,
            capture_output=True,
            text=True,
            env={
                **os.environ,
                "AKB_GATEWAY_TEST_MODE": "1",
                "AKB_RELEASE_ROOT": "/tmp/akb",
                "AKL_RELEASE_ROOT": "/tmp/akl",
            },
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("/tmp/akb", result.stderr)

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
        self.assertIn('timeout 3600 dd bs=1M', gateway)
        self.assertIn('gzip -t "$archive"', gateway)
        self.assertIn('schema=akb-prebuilt-image-import-1', gateway)
        self.assertIn('[[ "$revision" == "$release_sha"', gateway)
        self.assertIn('PREBUILT_IMAGES="true"', deploy)
        self.assertIn('if [[ "$PREBUILT_IMAGES" != "true" ]]; then', deploy)
        self.assertIn('Using prebuilt immutable images', deploy)
        self.assertIn('akb-production-image-manifest-1', publisher)
        self.assertEqual(publisher.count('queue_build '), 8)
        self.assertIn('AKB_RELEASE_BUILD_JOBS must be an integer from 1 to 8.', publisher)
        self.assertIn('AKB_RELEASE_BUILD_JOBS: "4"', workflow)
        self.assertIn('if docker pull "$target"', publisher)
        self.assertIn('Existing immutable image provenance is invalid', publisher)
        self.assertIn('docker save "${image_tags[@]}" | gzip -n', workflow)
        self.assertIn('akb-production-images-${{ github.sha }}', workflow)
        self.assertIn('verify_gitea_action_artifact.py', workflow)
        self.assertIn('"import ${RELEASE_SHA} ${archive_sha}"', workflow)
        self.assertIn('deploy_command="deploy ${RELEASE_SHA}"', workflow)
        self.assertIn('deploy_command+=" ${FORWARD_FIX_FROM_SHA}"', workflow)
        self.assertIn('forward_fix_from_sha:', workflow)
        self.assertIn('http.extraheader="Authorization: token ${GITEA_TOKEN}"', workflow)
        self.assertIn('fetch --unshallow origin main', workflow)
        self.assertIn('--failed-sha "$FORWARD_FIX_FROM_SHA"', gateway)
        self.assertIn('--forward-fix-sha "$RELEASE_SHA"', gateway)
        self.assertLess(workflow.index("Require successful trusted main CI"), workflow.index("Build and publish immutable production images once"))
        self.assertLess(workflow.index("Build and publish immutable production images once"), workflow.index('"import ${RELEASE_SHA} ${archive_sha}"'))
        self.assertLess(workflow.index('"import ${RELEASE_SHA} ${archive_sha}"'), workflow.index('deploy_command="deploy ${RELEASE_SHA}"'))

    def test_first_activation_checks_all_infrastructure_images_before_burning_sha(self) -> None:
        deploy = (ROOT / "scripts/deploy_docker_home_release.sh").read_text()
        preflight = 'done < <("${COMPOSE[@]}" config --images)'
        burn = 'akl_burn_release_sha "$RELEASE_ROOT" "$TARGET_SHA" build_may_have_started'
        self.assertIn('PLATFORM_STATUS_IMAGE="akb/platform-status:docker-home"', deploy)
        self.assertIn("CADDY_IMAGE", deploy)
        self.assertIn("QDRANT_IMAGE", deploy)
        self.assertIn('docker image inspect "$required_image"', deploy)
        self.assertIn(preflight, deploy)
        self.assertLess(deploy.index(preflight), deploy.index(burn))

    def test_first_activation_requires_https_stratos_authorities_before_burning_sha(self) -> None:
        deploy = (ROOT / "scripts/deploy_docker_home_release.sh").read_text()
        preflight = 'First immutable activation requires HTTPS for $required_stratos_url_name'
        burn = 'akl_burn_release_sha "$RELEASE_ROOT" "$TARGET_SHA" build_may_have_started'
        for name in (
            "AKL_STRATOS_AUTH_ME_URL",
            "AKL_STRATOS_POLICY_BINDINGS_URL",
            "AKL_STRATOS_POLICY_DECISIONS_URL",
            "AKL_STRATOS_INFORMATION_RESOURCES_URL",
            "AKL_STRATOS_BUDGET_AKB_RESOURCES_URL",
            "AKL_STRATOS_INFORMATION_PUBLICATIONS_URL",
            "AKL_STRATOS_PUBLIC_DECISIONS_URL",
        ):
            self.assertIn(name, deploy)
        self.assertIn('[[ "$required_stratos_url" == https://* ]]', deploy)
        self.assertIn(preflight, deploy)
        self.assertLess(deploy.index(preflight), deploy.index(burn))

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
