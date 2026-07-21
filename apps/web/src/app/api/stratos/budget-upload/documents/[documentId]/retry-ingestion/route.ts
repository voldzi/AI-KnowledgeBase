import { NextResponse } from "next/server";

import {
  authenticateStratosDocumentServiceJsonRequest,
  requireStratosDocumentSourceAllowed,
  type StratosDocumentServicePrincipal,
} from "@/lib/aiip/application-api";
import {
  getServerApiClients,
  getStratosActorRequestContext,
  requireStratosActorSubjectMatch,
} from "@/lib/api/server";
import { getGovernedIngestionJob } from "@/lib/ingestion/governed-operations";
import {
  ingestionJobIdForIdempotencyKey,
  ingestionServiceRequestContext,
} from "@/lib/ingestion/service-identity";
import {
  createIngestionRequest,
  getExactDocumentVersion,
  getStratosBudgetDocumentStatus,
  mapIngestionStatus,
  requiredString,
  stratosBudgetLineageFromVersion,
  updateStratosBudgetExternalDocumentCurrent,
} from "@/lib/stratos/document-ai";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";

import { stratosBridgeError } from "../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const { principal: service, body } = await authenticateStratosDocumentServiceJsonRequest(request);
    requireStratosDocumentSourceAllowed(service, "STRATOS_BUDGET");
    if (Object.keys(body).length !== 1 || !("operation_id" in body)) {
      throw new ApiClientError(
        "Budget ingestion retry accepts only operation_id.",
        422,
        "STRATOS_BUDGET_RETRY_SCHEMA_INVALID",
        "web-stratos-budget-bridge",
      );
    }
    const operationId = requiredString(body, "operation_id");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(operationId)) {
      throw new ApiClientError(
        "operation_id must be a bounded opaque identifier between 8 and 128 characters.",
        422,
        "STRATOS_BUDGET_RETRY_OPERATION_ID_INVALID",
        "web-stratos-budget-bridge",
      );
    }

    const correlationId = request.headers.get("X-Correlation-ID")?.trim() || crypto.randomUUID();
    const serviceContext = budgetServiceContext(service, correlationId);
    const clients = getServerApiClients();
    const status = await getStratosBudgetDocumentStatus(documentId, serviceContext);
    const reference = exactBudgetReference(status.items, documentId);
    const currentVersionId = reference.current_document_version_id;
    const fileId = reference.current_file_id;
    if (!currentVersionId || !fileId) {
      throw new ApiClientError(
        "The current immutable Budget document version and file are required for retry.",
        409,
        "STRATOS_BUDGET_RETRY_VERSION_REQUIRED",
        correlationId,
      );
    }
    const document = await clients.registry.getDocument(documentId, serviceContext);
    const version = await getExactDocumentVersion(documentId, currentVersionId, serviceContext);
    const lineage = stratosBudgetLineageFromVersion(document, version);
    const actorContext = await retryActorContextForMode(
      request,
      lineage.integrationEnvelope.actor.subjectId,
      lineage.uploadMode,
      correlationId,
    );
    const actorOperationContext = actorContext
      ? { ...actorContext, requestId: correlationId, correlationId }
      : serviceContext;
    const verifiedDocument = await clients.registry.getDocument(documentId, actorOperationContext);
    const verifiedVersion = await getExactDocumentVersion(
      documentId,
      currentVersionId,
      actorOperationContext,
    );
    const verifiedLineage = stratosBudgetLineageFromVersion(verifiedDocument, verifiedVersion);
    if (
      verifiedLineage.uploadMode !== lineage.uploadMode
      || verifiedLineage.integrationEnvelope.actor.subjectId
        !== lineage.integrationEnvelope.actor.subjectId
    ) {
      throw new ApiClientError(
        "The retry lineage changed between service and actor verification.",
        409,
        "STRATOS_BUDGET_RETRY_LINEAGE_CONFLICT",
        correlationId,
      );
    }
    const currentJobId = reference.current_ingestion_job_id;
    const currentJob = currentJobId
      ? await getGovernedIngestionJob(
          clients,
          actorOperationContext,
          {
            documentId,
            documentVersionId: currentVersionId,
            jobId: currentJobId,
            correlationId,
          },
        )
      : null;

    const idempotencyKey = `retry:${documentId}:${currentVersionId}:${operationId}`;
    const authorizationRequest = {
      action: "document.ingest" as const,
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
    };
    const authorization = actorContext
      ? await clients.registry.createIngestionAuthorization(
          documentId,
          currentVersionId,
          authorizationRequest,
          actorOperationContext,
        )
      : await clients.registry.createStratosBudgetHistoricalIngestionAuthorization(
          documentId,
          currentVersionId,
          authorizationRequest,
          actorOperationContext,
        );
    if (
      authorization.confirmed_subject_id !== lineage.integrationEnvelope.actor.subjectId
      || authorization.document_id !== documentId
      || authorization.document_version_id !== currentVersionId
      || authorization.correlation_id !== correlationId
      || authorization.idempotency_key !== idempotencyKey
    ) {
      throw new ApiClientError(
        "Registry returned a conflicting Budget retry authorization.",
        502,
        "INGESTION_AUTHORIZATION_CONFLICT",
        correlationId,
      );
    }

    const ingestionJobId = ingestionJobIdForIdempotencyKey(idempotencyKey);
    const attachStatus = status.ingestion_attempt?.ingestion_job_id === ingestionJobId
      ? status.ingestion_attempt.ingestion_status === "INDEXED"
        ? "INDEXED"
        : status.ingestion_attempt.ingestion_status === "FAILED"
          ? "FAILED"
          : "INGESTING"
      : "INGESTING";
    const current = await updateStratosBudgetExternalDocumentCurrent({
      externalDocumentId: reference.external_document_id,
      documentId,
      expectedCurrentDocumentVersionId: currentVersionId,
      expectedCurrentIngestionJobId: currentJobId,
      documentVersionId: currentVersionId,
      fileId,
      ingestionJobId,
      ingestionStatus: attachStatus,
      lineage,
      externalRef: reference.external_ref,
      serviceContext,
    });
    const selected = current.external_document.external_document;
    if (
      selected.current_document_version_id !== currentVersionId
      || selected.current_file_id !== fileId
      || selected.current_ingestion_job_id !== ingestionJobId
    ) {
      throw new ApiClientError(
        "Registry did not select the exact Budget retry attempt.",
        409,
        "STRATOS_BUDGET_RETRY_CURRENT_CONFLICT",
        correlationId,
      );
    }

    const ingestionContext = await ingestionServiceRequestContext(correlationId);
    const ingestionRequest = createIngestionRequest({
      idempotencyKey,
      documentId,
      versionId: currentVersionId,
      sourceFileUri: version.source_file_uri,
      body: currentJob
        ? {
            parser_profile: currentJob.parser_profile,
            ocr_enabled: currentJob.ocr_enabled,
            chunking_strategy: currentJob.chunking_strategy,
            embedding_profile: currentJob.embedding_profile,
          }
        : {},
      expectedCurrentIngestionJobId: currentJobId,
    });
    let job = await clients.ingestion.createJob(
      ingestionRequest,
      ingestionContext,
      {
        delegatedActorSubjectId: authorization.confirmed_subject_id,
        authorizationToken: authorization.authorization_token,
      },
    );
    if (["pending_authorization", "claiming"].includes(job.status)) {
      job = await clients.ingestion.createJob(
        ingestionRequest,
        ingestionContext,
        {
          delegatedActorSubjectId: authorization.confirmed_subject_id,
          authorizationToken: authorization.authorization_token,
        },
      );
    }
    if (
      job.job_id !== ingestionJobId
      || job.document_id !== documentId
      || job.document_version_id !== currentVersionId
      || ["pending_authorization", "claiming"].includes(job.status)
    ) {
      throw new ApiClientError(
        "The Budget retry attempt did not activate.",
        503,
        "STRATOS_BUDGET_RETRY_ACTIVATION_FAILED",
        correlationId,
      );
    }

    return NextResponse.json(
      {
        document_id: documentId,
        document_version_id: currentVersionId,
        ingestion_job_id: job.job_id,
        ingestion_status: mapIngestionStatus({ version, job }),
      },
      { status: 201 },
    );
  } catch (error) {
    return stratosBridgeError(error);
  }
}

