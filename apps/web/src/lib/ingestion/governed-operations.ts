import "server-only";

import { createHash } from "node:crypto";

import { getAklConfig, type ApiClientMode } from "@/lib/api/config";
import { createRequestId } from "@/lib/api/correlation";
import { ingestionServiceRequestContext } from "@/lib/ingestion/service-identity";
import {
  ApiClientError,
  type ApiClients,
  type ApiRequestContext,
  type DocumentVersion,
  type Document,
  type IngestionAuthorizationResponse,
  type IngestionJob,
  type IngestionReport,
  type RegistryIngestionAttempt,
} from "@/lib/types";

const PROJECTION_CONCURRENCY = 8;
const REPORT_CONCURRENCY = 6;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

type IngestionClients = Pick<ApiClients, "registry" | "ingestion">;
type TransportContextFactory = (correlationId: string) => Promise<ApiRequestContext>;

export interface ExactIngestionCoordinate {
  documentId: string;
  documentVersionId: string;
  jobId: string;
  correlationId?: string;
}

interface ExactIngestionOperationOptions {
  transportContextFactory?: TransportContextFactory;
}

interface RetryCurrentIngestionOptions extends ExactIngestionOperationOptions {
  correlationId?: string;
  expectedDocumentVersionId?: string;
  requirePublishedVersion?: boolean;
}

export interface RetriedCurrentIngestionAttempt {
  job: IngestionJob;
  version: DocumentVersion;
  previousAttempt: RegistryIngestionAttempt;
}

interface IngestionProjectionOptions {
  apiClientMode?: ApiClientMode;
}

/**
 * Builds the page-level job projection exclusively from Registry-visible documents.
 * In production the global ingestion list is deliberately never called.
 */
export async function listVisibleIngestionJobs(
  clients: IngestionClients,
  documents: Array<Pick<Document, "document_id">>,
  actorContext: ApiRequestContext,
  options: IngestionProjectionOptions = {},
): Promise<IngestionJob[]> {
  const visibleDocumentIds = [
    ...new Set(documents.map((document) => document.document_id).filter(Boolean)),
  ];
  if (visibleDocumentIds.length === 0) return [];

  const apiClientMode = options.apiClientMode ?? getAklConfig().apiClientMode;
  if (apiClientMode !== "production") {
    const jobs = await clients.ingestion.listJobs(actorContext);
    const visible = new Set(visibleDocumentIds);
    return sortNewestFirst(jobs.filter((job) => visible.has(job.document_id)));
  }

  const attempts = await mapWithConcurrency(
    visibleDocumentIds,
    PROJECTION_CONCURRENCY,
    (documentId) => clients.registry.getDocumentIngestionAttempt(documentId, actorContext),
  );
  return sortNewestFirst(
    attempts
      .filter((attempt): attempt is RegistryIngestionAttempt => attempt !== null)
      .map(ingestionJobFromAttempt),
  );
}

export async function getGovernedIngestionJob(
  clients: IngestionClients,
  actorContext: ApiRequestContext,
  coordinate: ExactIngestionCoordinate,
  options: ExactIngestionOperationOptions = {},
): Promise<IngestionJob> {
  const operation = await authorizeExactOperation(
    clients,
    actorContext,
    coordinate,
    "document.read",
    "read",
    options.transportContextFactory,
  );
  const job = await clients.ingestion.getJob(
    coordinate.jobId,
    operation.transportContext,
    operation.authorization,
  );
  assertExactJob(job, coordinate, operation.correlationId);
  return job;
}

export async function getGovernedIngestionReport(
  clients: IngestionClients,
  actorContext: ApiRequestContext,
  coordinate: ExactIngestionCoordinate,
  options: ExactIngestionOperationOptions = {},
): Promise<IngestionReport> {
  const operation = await authorizeExactOperation(
    clients,
    actorContext,
    coordinate,
    "document.read",
    "read",
    options.transportContextFactory,
  );
  const report = await clients.ingestion.getReport(
    coordinate.jobId,
    operation.transportContext,
    operation.authorization,
  );
  if (report.job_id !== coordinate.jobId) {
    throw conflict(
      "Ingestion Service returned a report for another job.",
      "INGESTION_REPORT_CONFLICT",
      operation.correlationId,
    );
  }
  return report;
}

