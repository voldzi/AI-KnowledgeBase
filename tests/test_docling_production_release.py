from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE_BINDING = ROOT / "scripts/verify_docling_provision_source.py"
MOUNT_PREPARATION = ROOT / "scripts/prepare_docling_provision_mount.py"


class DoclingProductionReleaseTests(unittest.TestCase):
    def test_provisioner_prepares_and_seals_remapped_mount(self) -> None:
        provisioner = (
            ROOT / "scripts/provision_docling_model_bundle.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("prepare_docling_provision_mount.py\" prepare", provisioner)
        self.assertIn("prepare_docling_provision_mount.py\" seal", provisioner)

    def test_model_provision_mount_is_temporarily_executable_and_writeable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_root = Path(directory) / "models"
            stage = model_root / ".docling-standard-stage.test"
            model_root.mkdir(mode=0o700)
            stage.mkdir(mode=0o700)
            prepared = subprocess.run(
                [
                    "python3",
                    str(MOUNT_PREPARATION),
                    "prepare",
                    "--model-root",
                    str(model_root),
                    "--stage",
                    str(stage),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(prepared.returncode, 0, prepared.stderr)
            self.assertEqual(stage.stat().st_mode & 0o777, 0o733)
            sealed = subprocess.run(
                [
                    "python3",
                    str(MOUNT_PREPARATION),
                    "seal",
                    "--model-root",
                    str(model_root),
                    "--stage",
                    str(stage),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(sealed.returncode, 0, sealed.stderr)
            self.assertEqual(stage.stat().st_mode & 0o777, 0o700)

    def test_model_provision_mount_rejects_non_private_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_root = Path(directory) / "models"
            stage = model_root / ".docling-standard-stage.test"
            model_root.mkdir(mode=0o755)
            stage.mkdir(mode=0o700)
            result = subprocess.run(
                [
                    "python3",
                    str(MOUNT_PREPARATION),
                    "prepare",
                    "--model-root",
                    str(model_root),
                    "--stage",
                    str(stage),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must not be group or world accessible", result.stderr)

    def test_model_provision_source_accepts_exact_git_checkout(self) -> None:
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        result = subprocess.run(
            ["python3", str(SOURCE_BINDING), "--root", str(ROOT), "--sha", head],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("(git)", result.stdout)

    def test_model_provision_source_accepts_exact_immutable_release(self) -> None:
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory) / "releases" / sha
            release.mkdir(parents=True)
            marker = release / ".akl-release-sha"
            manifest = release / ".akl-release-manifest"
            marker.write_text(f"{sha}\n", encoding="ascii")
            manifest.write_text(
                f"git_sha={sha}\n"
                "trusted_ref=refs/remotes/origin/main\n"
                "prepared_utc=2026-09-04T08:23:52Z\n",
                encoding="ascii",
            )
            marker.chmod(0o444)
            manifest.chmod(0o444)
            release.chmod(0o555)
            try:
                result = subprocess.run(
                    [
                        "python3",
                        str(SOURCE_BINDING),
                        "--root",
                        str(release),
                        "--sha",
                        sha,
                    ],
                    check=False,
                    capture_output=True,
                    text=True,
                )
            finally:
                release.chmod(0o755)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("(release-marker)", result.stdout)

    def test_model_provision_source_rejects_writable_release_marker(self) -> None:
        sha = "b" * 40
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory) / "releases" / sha
            release.mkdir(parents=True)
            marker = release / ".akl-release-sha"
            manifest = release / ".akl-release-manifest"
            marker.write_text(f"{sha}\n", encoding="ascii")
            manifest.write_text(
                f"git_sha={sha}\n"
                "trusted_ref=refs/remotes/origin/main\n"
                "prepared_utc=2026-09-04T08:23:52Z\n",
                encoding="ascii",
            )
            marker.chmod(0o644)
            manifest.chmod(0o444)
            release.chmod(0o555)
            try:
                result = subprocess.run(
                    [
                        "python3",
                        str(SOURCE_BINDING),
                        "--root",
                        str(release),
                        "--sha",
                        sha,
                    ],
                    check=False,
                    capture_output=True,
                    text=True,
                )
            finally:
                release.chmod(0o755)
                marker.chmod(0o644)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("read-only", result.stderr)

    def test_production_compose_enforces_isolated_worker_boundary(self) -> None:
        result = subprocess.run(
            ["bash", str(ROOT / "scripts/check_docker_home_compose_render.sh")],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_compose_transition_maps_sidecar_to_ingestion_owner(self) -> None:
        target = (ROOT / "infra/docker-compose/docker-compose.docker-home.yml").read_text(
            encoding="utf-8"
        )
        worker_cpu = "cpus: ${AKL_INGESTION_DOCLING_CPU_LIMIT:-4.0}"
        self.assertEqual(target.count(worker_cpu), 1)
        current = target.replace(
            worker_cpu,
            "cpus: ${AKL_INGESTION_DOCLING_CPU_LIMIT:-3.0}",
        )
        with tempfile.TemporaryDirectory() as directory:
            current_path = Path(directory) / "current.yml"
            target_path = Path(directory) / "target.yml"
            current_path.write_text(current, encoding="utf-8")
            target_path.write_text(target, encoding="utf-8")
            command = (
                f'source "{ROOT / "scripts/lib/immutable_release_common.sh"}"; '
                f'akl_changed_supported_compose_services "{current_path}" "{target_path}"'
            )
            result = subprocess.run(
                ["bash", "-c", command],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip().splitlines(), ["ingestion-service"])

    def test_deploy_builds_docling_and_verifies_sidecar_same_image(self) -> None:
        deploy = (ROOT / "scripts/deploy_docker_home_release.sh").read_text(
            encoding="utf-8"
        )
        verify = (ROOT / "scripts/verify_docker_home_release.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn("--build-arg AKL_INSTALL_DOCLING=true", deploy)
        self.assertIn("--force-recreate docling-worker", deploy)
        self.assertIn(
            'docling-worker "$TARGET_INGESTION_IMAGE_ID" post-restart ingestion-service',
            deploy,
        )
        self.assertIn('release_service" == "$image_owner"', deploy)
        self.assertIn("verify_docling_worker_identity", verify)
        self.assertIn('release_service" == "ingestion-service"', verify)
        self.assertIn("--conversion-smoke", verify)
        self.assertIn('network_mode != "none"', verify)

        common = (ROOT / "scripts/lib/immutable_release_common.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn('local image_owner="${6:-$service_name}"', common)
        self.assertIn('release_service" == "$image_owner"', common)

    def test_model_sources_are_exact_public_commit_pins(self) -> None:
        manifest = json.loads(
            (
                ROOT
                / "services/ingestion-service/docling_models/source-bundle.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["schema"], "akb-docling-model-sources-1")
        self.assertEqual(manifest["profile"], "standard-cpu-v1")
        self.assertEqual(manifest["docling_package"], "docling-slim==2.124.0")
        self.assertEqual(len(manifest["repositories"]), 2)
        self.assertTrue(
            all(
                len(item["revision"]) == 40
                and set(item["revision"]) <= set("0123456789abcdef")
                for item in manifest["repositories"]
            )
        )


if __name__ == "__main__":
    unittest.main()
