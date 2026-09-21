import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCompletedIdempotentRetry } from "../src/lib/stratos/budget-ingestion-retry";

const coordinate = {
  documentId: "doc_budget_123",
  documentVersionId: "ver_budget_123",
  ingestionJobId: "ing_budget_retry_123",
};

function completedRetry() {
  return {
    ...coordinate,
    currentJobId: coordinate.ingestionJobId,
    currentAttempt: {
      ingestion_job_id: coordinate.ingestionJobId,
      document_id: coordinate.documentId,
      document_version_id: coordinate.documentVersionId,
      ingestion_status: "INDEXED",
    },
    currentJob: {
      job_id: coordinate.ingestionJobId,
      document_id: coordinate.documentId,
      document_version_id: coordinate.documentVersionId,
      status: "completed",
    },
  };
}

describe("STRATOS Budget ingestion retry idempotence", () => {
  it("reuses the exact indexed retry coordinate", () => {
    assert.equal(isCompletedIdempotentRetry(completedRetry()), true);
  });

  for (const mutation of [
    (value: ReturnType<typeof completedRetry>) => { value.currentJobId = "ing_other"; },
    (value: ReturnType<typeof completedRetry>) => { value.currentAttempt.ingestion_status = "FAILED"; },
    (value: ReturnType<typeof completedRetry>) => { value.currentJob.status = "failed"; },
    (value: ReturnType<typeof completedRetry>) => { value.currentJob.document_version_id = "ver_other"; },
  ]) {
    it("does not reuse a conflicting or incomplete retry coordinate", () => {
      const value = completedRetry();
      mutation(value);
      assert.equal(isCompletedIdempotentRetry(value), false);
    });
  }
});