export async function cancelGovernedIngestionJob(
  clients: IngestionClients,
  actorContext: ApiRequestContext,
  coordinate: ExactIngestionCoordinate,
  options: ExactIngestionOperationOptions = {},
): Promise<IngestionJob> {
  const operation = await authorizeExactOperation(
    clients,
    actorContext,
    coordinate,
    "document.ingest",
    "cancel",
    options.transportContextFactory,
  );
  const job = await clients.ingestion.cancelJob(
    coordinate.jobId,
    operation.transportContext,
    operation.authorization,
  );
  assertExactJob(job, coordinate, operation.correlationId);
  return job;
}

/**
 * Retries only the Registry-visible current attempt. The actor is authorized
 * twice: once to read the exact current job profile and once to create its
 * successor. Ingestion Service traffic always uses the dedicated web service
 * transport; no browser role or caller-supplied attempt coordinate is trusted.
 */
export async function retryCurrentGovernedIngestionAttempt(
  clients: IngestionClients,
  actorContext: ApiRequestContext,
  documentId: string,
  operationId: string,
  options: RetryCurrentIngestionOptions = {},
): Promise<RetriedCurrentIngestionAttempt> {
  const correlationId = exactCorrelationId(options.correlationId);
  assertRetryOperationId(operationId);
  const previousAttempt = await clients.registry.getDocumentIngestionAttempt(
    documentId,
    actorContext,
  );
  if (!previousAttempt) {
    throw new ApiClientError(
      "The document has no Registry-visible current ingestion attempt to retry.",
      409,
      "INGESTION_CURRENT_ATTEMPT_REQUIRED",
      correlationId,
    );
  }

  const versions = await clients.registry.listDocumentVersions(documentId, actorContext);
  const version = versions.find(
    (candidate) => candidate.document_version_id === previousAttempt.document_version_id,
  );
  if (!version || version.document_id !== documentId) {
    throw conflict(
      "The Registry current ingestion attempt does not resolve to an exact document version.",
      "INGESTION_CURRENT_ATTEMPT_CONFLICT",
      correlationId,
    );
  }
  if (
    options.expectedDocumentVersionId
    && version.document_version_id !== options.expectedDocumentVersionId
  ) {
    throw conflict(
      "The Registry current ingestion attempt is not the published document version.",
      "INGESTION_PUBLISHED_VERSION_CONFLICT",
      correlationId,
    );
  }
  if (options.requirePublishedVersion && version.status !== "valid") {
    throw conflict(
      "Only a published valid document version can refresh its retrieval indexes.",
      "INGESTION_PUBLISHED_VERSION_REQUIRED",
      correlationId,
    );
  }

  const currentJob = await getGovernedIngestionJob(
    clients,
    actorContext,
    {
      documentId,
      documentVersionId: version.document_version_id,
      jobId: previousAttempt.ingestion_job_id,
      correlationId,
    },
    options,
  );
  const retryIdempotencyKey = retryIdempotencyKeyFor({
    documentId,
    documentVersionId: version.document_version_id,
    operationId,
  });
  const operation = await authorizeIngestionAction(
    clients,
    actorContext,
    {
      documentId,
      documentVersionId: version.document_version_id,
      jobId: previousAttempt.ingestion_job_id,
      correlationId,
    },
    "document.ingest",
    retryIdempotencyKey,
    correlationId,
    options.transportContextFactory,
  );
  const job = await clients.ingestion.createJob(
    {
      idempotency_key: retryIdempotencyKey,
      document_id: documentId,
      document_version_id: version.document_version_id,
      source_file_uri: version.source_file_uri,
      parser_profile: currentJob.parser_profile,
      ocr_enabled: currentJob.ocr_enabled,
      chunking_strategy: currentJob.chunking_strategy,
      embedding_profile: currentJob.embedding_profile,
      expected_current_ingestion_job_id: previousAttempt.ingestion_job_id,
    },
    operation.transportContext,
    operation.authorization,
  );
  if (
    !job
    || typeof job !== "object"
    || !job.job_id
    || job.document_id !== documentId
    || job.document_version_id !== version.document_version_id
  ) {
    throw conflict(
      "Ingestion Service returned a retry outside the authorized current coordinate.",
      "INGESTION_RETRY_CONFLICT",
      correlationId,
    );
  }
  return { job, version, previousAttempt };
}

/**
 * Re-runs the exact Registry-visible ingestion attempt after publication so
 * derived Qdrant/OpenSearch payloads inherit the authoritative `valid` status.
 * The deterministic operation id makes a repeated publish bridge request
 * replay the same refresh job instead of creating duplicate work.
 */
