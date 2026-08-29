import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.clean_pilot_disposable_store import SURFACES, ZERO_STORES, bootstrap, owner_reset, technical_pass


def test_phase_a_evidence_is_bound_to_authoritative_gitea_repository() -> None:
    evidence = Path(__file__).resolve().parents[1] / "evidence/clean-pilot-epoch-1/phase-a"
    for path in sorted(evidence.glob("*.json")):
        assert json.loads(path.read_text(encoding="utf-8"))["repository"] == "AKB/ai-knowledgebase"


def test_disposable_bootstrap_is_empty_idempotent_and_denies_stale_ids(tmp_path: Path) -> None:
    root = tmp_path / "new-akb-epoch"
    result = technical_pass(root)
    assert result["firstBootstrap"]["created"] is True
    assert result["secondBootstrap"]["noOp"] is True
    assert set(result["firstBootstrap"]["counts"]) == set(ZERO_STORES)
    assert set(result["firstBootstrap"]["counts"].values()) == {0}
    assert result["staleIdBySurface"] == {surface: "denied" for surface in SURFACES}


def test_bootstrap_and_reset_reject_unmarked_existing_paths(tmp_path: Path) -> None:
    root = tmp_path / "not-disposable"
    root.mkdir()
    with pytest.raises(RuntimeError, match="DISPOSABLE_STORE_MARKER_REQUIRED"):
        bootstrap(root)
    with pytest.raises(RuntimeError, match="DISPOSABLE_STORE_MARKER_REQUIRED"):
        owner_reset(root)


def test_bootstrap_fails_closed_when_any_store_is_not_empty(tmp_path: Path) -> None:
    root = tmp_path / "new-akb-epoch"
    bootstrap(root)
    (root / "stores" / "documents.json").write_text('[{"id":"unexpected"}]\n', encoding="utf-8")
    with pytest.raises(RuntimeError, match="NON_EMPTY_STORE:documents"):
        bootstrap(root)
