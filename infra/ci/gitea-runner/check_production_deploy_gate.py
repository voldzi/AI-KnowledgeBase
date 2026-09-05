#!/usr/bin/env python3
"""Fail closed unless the exact current main SHA has a successful trusted CI run."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from typing import Any
from urllib.parse import urlencode


FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


def read_token(path: Path) -> str:
    metadata = path.lstat()
    if path.is_symlink() or not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise RuntimeError("The Gitea token path must be one regular single-link file")
    if metadata.st_mode & 0o077:
        raise RuntimeError("The Gitea token file must have mode 0600")
    token = path.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError("The Gitea token file is empty")
    return token


def get_json(url: str, token: str) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9._~-]{20,256}", token):
        raise RuntimeError("The Gitea token contains unsupported characters")
    curl = shutil.which("curl")
    if curl is None:
        raise RuntimeError("The Gitea release-gate HTTP client is unavailable")

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix="akb-gitea-gate-",
        ) as curl_config:
            Path(curl_config.name).chmod(0o600)
            curl_config.write(f'header = "Authorization: token {token}"\n')
            curl_config.flush()
            result = subprocess.run(
                [
                    curl,
                    "--fail",
                    "--silent",
                    "--show-error",
                    "--connect-timeout",
                    "5",
                    "--max-time",
                    "10",
                    "--config",
                    curl_config.name,
                    "--header",
                    "Accept: application/json",
                    "--url",
                    url,
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        return json.loads(result.stdout)
    except (subprocess.CalledProcessError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Gitea release-gate API request failed") from exc


def is_trusted_ci_run(run: dict[str, Any], sha: str) -> bool:
    workflow_path = str(run.get("path") or run.get("workflow_path") or "")
    workflow_file = workflow_path.split("@", 1)[0]
    workflow_name = str(run.get("name") or run.get("workflow_name") or "")
    conclusion = str(run.get("conclusion") or run.get("status") or "")
    branch = run.get("head_branch")
    return all(
        (
            run.get("head_sha") == sha,
            run.get("event") == "push",
            branch in {None, "main"},
            conclusion == "success",
            workflow_file in {"ci.yaml", ".gitea/workflows/ci.yaml"}
            or workflow_name == "AKB CI",
        )
    )


def is_trusted_ci_identity(run: dict[str, Any], sha: str) -> bool:
    """Verify immutable CI provenance before considering its job outcomes."""
    workflow_path = str(run.get("path") or run.get("workflow_path") or "")
    workflow_file = workflow_path.split("@", 1)[0]
    workflow_name = str(run.get("name") or run.get("workflow_name") or "")
    branch = run.get("head_branch")
    return all(
        (
            run.get("head_sha") == sha,
            run.get("event") == "push",
            branch in {None, "main"},
            workflow_file in {"ci.yaml", ".gitea/workflows/ci.yaml"}
            or workflow_name == "AKB CI",
        )
    )


def has_only_successful_jobs(response: dict[str, Any]) -> bool:
    """Fail closed unless Gitea reports a non-empty all-success job set."""
    jobs = response.get("jobs")
    if not isinstance(jobs, list) or not jobs:
        return False
    return all(
        str(job.get("conclusion") or job.get("status") or "") == "success"
        for job in jobs
        if isinstance(job, dict)
    ) and all(isinstance(job, dict) for job in jobs)


def verify_gate(args: argparse.Namespace) -> int:
    if not FULL_SHA.fullmatch(args.sha):
        raise RuntimeError("Release SHA must be a full lowercase Git SHA")
    if "/" not in args.repository:
        raise RuntimeError("Repository must use owner/name format")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository):
        raise RuntimeError("Repository contains unsupported characters")
    token = read_token(args.token_file)
    owner, repo = args.repository.split("/", 1)
    api = f"{args.gitea_url.rstrip('/')}/api/v1/repos/{owner}/{repo}"
    branch = get_json(f"{api}/branches/main", token)
    main_sha = str((branch.get("commit") or {}).get("id") or "")
    if main_sha != args.sha:
        raise RuntimeError("Approved release SHA is not the current main head")

    query = urlencode({"branch": "main", "status": "success", "limit": 50})
    runs = get_json(f"{api}/actions/runs?{query}", token)
    trusted_run = next(
        (run for run in runs.get("workflow_runs", []) if is_trusted_ci_run(run, args.sha)),
        None,
    )
    if trusted_run is None:
        # Gitea 1.27 can occasionally record a failed workflow aggregate even
        # though every completed CI job is successful. Only accept that known
        # aggregate defect after independently verifying the exact run's full
        # non-empty job set through the authenticated API.
        for run in runs.get("workflow_runs", []):
            if not isinstance(run, dict) or not is_trusted_ci_identity(run, args.sha):
                continue
            run_id = run.get("id")
            if not isinstance(run_id, int):
                continue
            jobs = get_json(f"{api}/actions/runs/{run_id}/jobs?limit=100", token)
            if has_only_successful_jobs(jobs):
                trusted_run = run
                break
    if trusted_run is None:
        raise RuntimeError("No successful trusted main CI run exists for the release SHA")

    print("release_gate=passed")
    print(f"release_sha={args.sha}")
    print(f"ci_run_id={trusted_run.get('id') or 'unknown'}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gitea-url", default="https://git.home.cz")
    parser.add_argument("--repository", default="AKB/ai-knowledgebase")
    parser.add_argument("--sha", required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    try:
        return verify_gate(parse_args())
    except Exception as exc:
        print(f"AKB production release gate failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
