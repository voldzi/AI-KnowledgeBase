from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/ci/check_working_baseline.py"


def git(repo: Path, *args: str) -> str:
    env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True, env=env).strip()


@pytest.fixture
def repo(tmp_path: Path) -> tuple[Path, str]:
    git(tmp_path, "init", "-q", "--initial-branch=main")
    git(tmp_path, "config", "user.name", "AKB test")
    git(tmp_path, "config", "user.email", "test@example.invalid")
    git(tmp_path, "commit", "--allow-empty", "-qm", "baseline")
    baseline = git(tmp_path, "rev-parse", "HEAD")
    git(tmp_path, "update-ref", "refs/remotes/origin/main", baseline)
    return tmp_path, baseline


def check(repo: Path, *args: str) -> tuple[int, dict[str, object]]:
    result = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=repo, text=True, capture_output=True)
    return result.returncode, json.loads(result.stdout)


def test_current_descendant_accepts_main_and_production_without_mutation(repo) -> None:
    root, baseline = repo
    git(root, "checkout", "-qb", "codex/work")
    git(root, "commit", "--allow-empty", "-qm", "work")
    before = git(root, "rev-parse", "HEAD")
    code, result = check(root, "--production-sha", baseline)
    assert code == 0 and result["status"] == "passed"
    assert result["production_checked"] is True
    assert result["candidate_sha"] == before == git(root, "rev-parse", "HEAD")


def test_old_branch_is_blocked_even_with_uncommitted_work(repo) -> None:
    root, baseline = repo
    git(root, "commit", "--allow-empty", "-qm", "new main")
    git(root, "update-ref", "refs/remotes/origin/main", git(root, "rev-parse", "HEAD"))
    git(root, "checkout", "-qb", "codex/old", baseline)
    (root / "useful.txt").write_text("preserve this work", encoding="utf-8")
    code, result = check(root)
    assert code == 1 and "WORKING_BRANCH_BEHIND_MAIN" in result["reason_codes"]
    assert (root / "useful.txt").read_text() == "preserve this work"


def test_divergent_production_is_blocked(repo) -> None:
    root, baseline = repo
    git(root, "checkout", "-qb", "production")
    git(root, "commit", "--allow-empty", "-qm", "production only")
    production = git(root, "rev-parse", "HEAD")
    git(root, "checkout", "-qb", "codex/work", baseline)
    git(root, "commit", "--allow-empty", "-qm", "candidate only")
    code, result = check(root, "--production-sha", production)
    assert code == 1 and result["reason_codes"] == ["WORKING_BRANCH_MISSING_PRODUCTION"]


@pytest.mark.parametrize("args,reason", [
    (["--base", "missing"], "BASELINE_COMMIT_UNAVAILABLE"),
    (["--base", "--help"], None),
    (["--production-sha", "123abcd"], "PRODUCTION_FULL_SHA_REQUIRED"),
    (["--production-sha", "0" * 40], "BASELINE_COMMIT_UNAVAILABLE"),
])
def test_unknown_or_invalid_baseline_fails_closed(repo, args, reason) -> None:
    root, _ = repo
    result = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=root, text=True, capture_output=True)
    assert result.returncode != 0
    if reason:
        assert reason in json.loads(result.stdout)["reason_codes"]


def test_optional_production_check_does_not_claim_it_was_done(repo) -> None:
    code, result = check(repo[0])
    assert code == 0 and result["production_checked"] is False


def test_fast_check_delegates_to_stdlib_orchestrator_and_checks_lineage_first() -> None:
    entrypoint = (ROOT / "scripts/ci/local-fast-check.sh").read_text()
    source = (ROOT / "scripts/ci/local_fast_check.py").read_text()
    assert "local_fast_check.py" in entrypoint
    assert '("diff", "--cached", "--name-only", "--")' in source
    main_source = source[source.index("def main()") :]
    assert main_source.index("check_working_baseline.py") < main_source.index("docker_available()")
