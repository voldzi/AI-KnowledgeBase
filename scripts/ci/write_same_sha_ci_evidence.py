#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

SCHEMA = "akb-gitea-ci-evidence-1"
WORKFLOW = ".gitea/workflows/ci.yaml"
SHA = re.compile(r"^[0-9a-f]{40}$")
EVENTS = {"push", "workflow_dispatch"}
KEYS = {"schema", "commit", "ref", "event", "workflow", "run_id", "run_attempt", "phase_a_evidence"}


def build(*, commit: str, ref: str, event: str, run_id: str, run_attempt: str) -> dict[str, object]:
    if not SHA.fullmatch(commit):
        raise ValueError("commit must be a full lowercase Git SHA")
    if event not in EVENTS:
        raise ValueError("event is not an approved trusted CI event")
    if not ref.startswith("refs/heads/"):
        raise ValueError("ref must be an exact branch ref")
    if event == "push" and ref != "refs/heads/main":
        raise ValueError("push attestation is valid only for refs/heads/main")
    parsed_run_id = positive_integer(run_id, "run_id")
    parsed_attempt = positive_integer(run_attempt, "run_attempt")
    body: dict[str, object] = {
        "schema": SCHEMA,
        "commit": commit,
        "ref": ref,
        "event": event,
        "workflow": WORKFLOW,
        "run_id": parsed_run_id,
        "run_attempt": parsed_attempt,
        "phase_a_evidence": "success",
    }
    if set(body) != KEYS:
        raise RuntimeError("same-SHA CI evidence is not closed")
    return body


def positive_integer(value: str, label: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be an integer") from exc
    if parsed < 1:
        raise ValueError(f"{label} must be positive")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--event", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-attempt", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    body = build(commit=args.commit, ref=args.ref, event=args.event, run_id=args.run_id, run_attempt=args.run_attempt)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(body, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
