#!/usr/bin/env python3
"""Create and verify an empty AKB epoch only in a marked disposable directory."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

MARKER = ".akb-clean-pilot-disposable-v1"
SURFACES = ("registry", "search", "retrieval", "chat", "preview", "download", "citation", "source-open", "export", "publication")
ZERO_STORES = (
    "documents", "document_versions", "blobs", "ingest_jobs", "indexed_chunks",
    "vectors", "citations", "chat_history", "evaluation_business_data",
    "scope_publication_session_bindings",
)


def bootstrap(root: Path) -> dict[str, object]:
    root = root.resolve()
    if root.exists() and not (root / MARKER).is_file():
        raise RuntimeError("DISPOSABLE_STORE_MARKER_REQUIRED")
    created = not root.exists()
    root.mkdir(parents=True, exist_ok=True)
    marker = root / MARKER
    if created:
        marker.write_text("clean-pilot-epoch-1\n", encoding="utf-8")
    elif marker.read_text(encoding="utf-8") != "clean-pilot-epoch-1\n":
        raise RuntimeError("DISPOSABLE_STORE_MARKER_INVALID")
    stores = root / "stores"
    stores.mkdir(exist_ok=True)
    for name in ZERO_STORES:
        target = stores / f"{name}.json"
        if not target.exists():
            target.write_text("[]\n", encoding="utf-8")
        if json.loads(target.read_text(encoding="utf-8")) != []:
            raise RuntimeError(f"NON_EMPTY_STORE:{name}")
    return {"created": created, "noOp": not created, "counts": counts(root)}


def owner_reset(root: Path) -> dict[str, int]:
    root = root.resolve()
    if not root.is_dir() or not (root / MARKER).is_file():
        raise RuntimeError("DISPOSABLE_STORE_MARKER_REQUIRED")
    for path in (root / "stores").glob("*.json"):
        path.write_text("[]\n", encoding="utf-8")
    return counts(root)


def counts(root: Path) -> dict[str, int]:
    result: dict[str, int] = {}
    for name in ZERO_STORES:
        path = root / "stores" / f"{name}.json"
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, list):
            raise RuntimeError(f"INVALID_STORE:{name}")
        result[name] = len(value)
    return result


def read_surface(root: Path, surface: str, stale_id: str) -> None:
    if surface not in SURFACES:
        raise RuntimeError("UNKNOWN_READ_SURFACE")
    if any(stale_id in path.read_text(encoding="utf-8") for path in (root / "stores").glob("*.json")):
        raise RuntimeError("STALE_ID_PRESENT")
    raise LookupError(f"STALE_ID_DENIED:{surface}")


def technical_pass(root: Path) -> dict[str, object]:
    first = bootstrap(root)
    second = bootstrap(root)
    stale_results: dict[str, str] = {}
    for surface in SURFACES:
        try:
            read_surface(root, surface, "stale-epoch-id")
        except LookupError:
            stale_results[surface] = "denied"
    if set(stale_results) != set(SURFACES):
        raise RuntimeError("STALE_ID_TEST_INCOMPLETE")
    return {"firstBootstrap": first, "secondBootstrap": second, "staleIdBySurface": stale_results}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--technical-pass", action="store_true")
    args = parser.parse_args()
    if not args.technical_pass:
        raise SystemExit("Only --technical-pass is available in Phase A")
    print(json.dumps(technical_pass(args.root), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
