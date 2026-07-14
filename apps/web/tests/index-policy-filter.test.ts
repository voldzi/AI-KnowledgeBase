import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  candidateIndexSelection,
  exactAuthorizedIndexSelection,
  indexHitMatchesSelection,
} from "../src/lib/intelligence/policy-filter";
import type { Document } from "../src/lib/types";

const documents = [
  { document_id: "doc_current", policy_hash: `sha256:${"a".repeat(64)}` },
  { document_id: "doc_legacy", policy_hash: null },
] as Document[];

describe("intelligence index policy filtering", () => {
  it("keeps Registry-visible DTOs as candidates without trusting roles or DTO policy hashes", () => {
    const selection = candidateIndexSelection([
      documents[1],
      documents[0],
      documents[0],
    ]);

    assert.deepEqual(selection, {
      documentIds: ["doc_current", "doc_legacy"],
    });
    assert.equal(selection.policyHashes, undefined);
    assert.equal(selection.documentVersions, undefined);
  });

  it("fails closed for a stale version even when its document and policy hash match", () => {
    const policyHash = `sha256:${"a".repeat(64)}`;
    const selection = exactAuthorizedIndexSelection([
      {
        document_id: "doc_current",
        document_version_id: "ver_current",
        policy_hash: policyHash,
      },
    ]);

    assert.equal(indexHitMatchesSelection({ document_id: "doc_current", document_version_id: "ver_stale", policy_hash: policyHash }, selection), false);
    assert.equal(indexHitMatchesSelection({ document_id: "doc_current", document_version_id: "ver_current", policy_hash: policyHash }, selection), true);
  });
});