async function retryActorContextForMode(
  request: Request,
  expectedSubjectId: string,
  mode: "interactive" | "historical_batch",
  correlationId: string,
): Promise<ApiRequestContext | null> {
  const actorHeaderPresent = request.headers.get("X-STRATOS-Actor-Authorization") !== null;
  if (mode === "historical_batch") {
    if (actorHeaderPresent) {
      throw new ApiClientError(
        "Historical batch retry must remain service-only.",
        409,
        "STRATOS_BUDGET_RETRY_MODE_CONFLICT",
        correlationId,
      );
    }
    return null;
  }
  if (!actorHeaderPresent) {
    throw new ApiClientError(
      "A fresh STRATOS actor bearer is required for interactive retry.",
      401,
      "STRATOS_BUDGET_ACTOR_AUTH_REQUIRED",
      correlationId,
    );
  }
  const actorContext = await getStratosActorRequestContext(request);
  requireStratosActorSubjectMatch(actorContext, expectedSubjectId);
  return actorContext;
}

function exactBudgetReference(
  items: Awaited<ReturnType<typeof getStratosBudgetDocumentStatus>>["items"],
  documentId: string,
) {
  const matches = items.filter(
    (item) => item.external_system === "STRATOS_BUDGET" && item.document_id === documentId,
  );
  if (matches.length !== 1) {
    throw new ApiClientError(
      "The exact Budget external document projection is unavailable or ambiguous.",
      409,
      "STRATOS_BUDGET_STATUS_AMBIGUOUS",
      "web-stratos-budget-bridge",
    );
  }
  return matches[0];
}

function budgetServiceContext(
  service: StratosDocumentServicePrincipal,
  correlationId: string,
): ApiRequestContext {
  return {
    subjectId: service.subjectId,
    roles: service.roles,
    organizationId: "org_stratos",
    identityActive: true,
    membershipActive: false,
    applicationAccessActive: false,
    authorizationSource: "stratos_projection",
    serviceClientId: service.clientId,
    accessToken: service.accessToken,
    requestId: correlationId,
    correlationId,
  };
}
