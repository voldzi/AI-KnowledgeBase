#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from typing import Any
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen


SHA = re.compile(r"^[0-9a-f]{40}$")
REPOSITORY = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
EVENTS = {"push", "workflow_dispatch"}


def positive_integer(value: str, label: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be an integer") from exc
    if parsed < 1:
        raise ValueError(f"{label} must be positive")
    return parsed


def validate_request(
    *, api_url: str, repository: str, run_id: str, run_attempt: str,
    commit: str, ref: str, event: str, artifact_id: str, artifact_name: str,
) -> dict[str, Any]:
    parsed_url = urlparse(api_url)
    if parsed_url.scheme != "https" or not parsed_url.netloc or parsed_url.username or parsed_url.password:
        raise ValueError("api_url must be an absolute HTTPS URL without user information")
    if parsed_url.query or parsed_url.fragment:
        raise ValueError("api_url must not contain a query or fragment")
    if not REPOSITORY.fullmatch(repository):
        raise ValueError("repository must be owner/name")
    if not SHA.fullmatch(commit):
        raise ValueError("commit must be a full lowercase Git SHA")
    if not ref.startswith("refs/heads/"):
        raise ValueError("ref must be an exact branch ref")
    if event not in EVENTS:
        raise ValueError("event is not an approved trusted CI event")
    if event == "push" and ref != "refs/heads/main":
        raise ValueError("push verification is valid only for refs/heads/main")
    return {
        "api_url": api_url.rstrip("/"),
        "repository": repository,
        "run_id": positive_integer(run_id, "run_id"),
        "run_attempt": positive_integer(run_attempt, "run_attempt"),
        "commit": commit,
        "ref": ref,
        "event": event,
        "artifact_id": positive_integer(artifact_id, "artifact_id"),
        "artifact_name": artifact_name,
    }


def validate_response(payload: Any, expected: dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        raise ValueError("artifact response must be an object")
    artifacts = payload.get("artifacts")
    total_count = payload.get("total_count")
    if total_count != 1 or not isinstance(artifacts, list) or len(artifacts) != 1:
        raise ValueError("Gitea must expose exactly one matching artifact")
    artifact = artifacts[0]
    if not isinstance(artifact, dict):
        raise ValueError("artifact entry must be an object")
    checks = {
        "id": expected["artifact_id"],
        "name": expected["artifact_name"],
        "expired": False,
    }
    for key, value in checks.items():
        if artifact.get(key) != value:
            raise ValueError(f"artifact {key} does not match the upload")
    if not isinstance(artifact.get("size_in_bytes"), int) or artifact["size_in_bytes"] < 1:
        raise ValueError("artifact size must be positive")
    workflow_run = artifact.get("workflow_run")
    if not isinstance(workflow_run, dict):
        raise ValueError("artifact workflow_run is missing")
    branch = expected["ref"].removeprefix("refs/heads/")
    run_checks = {
        "id": expected["run_id"],
        "run_attempt": expected["run_attempt"],
        "head_sha": expected["commit"],
        "head_branch": branch,
        "event": expected["event"],
    }
    for key, value in run_checks.items():
        if workflow_run.get(key) != value:
            raise ValueError(f"artifact workflow_run {key} does not match")


def fetch_payload(expected: dict[str, Any], token: str) -> Any:
    owner, repository = expected["repository"].split("/", 1)
    query = urlencode({"name": expected["artifact_name"]})
    url = (
        f"{expected['api_url']}/repos/{quote(owner)}/{quote(repository)}"
        f"/actions/runs/{expected['run_id']}/artifacts?{query}"
    )
    request = Request(url, headers={"Accept": "application/json", "Authorization": f"token {token}"})
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-attempt", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--event", required=True)
    parser.add_argument("--artifact-id", required=True)
    parser.add_argument("--artifact-name", required=True)
    parser.add_argument("--retries", type=int, default=6)
    parser.add_argument("--retry-delay", type=float, default=2.0)
    args = parser.parse_args()
    token = os.environ.get("GITEA_TOKEN", "")
    if not token:
        print("GITEA_TOKEN is required for server-visible artifact verification", file=sys.stderr)
        return 1
    try:
        expected = validate_request(
            api_url=args.api_url, repository=args.repository, run_id=args.run_id,
            run_attempt=args.run_attempt, commit=args.commit, ref=args.ref,
            event=args.event, artifact_id=args.artifact_id,
            artifact_name=args.artifact_name,
        )
        if args.retries < 1 or args.retry_delay < 0:
            raise ValueError("retry policy is invalid")
        for attempt in range(args.retries):
            try:
                validate_response(fetch_payload(expected, token), expected)
                print(f"Gitea exposes exactly one verified artifact: {expected['artifact_name']}")
                return 0
            except ValueError as exc:
                if "exactly one matching artifact" not in str(exc) or attempt + 1 == args.retries:
                    raise
                time.sleep(args.retry_delay)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"server-visible artifact verification failed: {exc}", file=sys.stderr)
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
