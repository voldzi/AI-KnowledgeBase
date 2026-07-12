import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCorpusBaselineDataset,
  representativeDocuments
} from "../src/lib/evaluation/corpus-baseline";
import type { Document } from "../src/lib/types";

describe("retrieval quality corpus baseline", () => {
  it("builds a private silver retrieval-only dataset from accessible documents", () => {
    const payload = buildCorpusBaselineDataset(
      [
        documentFixture("doc_1", "Směrnice A", "directive", "valid"),
        documentFixture("doc_2", "AI karta", "ai_requirement_card", "draft")
      ],
      { subjectId: "analyst_1", roles: ["analyst"] },
      { now: new Date("2026-07-10T10:00:00Z"), limit: 10 }
    );

    assert.equal(payload.visibility, "private");
    assert.deepEqual(payload.tags, ["corpus-baseline", "silver", "exact-title", "retrieval-only"]);
    assert.equal(payload.cases.length, 2);
    const directiveCase = payload.cases.find((item) => item.metadata.document_id === "doc_1");
    const aiCase = payload.cases.find((item) => item.metadata.document_id === "doc_2");
    assert.equal(directiveCase?.answer_mode, "retrieve_only");
    assert.equal(directiveCase?.judgment_status, "silver");
    assert.equal(directiveCase?.role, "analyst");
    assert.equal(directiveCase?.filters.only_valid, false);
    assert.deepEqual(directiveCase?.expected_relevant_document_ids, ["doc_1"]);
    assert.deepEqual(aiCase?.filters.document_types, []);
  });

  it("balances document types before taking additional documents from a type", () => {
    const selected = representativeDocuments(
      [
        documentFixture("doc_1", "A", "directive", "draft"),
        documentFixture("doc_2", "B", "directive", "valid"),
        documentFixture("doc_3", "C", "contract", "review")
      ],
      2
    );

    assert.deepEqual(selected.map((item) => item.document_id), ["doc_3", "doc_2"]);
  });
});

function documentFixture(
  documentId: string,
  title: string,
  documentType: Document["document_type"],
  status: Document["status"]
): Document {
  return {
    document_id: documentId,
    title,
    document_type: documentType,
    status,
    classification: "internal",
    owner_id: "owner_1",
    owner: "Owner",
    gestor_unit: "IT",
    tags: [],
    created_at: "2026-07-10T10:00:00Z",
    updated_at: "2026-07-10T10:00:00Z"
  };
}