export async function refreshPublishedVersionIndexes(
  clients: IngestionClients,
  actorContext: ApiRequestContext,
  documentId: string,
  documentVersionId: string,
  options: ExactIngestionOperationOptions = {},
): Promise<RetriedCurrentIngestionAttempt> {
  const coordinate = `${documentId}\0${documentVersionId}`;
  const operationId = `published-index:${createHash("sha256").update(coordinate).digest("hex")}`;
  return retryCurrentGovernedIngestionAttempt(
    clients,
    actorContext,
    documentId,
    operationId,
    {
      ...options,
      expectedDocumentVersionId: documentVersionId,
      requirePublishedVersion: true,
    },
  );
}

/**
 * Reports are fetched only for terminal visible attempts. A not-yet-created
 * report is an expected 404; authorization and integrity failures propagate.
 */
export async function listVisibleIngestionReports(
  clients: IngestionClients,
  actorContext: ApiRequestContext,
  jobs: IngestionJob[],
  options: ExactIngestionOperationOptions = {},
): Promise<IngestionReport[]> {
  const terminalJobs = jobs.filter((job) =>
    ["completed", "completed_with_warnings", "failed", "cancelled"].includes(job.status),
  );
  const reports = await mapWithConcurrency(
    terminalJobs,
    REPORT_CONCURRENCY,
    async (job) => {
      try {
        return await getGovernedIngestionReport(
          clients,
          actorContext,
          {
            documentId: job.document_id,
            documentVersionId: job.document_version_id,
            jobId: job.job_id,
          },
          options,
        );
      } catch (error) {
        if (
          error instanceof ApiClientError
          && error.status === 404
          && error.code === "REPORT_NOT_READY"
        ) {
          return null;
        }
        throw error;
      }
    },
  );
  return reports.filter((report): report is IngestionReport => report !== null);
}

export function ingestionJobFromAttempt(attempt: RegistryIngestionAttempt): IngestionJob {
  const status = {
    QUEUED: "queued",
    INGESTING: "running",
    INDEXED: "completed",
    FAILED: "failed",
  }[attempt.ingestion_status] as IngestionJob["status"] | undefined;
  if (!status) {
    throw conflict(
      "Registry returned an unsupported ingestion attempt status.",
      "INGESTION_ATTEMPT_INVALID",
      "registry-ingestion-projection",
    );
  }
  return {
    job_id: attempt.ingestion_job_id,
    document_id: attempt.document_id,
    document_version_id: attempt.document_version_id,
    status,
    parser_profile: "controlled_document",
    ocr_enabled: true,
    chunking_strategy: "legal_structured",
    embedding_profile: "default",
    created_at: attempt.created_at,
    started_at: attempt.ingestion_status === "INGESTING" ? attempt.updated_at : null,
    finished_at: ["INDEXED", "FAILED"].includes(attempt.ingestion_status)
      ? attempt.updated_at
      : null,
  };
}

export function exactIngestionJobFromAttempt(
  attempt: RegistryIngestionAttempt | null,
  coordinate: Omit<ExactIngestionCoordinate, "correlationId">,
): IngestionJob {
  if (
    !attempt
    || attempt.document_id !== coordinate.documentId
    || attempt.document_version_id !== coordinate.documentVersionId
    || attempt.ingestion_job_id !== coordinate.jobId
  ) {
    throw conflict(
      "The Registry current ingestion attempt conflicts with the exact requested coordinate.",
      "INGESTION_CURRENT_ATTEMPT_CONFLICT",
      "registry-ingestion-projection",
    );
  }
  return ingestionJobFromAttempt(attempt);
}

async function authorizeExactOperation(
  clients: IngestionClients,
  actorContext: ApiRequestContext,
  coordinate: ExactIngestionCoordinate,
  action: "document.read" | "document.ingest",
  idempotencyPrefix: "read" | "cancel",
  transportContextFactory: TransportContextFactory = ingestionServiceRequestContext,
) {
  const correlationId = exactCorrelationId(coordinate.correlationId);
  const idempotencyKey = `${idempotencyPrefix}:${coordinate.jobId}:${correlationId}`;
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new ApiClientError(
      "The exact ingestion operation produced an invalid idempotency key.",
      400,
      "INGESTION_IDEMPOTENCY_KEY_INVALID",
      correlationId,
    );
  }
  return authorizeIngestionAction(
    clients,
    actorContext,
    coordinate,
    action,
    idempotencyKey,
    correlationId,
    transportContextFactory,
  );
}

