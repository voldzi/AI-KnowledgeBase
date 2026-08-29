import json
from pathlib import Path
import pytest

from tools.clean_pilot_stack_rehearsal import MARKER, REQUIRED_IMAGES, REQUIRED_SURFACES, image_bundle_digest, preflight, prepare_marker, validate_bundle, validate_environment, validate_source_commit, verify_stale_denials


def valid_bundle() -> dict[str, object]:
    images = {name: f"akb/{name}@sha256:{'4' * 64}" for name in sorted(REQUIRED_IMAGES)}
    return {"schemaVersion": "akb-clean-pilot-stack-bundle-1", "repository": "AKB/ai-knowledgebase", "sourceCommit": "1" * 40, "migrationBundleSha256": "2" * 64, "imageBundleSha256": image_bundle_digest(images), "images": images, "surfaces": sorted(REQUIRED_SURFACES), "networkPolicy": "internal-no-egress", "credentialPolicy": "generated-ephemeral-only", "productionConnectivity": False, "composePath": "infra/clean-pilot/docker-compose.rehearsal.yml"}


def test_exact_immutable_bundle_passes() -> None:
    validate_bundle(valid_bundle())
    validate_source_commit(valid_bundle(), "1" * 40)


def test_source_or_image_bundle_digest_drift_stops() -> None:
    with pytest.raises(RuntimeError, match="SOURCE_COMMIT_MISMATCH"):
        validate_source_commit(valid_bundle(), "9" * 40)
    bundle = valid_bundle()
    bundle["imageBundleSha256"] = "9" * 64
    with pytest.raises(RuntimeError, match="IMAGE_BUNDLE_DIGEST_MISMATCH"):
        validate_bundle(bundle)


def test_preflight_stops_until_real_no_egress_compose_exists(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = valid_bundle()
    manifest = tmp_path / "bundle.json"
    manifest.write_text(json.dumps(bundle))
    monkeypatch.chdir(tmp_path)
    with pytest.raises(RuntimeError, match="REAL_STACK_COMPOSE_MISSING"):
        preflight(manifest, tmp_path / "markers", "rehearsal-a1", "1" * 40)


@pytest.mark.parametrize("field,value,code", [("endpoint", "http://unknown.invalid", "BUNDLE_FIELDS_NOT_CLOSED"), ("networkPolicy", "default", "ISOLATION_POLICY_INVALID"), ("productionConnectivity", True, "ISOLATION_POLICY_INVALID")])
def test_unknown_or_unisolated_target_stops(field: str, value: object, code: str) -> None:
    bundle = valid_bundle()
    bundle[field] = value
    with pytest.raises(RuntimeError, match=code):
        validate_bundle(bundle)


def test_production_like_hostname_stops() -> None:
    bundle = valid_bundle()
    bundle["images"]["web"] = f"docker.home.cz/akb/web@sha256:{'4' * 64}"
    bundle["imageBundleSha256"] = image_bundle_digest(bundle["images"])
    with pytest.raises(RuntimeError, match="PRODUCTION_LIKE_TARGET_FORBIDDEN"):
        validate_bundle(bundle)


def test_unpinned_or_incomplete_image_set_stops() -> None:
    bundle = valid_bundle()
    bundle["images"]["postgresql"] = "postgres:16"
    with pytest.raises(RuntimeError, match="IMAGE_NOT_IMMUTABLE"):
        validate_bundle(bundle)
    bundle = valid_bundle()
    bundle["images"].pop("qdrant")
    with pytest.raises(RuntimeError, match="IMAGE_SET_INCOMPLETE"):
        validate_bundle(bundle)


def test_remote_or_preconfigured_endpoint_environment_stops() -> None:
    with pytest.raises(RuntimeError, match="REMOTE_DOCKER_HOST_FORBIDDEN"):
        validate_environment({"DOCKER_HOST": "tcp://remote.invalid:2376"})
    with pytest.raises(RuntimeError, match="EXTERNAL_ENDPOINT_ENV_FORBIDDEN"):
        validate_environment({"AKL_QDRANT_BASE_URL": "http://qdrant:6333"})


def test_existing_unmarked_or_nonempty_target_stops(tmp_path: Path) -> None:
    root = tmp_path / "targets"
    root.mkdir()
    target = root / "akb-cpe1-rehearsal-a1"
    target.mkdir()
    with pytest.raises(RuntimeError, match="DISPOSABLE_MARKER_REQUIRED"):
        prepare_marker(root, "rehearsal-a1")
    (target / MARKER).write_text("clean-pilot-epoch-1:rehearsal-a1\n")
    (target / "unexpected").write_text("not empty")
    with pytest.raises(RuntimeError, match="DISPOSABLE_TARGET_NOT_EMPTY"):
        prepare_marker(root, "rehearsal-a1")


def test_stale_id_must_be_denied_by_every_surface() -> None:
    verify_stale_denials({surface: "denied" for surface in REQUIRED_SURFACES})
    incomplete = {surface: "denied" for surface in REQUIRED_SURFACES if surface != "chat"}
    with pytest.raises(RuntimeError, match="STALE_ID_NOT_DENIED_ON_ALL_SURFACES"):
        verify_stale_denials(incomplete)
    accepted = {surface: "denied" for surface in REQUIRED_SURFACES}
    accepted["registry"] = "found"
    with pytest.raises(RuntimeError, match="STALE_ID_NOT_DENIED_ON_ALL_SURFACES"):
        verify_stale_denials(accepted)
