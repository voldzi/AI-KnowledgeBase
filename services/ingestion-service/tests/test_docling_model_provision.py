from __future__ import annotations

import json
from pathlib import Path

import pytest

from docling_models import provision as module
from parsers.docling import directory_sha256


def _manifest_path() -> Path:
    return Path(module.__file__).with_name("source-bundle.json")


def _fake_download(**kwargs):  # type: ignore[no-untyped-def]
    destination = Path(kwargs["local_dir"])
    destination.mkdir(parents=True)
    if destination.name.endswith("layout-heron"):
        (destination / "config.json").write_text("{}", encoding="utf-8")
        (destination / "preprocessor_config.json").write_text("{}", encoding="utf-8")
        (destination / "model.safetensors").write_bytes(b"layout")
    else:
        for variant in ("accurate", "fast"):
            target = destination / "model_artifacts" / "tableformer" / variant
            target.mkdir(parents=True)
            (target / "tm_config.json").write_text("{}", encoding="utf-8")
            (target / f"tableformer_{variant}.safetensors").write_bytes(
                variant.encode("ascii")
            )
    return str(destination)


def test_provision_uses_exact_public_revisions_and_creates_immutable_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []

    def recording_download(**kwargs):  # type: ignore[no-untyped-def]
        calls.append(kwargs)
        return _fake_download(**kwargs)

    monkeypatch.setattr(module, "download_snapshot", recording_download)
    output = tmp_path / "bundle"
    result = module.provision(manifest_path=_manifest_path(), output=output)

    assert result["status"] == "passed"
    assert result["artifacts_sha256"] == directory_sha256(output)
    assert [call["revision"] for call in calls] == [
        "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8",
        "fc0f2d45e2218ea24bce5045f58a389aed16dc23",
    ]
    assert all(call["token"] is False for call in calls)
    marker = json.loads((output / "akb-docling-model-bundle.json").read_text())
    assert set(marker) == {
        "schema",
        "profile",
        "docling_package",
        "source_manifest_sha256",
        "repositories",
    }
    assert output.stat().st_mode & 0o222 == 0
    assert all(candidate.stat().st_mode & 0o222 == 0 for candidate in output.rglob("*"))


def test_provision_refuses_existing_output(tmp_path: Path) -> None:
    output = tmp_path / "bundle"
    output.mkdir()
    with pytest.raises(module.ProvisionError, match="must not already exist"):
        module.provision(manifest_path=_manifest_path(), output=output)


def test_manifest_rejects_unpinned_revision(tmp_path: Path) -> None:
    value = json.loads(_manifest_path().read_text())
    value["repositories"][0]["revision"] = "main"
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(module.ProvisionError, match="pin is invalid"):
        module.provision(manifest_path=manifest, output=tmp_path / "bundle")
