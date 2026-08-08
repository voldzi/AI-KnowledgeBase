#!/usr/bin/env python3
"""Export AKB Gitea runner, cache and main-run metrics for node_exporter."""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(
        item.stat().st_size
        for item in path.rglob("*")
        if item.is_file() and not item.is_symlink()
    )


def read_token(path: Path) -> str:
    if path.stat().st_mode & 0o077:
        raise RuntimeError("The Gitea token file must not be accessible by group or others")
    token = path.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError("The Gitea token file is empty")
    return token


def get_json(url: str, token: str) -> dict[str, Any]:
    request = Request(url, headers={"Authorization": f"token {token}"})
    try:
        with urlopen(request, timeout=10) as response:  # noqa: S310 - configured internal URL
            return json.load(response)
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RuntimeError("Gitea monitoring API request failed") from exc


def systemd_state(service: str, verb: str, expected: str) -> int:
    try:
        result = subprocess.run(
            ["systemctl", verb, service],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except FileNotFoundError:
        return 0
    return int(result.returncode == 0 and result.stdout.strip() == expected)


def parse_timestamp(value: str | None) -> float:
    if not value:
        return 0.0
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def escape_label(value: object) -> str:
    return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def metric(name: str, value: int | float, **labels: object) -> str:
    suffix = ""
    if labels:
        rendered = ",".join(f'{key}="{escape_label(val)}"' for key, val in sorted(labels.items()))
        suffix = "{" + rendered + "}"
    return f"{name}{suffix} {value}"


def render_metrics(args: argparse.Namespace) -> str:
    token = read_token(args.token_file)
    base = args.gitea_url.rstrip("/")
    owner, repo = args.repository.split("/", 1)
    api = f"{base}/api/v1/repos/{owner}/{repo}"
    runners = get_json(f"{api}/actions/runners", token)
    runs = get_json(f"{api}/actions/runs?branch=main&status=success&limit=1", token)
    branch = get_json(f"{api}/branches/main", token)

    runner = next(
        (item for item in runners.get("runners", []) if item.get("id") == args.runner_id),
        None,
    )
    if runner is None:
        raise RuntimeError(f"AKB runner ID {args.runner_id} is outside the repository scope")
    successful_run = (runs.get("workflow_runs") or [{}])[0]
    successful_sha = successful_run.get("head_sha") or "none"
    current_sha = ((branch.get("commit") or {}).get("id")) or "none"
    cache_bytes = directory_size(args.cache_root)
    free_bytes = shutil.disk_usage(args.cache_root).free
    common = {"repository": args.repository, "runner_id": args.runner_id}

    lines = [
        "# HELP akb_gitea_ci_metrics_collection_success Whether the AKB Gitea metrics collection succeeded.",
        "# TYPE akb_gitea_ci_metrics_collection_success gauge",
        metric("akb_gitea_ci_metrics_collection_success", 1, **common),
        "# TYPE akb_gitea_ci_metrics_collection_timestamp_seconds gauge",
        metric("akb_gitea_ci_metrics_collection_timestamp_seconds", int(time.time()), **common),
        "# TYPE akb_gitea_ci_runner_service_active gauge",
        metric(
            "akb_gitea_ci_runner_service_active",
            systemd_state(args.service, "is-active", "active"),
            service=args.service,
            **common,
        ),
        "# TYPE akb_gitea_ci_runner_service_enabled gauge",
        metric(
            "akb_gitea_ci_runner_service_enabled",
            systemd_state(args.service, "is-enabled", "enabled"),
            service=args.service,
            **common,
        ),
        "# TYPE akb_gitea_ci_runner_online gauge",
        metric(
            "akb_gitea_ci_runner_online",
            int(runner.get("status") == "online"),
            runner_name=runner.get("name") or "unknown",
            **common,
        ),
        "# TYPE akb_gitea_ci_runner_busy gauge",
        metric("akb_gitea_ci_runner_busy", int(bool(runner.get("busy"))), **common),
        "# TYPE akb_gitea_ci_cache_bytes gauge",
        metric("akb_gitea_ci_cache_bytes", cache_bytes, **common),
        "# TYPE akb_gitea_ci_filesystem_available_bytes gauge",
        metric("akb_gitea_ci_filesystem_available_bytes", free_bytes, **common),
        "# TYPE akb_gitea_ci_main_last_success_timestamp_seconds gauge",
        metric(
            "akb_gitea_ci_main_last_success_timestamp_seconds",
            parse_timestamp(successful_run.get("completed_at")),
            sha=successful_sha,
            run_id=successful_run.get("id") or 0,
            **common,
        ),
        "# TYPE akb_gitea_ci_main_last_success_matches_head gauge",
        metric(
            "akb_gitea_ci_main_last_success_matches_head",
            int(successful_sha != "none" and successful_sha == current_sha),
            head_sha=current_sha,
            successful_sha=successful_sha,
            **common,
        ),
    ]
    return "\n".join(lines) + "\n"


def write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(content, encoding="utf-8")
    os.chmod(temporary, 0o644)
    os.replace(temporary, path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gitea-url", default="https://git.home.cz")
    parser.add_argument("--repository", default="AKB/ai-knowledgebase")
    parser.add_argument("--runner-id", type=int, default=6)
    parser.add_argument("--service", default="stratos-gitea-ci-runner.service")
    parser.add_argument("--cache-root", type=Path, default=Path("/home/stratos-ci/.cache/akb-ci"))
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("/var/lib/node_exporter/textfile_collector/akb_gitea_ci.prom"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        write_atomic(args.output, render_metrics(args))
    except Exception as exc:  # Keep secrets and response bodies out of service logs.
        print(f"AKB Gitea CI metric export failed: {type(exc).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
