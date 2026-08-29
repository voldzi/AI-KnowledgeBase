#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "evidence/clean-pilot-epoch-1/phase-a"
FILES = (
    "c0-akb-owner.json", "c1-writer-inventory.json", "c1-akb.json",
    "c2-consumer-conformance.json", "c3-akb-test-manifest.json",
)
FORBIDDEN_KEYS = {"commitSha", "reviewId", "ciRunId", "jobId", "artifactId", "releaseBom"}
FORBIDDEN_VALUE = re.compile(r"(?:bearer\s+|token=|password=|secret=|postgres(?:ql)?://|https?://)", re.I)


def fail(message: str) -> None:
    raise SystemExit(f"clean pilot Phase A failed: {message}")


def walk(value: object, path: str = "$") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in FORBIDDEN_KEYS:
                fail(f"forbidden resolver-owned key {path}.{key}")
            walk(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            walk(child, f"{path}[{index}]")
    elif isinstance(value, str) and FORBIDDEN_VALUE.search(value):
        fail(f"secret or connection URL shaped value at {path}")


def load(name: str) -> dict:
    path = EVIDENCE / name
    if not path.is_file():
        fail(f"missing {name}")
    body = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(body, dict) or body.get("repository") != "STRATOS/AKB":
        fail(f"invalid repository binding in {name}")
    walk(body)
    return body


def main() -> None:
    docs = {name: load(name) for name in FILES}
    stores = docs["c0-akb-owner.json"].get("stores")
    if not isinstance(stores, list) or len(stores) != 10 or len({item.get("storeId") for item in stores}) != 10:
        fail("C0 must contain exactly ten uniquely owned stores")
    writers = docs["c1-writer-inventory.json"].get("writers")
    if not isinstance(writers, list) or not writers or any(not all(item.get(key) is not None for key in ("writerId", "owner", "environments", "productionPermission", "guard")) for item in writers):
        fail("C1 writer inventory is incomplete")
    expected_writer_ids = {
        "registry-governed-api", "registry-session-api", "web-controlled-upload",
        "ingestion-worker", "evaluation-service", "stratos-budget-document-bridge",
        "quality-dataset-bootstrap", "docs-folder-import", "original-pdf-import",
        "legacy-epoch-reset", "phase-01-smoke", "phase-02-controlled-document-smoke",
        "phase-03-docs-import-smoke", "document-workbench-e2e",
        "qdrant-maintenance-backfills", "opensearch-maintenance-backfills",
        "official-source-imports", "clean-pilot-disposable-bootstrap",
    }
    if {item["writerId"] for item in writers} != expected_writer_ids:
        fail("C1 closed writer set drift")
    for item in writers:
        for relative in item["paths"]:
            if not (ROOT / relative).exists():
                fail(f"declared writer path does not exist: {relative}")
        if item["productionPermission"] == "none" and "retired" in item["owner"]:
            for relative in item["paths"]:
                if "retire_legacy_mutation" not in (ROOT / relative).read_text(encoding="utf-8"):
                    fail(f"retired writer lacks an unconditional guard: {relative}")
    disposable_source = (ROOT / "tools/clean_pilot_disposable_store.py").read_text(encoding="utf-8")
    if "AIIP" in disposable_source or "SecurityPreflight" in disposable_source:
        fail("active disposable bootstrap contains a retired artifact family")
    if docs["c1-akb.json"].get("inventoryCount") != len(writers):
        fail("C1 inventory count drift")
    c2 = docs["c2-consumer-conformance.json"]
    expected_surfaces = {"registry", "search", "retrieval", "chat", "preview", "download", "citation", "source-open", "export", "publication"}
    if set(c2.get("surfaces", [])) != expected_surfaces or c2.get("authority") != "shadow-only":
        fail("C2 surface or authority closure failed")
    if c2.get("contract", {}).get("canonicalSchemaSha256") != "sha256:3b11860c9b79bfb82f7792b93815f49d786667a7dd4b74f5a8ad0cb5dd6620b7":
        fail("C2 schema digest drift")
    c3 = docs["c3-akb-test-manifest.json"]
    if set(c3.get("zeroState", {})) != {"documents", "documentVersions", "blobs", "ingestJobs", "indexedChunks", "vectors", "citations", "chatRagHistory", "evaluationBusinessData", "scopePublicationSessionBindings"}:
        fail("C3 zero-state closure failed")
    if any(c3["zeroState"].values()) or c3.get("secondBootstrap") != "no-op" or c3.get("productionConnectivity") is not False:
        fail("C3 is not empty, idempotent and isolated")
    for name in FILES:
        raw = (EVIDENCE / name).read_bytes()
        canonical = json.dumps(json.loads(raw), ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
        print(f"{name} raw={hashlib.sha256(raw).hexdigest()} canonical={hashlib.sha256(canonical).hexdigest()}")


if __name__ == "__main__":
    main()
