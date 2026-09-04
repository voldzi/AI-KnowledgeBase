from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DoclingProductionReleaseTests(unittest.TestCase):
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
        current = subprocess.run(
            [
                "git",
                "show",
                "origin/main:infra/docker-compose/docker-compose.docker-home.yml",
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        target = (ROOT / "infra/docker-compose/docker-compose.docker-home.yml").read_text(
            encoding="utf-8"
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
