#!/usr/bin/env python3
"""Copy the binding format catalog into existing service build contexts."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "contracts/document-formats/v1/catalog.json"
TARGETS = (
    ROOT / "apps/web/src/lib/documents/document-formats.generated.json",
    ROOT / "services/ingestion-service/app/document-formats.generated.json",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = json.loads(SOURCE.read_text())
    assert data["schema_version"] == "akb-document-formats-1"
    ids, extensions = set(), set()
    for entry in data["formats"]:
        assert entry["id"] not in ids, "Duplicate format ID"
        ids.add(entry["id"])
        assert entry["admission"] in {"enabled", "unavailable"}
        assert entry["parser"] in {None, "pdf", "docx", "xlsx", "pptx", "html", "plain_text", "image_ocr"}
        assert entry["admission"] != "enabled" or entry["parser"] is not None
        for extension in entry["extensions"]:
            assert extension.startswith(".") and extension == extension.lower() and extension not in extensions
            extensions.add(extension)
        assert set(entry["label"]) == set(entry["limitation"]) == {"cs", "en"}
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    stale = [target for target in TARGETS if not target.exists() or target.read_text() != rendered]
    if args.check and stale:
        raise SystemExit("Stale format catalog: " + ", ".join(str(path.relative_to(ROOT)) for path in stale))
    if not args.check:
        for target in stale:
            target.write_text(rendered)
    print("Document format catalog PASS")


if __name__ == "__main__":
    main()