async function authorizeIngestionAction(
  clients: IngestionClients,
  actorContext: ApiRequestContext,
  coordinate: ExactIngestionCoordinate,
  action: "document.read" | "document.ingest",
  idempotencyKey: string,
  correlationId: string,
  transportContextFactory: TransportContextFactory = ingestionServiceRequestContext,
) {
  const proofContext: ApiRequestContext = {
    ...actorContext,
    requestId: correlationId,
    correlationId,
  };
  const proof = await clients.registry.createIngestionAuthorization(
    coordinate.documentId,
    coordinate.documentVersionId,
    {
      action,
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
    },
    proofContext,
  );
  const authorization = exactAuthorization(
    proof,
    actorContext.subjectId,
    coordinate,
    action,
    correlationId,
    idempotencyKey,
  );
  const transportContext = await transportContextFactory(correlationId);
  return { authorization, correlationId, transportContext };
}

function retryIdempotencyKeyFor(input: {
  documentId: string;
  documentVersionId: string;
  operationId: string;
}): string {
  const coordinate = [
    input.documentId,
    input.documentVersionId,
    input.operationId,
  ].join("\0");
  // createRequestId is intentionally not used here: the caller operation id
  // must replay to one deterministic job even after an unknown HTTP outcome.
  return `retry:${createHash("sha256").update(coordinate).digest("hex")}`;
}

function assertRetryOperationId(operationId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(operationId)) {
    throw new ApiClientError(
      "The retry operation id must be a bounded opaque identifier.",
      400,
      "INGESTION_RETRY_OPERATION_ID_INVALID",
      "web-ingestion-retry",
    );
  }
}

function exactAuthorization(
  proof: IngestionAuthorizationResponse,
  expectedSubjectId: string,
  coordinate: ExactIngestionCoordinate,
  action: "document.read" | "document.ingest",
  correlationId: string,
  idempotencyKey: string,
) {
  if (
    !proof
    || typeof proof !== "object"
    || proof.confirmed_subject_id !== expectedSubjectId
    || proof.action !== action
    || proof.document_id !== coordinate.documentId
    || proof.document_version_id !== coordinate.documentVersionId
    || proof.correlation_id !== correlationId
    || proof.idempotency_key !== idempotencyKey
    || typeof proof.authorization_token !== "string"
    || proof.authorization_token.length < 32
    || proof.authorization_token.length > 4096
    || /\s/.test(proof.authorization_token)
    || typeof proof.authorization_id !== "string"
    || !proof.authorization_id.startsWith("iauth_")
    || typeof proof.expires_at !== "string"
    || !Number.isFinite(Date.parse(proof.expires_at))
    || Date.parse(proof.expires_at) <= Date.now()
  ) {
    throw conflict(
      "Registry returned a conflicting or expired ingestion authorization.",
      "INGESTION_AUTHORIZATION_CONFLICT",
      correlationId,
    );
  }
  return {
    delegatedActorSubjectId: proof.confirmed_subject_id,
    authorizationToken: proof.authorization_token,
  };
}

function assertExactJob(
  job: IngestionJob,
  coordinate: ExactIngestionCoordinate,
  correlationId: string,
): void {
  if (
    !job
    || typeof job !== "object"
    || job.job_id !== coordinate.jobId
    || job.document_id !== coordinate.documentId
    || job.document_version_id !== coordinate.documentVersionId
  ) {
    throw conflict(
      "Ingestion Service returned a job outside the authorized coordinate.",
      "INGESTION_JOB_CONFLICT",
      correlationId,
    );
  }
}

function exactCorrelationId(value?: string): string {
  const correlationId = value ?? createRequestId();
  if (!CORRELATION_ID_PATTERN.test(correlationId)) {
    throw new ApiClientError(
      "The exact ingestion operation requires a bounded correlation id.",
      400,
      "INGESTION_CORRELATION_ID_INVALID",
      "web-ingestion-governance",
    );
  }
  return correlationId;
}

function conflict(message: string, code: string, traceId: string): ApiClientError {
  return new ApiClientError(message, 502, code, traceId);
}

function sortNewestFirst(jobs: IngestionJob[]): IngestionJob[] {
  return [...jobs].sort((left, right) =>
    Date.parse(right.created_at) - Date.parse(left.created_at),
  );
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item !== undefined) {
        results[currentIndex] = await mapper(item);
      }
    }
  }));
  return results;
}
