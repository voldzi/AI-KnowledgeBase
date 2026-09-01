from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / ".gitea/workflows/clean-pilot-c6-rehearsal.yaml").read_text()


def test_c6_is_manual_exact_source_and_uses_trusted_runner() -> None:
    assert "workflow_dispatch:" in WORKFLOW
    assert "approved_source_sha:" in WORKFLOW
    assert "c4_artifact_id:" in WORKFLOW
    assert "c4_manifest_sha256:" in WORKFLOW
    assert "runs-on: akb-gitea-ci" in WORKFLOW
    assert '[[ "$(git rev-parse HEAD)" == "${AKB_SOURCE_SHA}" ]]' in WORKFLOW


def test_c6_uses_closed_artifact_and_private_registry_secret() -> None:
    assert 'names != ["clean-pilot-c4-image-manifest.json"]' in WORKFLOW
    assert "C6_C4_MANIFEST_DIGEST_MISMATCH" in WORKFLOW
    assert "secrets.AKB_GITEA_PACKAGE_RW_TOKEN" in WORKFLOW
    assert "--password-stdin" in WORKFLOW
    assert "unset AKB_REGISTRY_TOKEN" in WORKFLOW
    assert "AKB_RUN_ID: c6-run-${{ github.run_id }}" in WORKFLOW
    assert "clean-pilot-c6-result.json" in WORKFLOW


def test_c6_preserves_isolation_and_production_is_absent() -> None:
    assert '"networkPolicy": "internal-no-egress"' in WORKFLOW
    assert '"productionConnectivity": False' in WORKFLOW
    assert '"credentialPolicy": "generated-ephemeral-only"' in WORKFLOW
    assert "docker.home.cz" not in WORKFLOW
    assert "zeleznalady.cz" not in WORKFLOW
