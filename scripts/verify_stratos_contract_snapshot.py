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
    "access-governance/v1/access-governance.schema.json": "3127ed900c4b169724b6c6f988e5fd23c01c7a584f6a4adf154ca1af656f33de",
    "access-governance/v1/capability-catalog.json": "05f90a80ed69a6041547dc17e83de021b58021df99578e0a2740e1359db16ef1",
    "access-governance/v1/keycloak-baseline.json": "6a8da6af4d1ceea573830a28d46343594e0e31fd148aa64d1daca7a01cb043c5",
    "access-governance/v2/access-projection.schema.json": "2ae99547645d266daa20b23a6e13232babc9a89b5045d12fd5068c0b769d5f1f",
    "access-governance/v2/access-projection.metadata.json": "029addd00568a504e6ea7488bee327ef65f5fa9ade48d0b4fcebaf28d891f8e2",
    "information-policy/v2/information-policy.schema.json": "d408aa5758d7375f307086a6e05dbe49d3c1f3ce348367ee80fac7b5968e553c",
    "information-policy/v2/policy-bundle.json": "f1b15294712323faea5605336847d9434c54ea7a8540e59578dd42cd6e49cf2f",
    "information-policy/v2/policy-registry.openapi.json": "c9f75099f43dd26f497c69e079b77655b09f7b0870f0e1e2a9ef9b6cdf3b8287",
    "integration-envelope/v1/integration-envelope.schema.json": "c389a36cdca1569762c74e0c1a8806ec8f8e758043851a35dbf477dc0481c898",
    "conformance/v1/decision-fixtures.json": "d8c2e2b21695b58cd47fdadad825d7969e7d4cd41c5d330f169cd36b9a945f8a",
}

OFFICIAL_SOURCE_EXPECTED = {
    "official-sources/czech-law-pilot.v1.json": (
        "c37e92765053744fa35025eede613672e1ab556cebb9c5d72d0c2c1cd552cae6",
        "akb/official-sources/czech-law-pilot.v1.json",
    ),
    "official-sources/czech-law-pilot.v2.json": (
        "3cc9926fe59b3aa67d8bdbe9b64dea75cc4df68cc54e6353dae4a2f7ecc22503",
        "akb/official-sources/czech-law-pilot.v2.json",
    ),
    "official-sources/stratos-authority.openapi.json": (
        "905782427a95f3186e0cfe1e28d0c8bb4a654534741639863f84efb897ac0634",
        "akb/source-document-intake/stratos-authority.openapi.json",
    ),
    "source-document-intake/stratos-authority.openapi.json": (
        "905782427a95f3186e0cfe1e28d0c8bb4a654534741639863f84efb897ac0634",
        "akb/source-document-intake/stratos-authority.openapi.json",
    ),
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the accepted STRATOS contract snapshot.")
    parser.add_argument("--source-root", type=Path)
    parser.add_argument(
        "--official-source-only",
        action="store_true",
        help="Verify only the governed official-source manifests and authority contract.",
    )
    options = parser.parse_args()
    failures: list[str] = []
    if not options.official_source_only:
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

    for relative, (expected, source_relative) in OFFICIAL_SOURCE_EXPECTED.items():
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
            source = options.source_root / source_relative
            if not source.is_file():
                failures.append(f"missing source: {source_relative}")
            elif source.read_bytes() != snapshot.read_bytes():
                failures.append(f"source differs: {relative}")

    if failures:
        for failure in failures:
            print(f"ERROR {failure}", file=sys.stderr)
        return 1
    verified = len(OFFICIAL_SOURCE_EXPECTED)
    if not options.official_source_only:
        verified += len(EXPECTED)
    print(f"Verified {verified} STRATOS contract files.")
    return 0


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
