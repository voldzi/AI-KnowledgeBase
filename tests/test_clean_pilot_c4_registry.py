from __future__ import annotations

from pathlib import Path
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
        self.assertIn('DOCKER_BUILDKIT=1 docker build --pull', SCRIPT)

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
