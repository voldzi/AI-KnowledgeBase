import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authorizedIndexSelection,
  indexHitMatchesSelection,
} from "../src/lib/intelligence/policy-filter";
import type { Document } from "../src/lib/types";

const documents = [
  { document_id: "doc_current", policy_hash: `sha256:${"a".repeat(64)}` },
  { document_id: "doc_legacy", policy_hash: null },
] as Document[];

describe("intelligence index policy filtering", () => {
  it("fails closed for missing and stale policy hashes in STRATOS access mode", () => {
    const selection = authorizedIndexSelection(documents, {
      roles: ["stratos_user"],
      capabilities: ["akb:read_document"],
    });

    assert.deepEqual(selection.documentIds, ["doc_current"]);
    assert.equal(indexHitMatchesSelection({ document_id: "doc_current", policy_hash: `sha256:${"b".repeat(64)}` }, selection), false);
    assert.equal(indexHitMatchesSelection({ document_id: "doc_current", policy_hash: `sha256:${"a".repeat(64)}` }, selection), true);
    assert.equal(indexHitMatchesSelection({ document_id: "doc_legacy", policy_hash: null }, selection), false);
  });

  it("keeps the explicit pre-reset legacy path document-id based", () => {
    const selection = authorizedIndexSelection(documents, { roles: ["document_manager"] });
    assert.deepEqual(selection, { documentIds: ["doc_current", "doc_legacy"] });
    assert.equal(indexHitMatchesSelection({ document_id: "doc_legacy", policy_hash: null }, selection), true);
  });
});
