export function isCompletedIdempotentRetry(input: {
  documentId: string;
  documentVersionId: string;
  currentJobId: string | null;
  currentAttempt: {
    ingestion_job_id: string;
    document_id: string;
    document_version_id: string;
    ingestion_status: string;
  } | null;
  currentJob: {
    job_id: string;
    document_id: string;
    document_version_id: string;
    status: string;
  } | null;
}): boolean {
  return input.currentJobId !== null
    && input.currentAttempt?.ingestion_job_id === input.currentJobId
    && input.currentAttempt.document_id === input.documentId
    && input.currentAttempt.document_version_id === input.documentVersionId
    && input.currentAttempt.ingestion_status === "INDEXED"
    && input.currentJob?.job_id === input.currentJobId
    && input.currentJob.document_id === input.documentId
    && input.currentJob.document_version_id === input.documentVersionId
    && input.currentJob.status === "completed";
}

export function idempotencyKeyForBudgetRetry(input: {
  documentId: string;
  documentVersionId: string;
  operationId: string;
  currentJobId: string | null;
  currentAttempt: {
    ingestion_job_id: string;
    document_id: string;
    document_version_id: string;
    ingestion_status: string;
  } | null;
}): string {
  const base = `retry:${input.documentId}:${input.documentVersionId}:${input.operationId}`;
  const failedCurrentAttempt = input.currentJobId !== null
    && input.currentAttempt?.ingestion_job_id === input.currentJobId
    && input.currentAttempt.document_id === input.documentId
    && input.currentAttempt.document_version_id === input.documentVersionId
    && input.currentAttempt.ingestion_status === "FAILED";

  if (!failedCurrentAttempt || input.currentJobId === null) return base;

  // Registry accepts historical retries only when the operation component is
  // exactly `batch-retry-<sha256>`.  Derive a successor operation from both
  // the original operation and its failed predecessor instead of appending an
  // extra suffix to the full key.  That changes the idempotency identity while
  // preserving the narrow Registry contract and its length bound.
  const successorOperationId = `batch-retry-${createHash("sha256")
    .update(`${input.operationId}\u0000${input.currentJobId}`)
    .digest("hex")
  }`;
  return `retry:${input.documentId}:${input.documentVersionId}:${successorOperationId}`;
}
import { createHash } from "node:crypto";
