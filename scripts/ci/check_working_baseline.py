#!/usr/bin/env python3
"""Read-only lineage check before working on or validating an AKB candidate."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys


def git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], text=True, capture_output=True, check=False)


def commit(ref: str) -> str:
    result = git("rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}")
    if result.returncode:
        raise ValueError("BASELINE_COMMIT_UNAVAILABLE")
    return result.stdout.strip()


def check_baseline(base: str, production_sha: str | None = None) -> dict[str, object]:
    head, base_sha = commit("HEAD"), commit(base)
    errors: list[str] = []
    if git("merge-base", "--is-ancestor", base_sha, head).returncode:
        errors.append("WORKING_BRANCH_BEHIND_MAIN")
    if production_sha is not None:
        if not re.fullmatch(r"[0-9a-f]{40}", production_sha):
            raise ValueError("PRODUCTION_FULL_SHA_REQUIRED")
        production_sha = commit(production_sha)
        if git("merge-base", "--is-ancestor", production_sha, head).returncode:
            errors.append("WORKING_BRANCH_MISSING_PRODUCTION")
    return {
        "status": "blocked" if errors else "passed",
        "candidate_sha": head,
        "base_sha": base_sha,
        "production_sha": production_sha,
        "production_checked": production_sha is not None,
        "reason_codes": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--production-sha", help="Full SHA from the current verified production release")
    args = parser.parse_args()
    try:
        result = check_baseline(args.base, args.production_sha)
    except ValueError as exc:
        result = {"status": "blocked", "reason_codes": [str(exc)]}
    print(json.dumps(result))
    if result["status"] != "passed":
        print("Preserve local work, fetch Gitea, and reconcile the branch with main/production before continuing. No files were changed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
