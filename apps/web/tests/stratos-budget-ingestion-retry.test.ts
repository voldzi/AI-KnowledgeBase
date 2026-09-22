import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  idempotencyKeyForBudgetRetry,
  isCompletedIdempotentRetry,
} from "../src/lib/stratos/budget-ingestion-retry";

const coordinate = {
  documentId: "doc_budget_123",
  documentVersionId: "ver_budget_123",
};

function completedRetry() {
  return {
    ...coordinate,
    currentJobId: "ing_budget_retry_123",
    currentAttempt: {
      ingestion_job_id: "ing_budget_retry_123",
      document_id: coordinate.documentId,
      document_version_id: coordinate.documentVersionId,
      ingestion_status: "INDEXED",
    },
    currentJob: {
      job_id: "ing_budget_retry_123",
      document_id: coordinate.documentId,
      document_version_id: coordinate.documentVersionId,
      status: "completed",
    },
  };
}

describe("STRATOS Budget ingestion retry idempotence", () => {
  it("creates one deterministic successor key after an exact failed attempt", () => {
    const failed = completedRetry();
    failed.currentAttempt.ingestion_status = "FAILED";
    failed.currentJob.status = "failed";
    assert.equal(
      idempotencyKeyForBudgetRetry({
        documentId: coordinate.documentId,
        documentVersionId: coordinate.documentVersionId,
        operationId: "batch-retry-0123456789abcdef",
        currentJobId: failed.currentJobId,
        currentAttempt: failed.currentAttempt,
      }),
      "retry:doc_budget_123:ver_budget_123:batch-retry-0123456789abcdef:after:ing_budget_retry_123",
    );
  });

  it("keeps the original key unless the exact current attempt failed", () => {
    const completed = completedRetry();
    assert.equal(
      idempotencyKeyForBudgetRetry({
        documentId: coordinate.documentId,
        documentVersionId: coordinate.documentVersionId,
        operationId: "batch-retry-0123456789abcdef",
        currentJobId: completed.currentJobId,
        currentAttempt: completed.currentAttempt,
      }),
      "retry:doc_budget_123:ver_budget_123:batch-retry-0123456789abcdef",
    );
  });

  it("reuses the exact indexed retry coordinate", () => {
    assert.equal(isCompletedIdempotentRetry(completedRetry()), true);
  });

  it("reuses an exact completed current retry created under an earlier operation id", () => {
    const value = completedRetry();
    value.currentJobId = "ing_earlier_operation";
    value.currentAttempt.ingestion_job_id = "ing_earlier_operation";
    value.currentJob.job_id = "ing_earlier_operation";
    assert.equal(isCompletedIdempotentRetry(value), true);
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
