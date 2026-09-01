from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "scripts/ci/publish_clean_pilot_c4_images.sh").read_text()
WORKFLOW = (ROOT / ".gitea/workflows/clean-pilot-c4-registry.yaml").read_text()


class CleanPilotC4RegistryTests(unittest.TestCase):
    def test_registry_is_internal_and_digest_output_is_required(self) -> None:
        self.assertIn('registry="${AKB_C4_REGISTRY:-git.home.cz}"', SCRIPT)
        self.assertIn('owner="${AKB_C4_REGISTRY_OWNER:-akb}"', SCRIPT)
        self.assertIn("@sha256:[a-f0-9]{64}", SCRIPT)
        self.assertIn("docker pull \"${images[$name]}\"", SCRIPT)
        self.assertIn('images["$name"]="$(resolve_pushed_ref "$name" "$target")"', SCRIPT)
        self.assertIn('docker pull "$target"', SCRIPT)
        self.assertLess(SCRIPT.index('docker pull "$target"'), SCRIPT.index("printf '%s\\n' \"$resolved\""))
        self.assertIn("build_and_publish web . apps/web/Dockerfile", SCRIPT)
        self.assertIn('docker buildx build --pull', SCRIPT)
        self.assertIn('--build-arg "SOURCE_DATE_EPOCH=$source_date_epoch"', SCRIPT)
        self.assertIn("--provenance=false", SCRIPT)
        self.assertIn("--sbom=false", SCRIPT)
        self.assertIn("unpack=false,rewrite-timestamp=true", SCRIPT)
        self.assertIn("BUILDX_NO_DEFAULT_ATTESTATIONS=1", SCRIPT)
        self.assertIn("scripts/ci/check_clean_pilot_c4_inputs.py", SCRIPT)
        self.assertNotIn("postgres:16-alpine", SCRIPT)
        self.assertNotIn("minio/minio:latest", SCRIPT)
        self.assertNotIn("opensearchproject/opensearch:2", SCRIPT)
        self.assertNotIn("org.opencontainers.image.revision", SCRIPT)
        self.assertNotIn("org.opencontainers.image.source", SCRIPT)

    def test_locked_inputs_are_closed_and_negative_drift_fails(self) -> None:
        validator = ROOT / "scripts/ci/check_clean_pilot_c4_inputs.py"
        subprocess.run(["python3", str(validator), "--root", str(ROOT)], check=True)
        with tempfile.TemporaryDirectory() as temp:
            fixture = Path(temp)
            for relative in (
                "scripts/ci/publish_clean_pilot_c4_images.sh",
                "apps/web/Dockerfile",
                "apps/web/pnpm-lock.yaml",
                "services/registry-api/Dockerfile",
                "services/registry-api/requirements.c4.lock",
                "services/ingestion-service/Dockerfile",
                "services/ingestion-service/requirements.c4.lock",
                "services/rag-retrieval-service/Dockerfile",
                "services/rag-retrieval-service/requirements.c4.lock",
                "services/evaluation-service/Dockerfile",
                "services/evaluation-service/requirements.c4.lock",
            ):
                target = fixture / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, target)
            lock = fixture / "services/evaluation-service/requirements.c4.lock"
            lock.write_text(lock.read_text().replace("--hash=sha256:", "--hash=sha512:"))
            result = subprocess.run(
                ["python3", str(validator), "--root", str(fixture)],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unhashed Python requirement", result.stderr + result.stdout)

            shutil.copy2(
                ROOT / "services/evaluation-service/requirements.c4.lock",
                lock,
            )
            publisher = fixture / "scripts/ci/publish_clean_pilot_c4_images.sh"
            publisher.write_text(
                publisher.read_text().replace(
                    "postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685",
                    "postgres:16-alpine",
                )
            )
            result = subprocess.run(
                ["python3", str(validator), "--root", str(fixture)],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("mutable infrastructure image", result.stderr + result.stdout)

            publisher.write_text(
                (ROOT / "scripts/ci/publish_clean_pilot_c4_images.sh").read_text()
            )
            registry = fixture / "services/registry-api/Dockerfile"
            registry.write_text(
                registry.read_text().replace("ARG SOURCE_DATE_EPOCH\n", "")
            )
            result = subprocess.run(
                ["python3", str(validator), "--root", str(fixture)],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("registry wheel build epoch argument", result.stderr + result.stdout)

            shutil.copy2(ROOT / "services/registry-api/Dockerfile", registry)
            registry.write_text(
                registry.read_text().replace("    && export PIP_NO_CACHE_DIR=1 \\\n", "")
            )
            result = subprocess.run(
                ["python3", str(validator), "--root", str(fixture)],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("disabled isolated wheel pip cache", result.stderr + result.stdout)

    def test_secret_is_not_written_to_manifest_or_log(self) -> None:
        self.assertIn("--password-stdin", SCRIPT)
        self.assertIn("unset AKB_C4_REGISTRY_TOKEN", SCRIPT)
        self.assertNotIn('echo "$AKB_C4_REGISTRY_TOKEN"', SCRIPT)

    def test_workflow_is_manual_exact_sha_and_non_production(self) -> None:
        self.assertIn("workflow_dispatch:", WORKFLOW)
        self.assertIn("approved_sha:", WORKFLOW)
        self.assertIn("${{ gitea.token }}", WORKFLOW)
        self.assertIn(
            "AKB_C4_REGISTRY_TOKEN: ${{ secrets.AKB_GITEA_PACKAGE_RW_TOKEN }}",
            WORKFLOW,
        )
        self.assertNotIn("AKB_C4_REGISTRY_TOKEN: ${{ secrets.AKB_GITEA_RELEASE_GATE_TOKEN }}", WORKFLOW)
        self.assertNotIn("AKB_C4_REGISTRY_TOKEN: ${{ gitea.token }}", WORKFLOW)
        self.assertIn("productionMutationAuthorized", SCRIPT)
        self.assertNotIn("docker.home.cz", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
