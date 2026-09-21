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
