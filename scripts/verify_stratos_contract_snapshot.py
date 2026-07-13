#!/usr/bin/env python3
from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_ROOT = ROOT / "contracts/stratos"
EXPECTED = {
    "access-governance/v1/access-governance.schema.json": "f3386878a4bf98028add1ad238c21e029954967dfb6d452164a2c8c78b2ac5cc",
    "access-governance/v1/capability-catalog.json": "3902c425e600be1e8bede5e84df76042fe5165675d1ec6dc896922140fd81dec",
    "access-governance/v1/keycloak-baseline.json": "77dae3495f41c483dbcfe998aa4e5de732f48dab3b0a3618e314fb83fed2f711",
    "information-policy/v2/information-policy.schema.json": "b32666bbb90d453aebbff8efc6d23c7e5a27c4dcfdbb47bcbd2565c109551f0a",
    "information-policy/v2/policy-bundle.json": "f1b15294712323faea5605336847d9434c54ea7a8540e59578dd42cd6e49cf2f",
    "information-policy/v2/policy-registry.openapi.json": "09b1ccef6e4eef7ce1fe748ec198a0b7c3a50bdbdf8f4a21ef4a73a649e47ba2",
    "integration-envelope/v1/integration-envelope.schema.json": "d4eeaae84306a0ff0e47a9b6526f11b73c6b14f3e2ddc938ece459259ade305f",
    "conformance/v1/decision-fixtures.json": "d8c2e2b21695b58cd47fdadad825d7969e7d4cd41c5d330f169cd36b9a945f8a",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the accepted STRATOS contract snapshot.")
    parser.add_argument("--source-root", type=Path)
    options = parser.parse_args()
    failures: list[str] = []
    for relative, expected in EXPECTED.items():
        snapshot = SNAPSHOT_ROOT / relative
        if not snapshot.is_file():
            failures.append(f"missing snapshot: {relative}")
            continue
        try:
            json.loads(snapshot.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            failures.append(f"invalid JSON {relative}: {exc}")
            continue
        actual = digest(snapshot)
        if actual != expected:
            failures.append(f"digest mismatch {relative}: {actual}")
        if options.source_root:
            source = options.source_root / relative
            if not source.is_file():
                failures.append(f"missing source: {relative}")
            elif source.read_bytes() != snapshot.read_bytes():
                failures.append(f"source differs: {relative}")

    if failures:
        for failure in failures:
            print(f"ERROR {failure}", file=sys.stderr)
        return 1
    print(f"Verified {len(EXPECTED)} STRATOS contract files.")
    return 0


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
