#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts/identity-cleanup/v1"
EVIDENCE = ROOT / "evidence/clean-pilot-epoch-1/phase-a/c5-akb-identity-owner-confirmation.json"
CLAIM = ROOT / "evidence/clean-pilot-epoch-1/phase-a/c5-akb-identity-owner-confirmation.source-claim.json"
LOCAL_RESULT = ROOT / "evidence/clean-pilot-epoch-1/phase-a/c5-akb-local-validation.json"
RETIRED_CLEANUP = ROOT / "evidence/clean-pilot-epoch-1/phase-a/c5-retired-identity-cleanup.json"
MUTABLE_HEADER = {"submissionStatus", "reasonCode"}
MUTABLE_ENTRY = {"ownerDecision", "rationaleCode"}
DECISIONS = {
    "CONFIRM_AS_DECLARED": "REQUIRED_RUNTIME_DEPENDENCY",
    "RETIRE": "NOT_USED_IN_CLEAN_EPOCH",
}


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def digest(path: Path) -> tuple[str, str]:
    raw = path.read_bytes()
    return hashlib.sha256(raw).hexdigest(), hashlib.sha256(canonical(json.loads(raw))).hexdigest()


def fail(message: str) -> None:
    raise ValueError(message)


def validate(artifact: dict[str, object], draft: dict[str, object]) -> None:
    if set(artifact) != set(draft):
        fail("owner confirmation contains missing or unknown top-level fields")
    for key in set(draft) - MUTABLE_HEADER - {"entries", "routeBindings"}:
        if artifact[key] != draft[key]:
            fail(f"immutable contract header drift: {key}")
    if artifact["submissionStatus"] != "SUBMITTED" or artifact["reasonCode"] != "AKB_OWNER_CONFIRMATION_SUBMITTED":
        fail("owner confirmation is not submitted")
    if any(artifact[key] is not False for key in ("productionMutationAuthorized", "resetAuthorized", "deployAuthorized")):
        fail("owner confirmation attempts to authorize production mutation")
    for collection in ("entries", "routeBindings"):
        actual = artifact[collection]
        expected = draft[collection]
        if not isinstance(actual, list) or not isinstance(expected, list) or len(actual) != len(expected):
            fail(f"{collection} cardinality drift")
        seen: set[str] = set()
        for item, declared in zip(actual, expected, strict=True):
            if not isinstance(item, dict) or not isinstance(declared, dict) or set(item) != set(declared):
                fail(f"{collection} contains missing or unknown fields")
            identity = "|".join(str(item.get(key, "")) for key in ("mode", "kind", "id", "clientId", "requestScope", "targetAudience"))
            if identity in seen:
                fail(f"duplicate {collection} item")
            seen.add(identity)
            for key in set(declared) - MUTABLE_ENTRY:
                if item[key] != declared[key]:
                    fail(f"{collection} contract drift: {identity}:{key}")
            decision = item.get("ownerDecision")
            if decision not in DECISIONS or item.get("rationaleCode") != DECISIONS[decision]:
                fail(f"invalid or pending owner decision: {identity}")
    if len(artifact["entries"]) != 20 or len(artifact["routeBindings"]) != 7:
        fail("C5 must contain exactly 20 identities and seven route bindings")


def validate_metadata() -> None:
    metadata = json.loads((CONTRACT / "akb-identity-owner-confirmation.metadata.json").read_text())
    for item in metadata["artifacts"]:
        path = ROOT / item["path"]
        if not path.is_file() or digest(path) != (item["byteSha256"], item["canonicalSha256"]):
            fail(f"pinned STRATOS contract digest mismatch: {item['path']}")


def validate_source_claim() -> None:
    claim = json.loads(CLAIM.read_text())
    expected_keys = {"provider", "repository", "path", "mediaType", "byteSha256", "canonicalJsonSha256"}
    if set(claim) != expected_keys:
        fail("source evidence claim is not closed")
    if claim["provider"] != "gitea" or claim["repository"] != "AKB/ai-knowledgebase" or claim["path"] != EVIDENCE.relative_to(ROOT).as_posix() or claim["mediaType"] != "application/json":
        fail("source evidence claim binding mismatch")
    if (claim["byteSha256"], claim["canonicalJsonSha256"]) != digest(EVIDENCE):
        fail("source evidence claim digest mismatch")


def validate_local_result() -> None:
    result = json.loads(LOCAL_RESULT.read_text())
    expected_keys = {"schemaVersion", "repository", "epoch", "gate", "authority", "environment", "suite", "preCleanupResult", "result", "nonFailureDiagnostics", "trustedCiEvidence", "productionMutationAuthorized"}
    if set(result) != expected_keys or any(set(result[key]) != {"passed", "skipped", "failed", "durationSeconds"} for key in ("preCleanupResult", "result")):
        fail("local validation evidence is not closed")
    if result["schemaVersion"] != "akb-clean-pilot-c5-local-validation-1" or result["repository"] != "AKB/ai-knowledgebase" or result["authority"] != "SOURCE_ONLY":
        fail("local validation evidence binding mismatch")
    if result["suite"] != "services/registry-api/tests" or result["preCleanupResult"] != {"passed": 337, "skipped": 1, "failed": 0, "durationSeconds": 25.81} or result["result"] != {"passed": 340, "skipped": 1, "failed": 0, "durationSeconds": 28.56}:
        fail("local registry validation result drift")
    if result["trustedCiEvidence"] is not False or result["productionMutationAuthorized"] is not False:
        fail("local validation attempts to claim CI or production authority")


def validate_retired_cleanup() -> None:
    cleanup = json.loads(RETIRED_CLEANUP.read_text())
    expected_top = {
        "schemaVersion", "repository", "epochId", "gate", "authority",
        "productionMutationAuthorized", "decisions",
    }
    expected_item = {
        "id", "kind", "decision", "replacementOwner", "replacementIdentity",
        "replacementBoundary", "removedActiveSources", "tombstonedSources",
        "negativeAssertions",
    }
    if set(cleanup) != expected_top:
        fail("retired identity cleanup evidence is not closed")
    if cleanup["schemaVersion"] != "akb-clean-pilot-c5-retired-identity-cleanup-1" or cleanup["repository"] != "AKB/ai-knowledgebase" or cleanup["authority"] != "SOURCE_ONLY":
        fail("retired identity cleanup binding mismatch")
    if cleanup["productionMutationAuthorized"] is not False:
        fail("retired identity cleanup attempts production mutation")
    decisions = cleanup["decisions"]
    if not isinstance(decisions, list) or [item.get("id") for item in decisions] != ["stratos-akl-adapter", "service_governance", "service_llm_gateway"]:
        fail("retired identity cleanup decision set drift")
    for item in decisions:
        if set(item) != expected_item or item["decision"] != "RETIRE":
            fail("retired identity cleanup item is not closed")
        if not item["replacementOwner"] or not item["replacementIdentity"] or not item["replacementBoundary"]:
            fail("retired identity cleanup replacement is incomplete")
        if not item["removedActiveSources"] or not item["negativeAssertions"]:
            fail("retired identity cleanup proof plan is incomplete")


def main() -> None:
    validate_metadata()
    artifact = json.loads(EVIDENCE.read_text())
    draft = json.loads((CONTRACT / "akb-identity-owner-confirmation.draft.json").read_text())
    validate(artifact, draft)
    validate_source_claim()
    validate_local_result()
    validate_retired_cleanup()
    raw, canonical_sha = digest(EVIDENCE)
    print(f"C5 PASS entries=20 routes=7 raw={raw} canonical={canonical_sha}")


if __name__ == "__main__":
    main()
