#!/usr/bin/env python3
"""Copy the one document-profile catalog into existing service build contexts."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "contracts/akb/document-profiles/v1/catalog.json"
TARGETS = (
    ROOT / "services/registry-api/app/document_profile_catalog.json",
    ROOT / "apps/web/src/lib/documents/document-profile-catalog.json",
)
INPUT_SCHEMA = ROOT / "contracts/akb/document-profiles/v1/inputs.schema.json"
INPUT_SCHEMA_TARGET = ROOT / "apps/web/src/lib/documents/document-profile-inputs.schema.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    value = json.loads(SOURCE.read_text())
    content = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    copies = [(path, content) for path in TARGETS] + [(INPUT_SCHEMA_TARGET, INPUT_SCHEMA.read_text())]
    if args.check:
        stale = [str(path.relative_to(ROOT)) for path, expected in copies if not path.exists() or path.read_text() != expected]
        if stale:
            raise SystemExit("Document profile catalog copies are stale: " + ", ".join(stale))
        print("Document profile catalog parity passed")
        return
    for path, content in copies:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    print("Document profile catalog copies updated")


if __name__ == "__main__":
    main()
