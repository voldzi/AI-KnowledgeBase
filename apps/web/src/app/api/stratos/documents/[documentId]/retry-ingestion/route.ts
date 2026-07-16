import { NextResponse } from "next/server";

import { authenticateAiipDocumentServiceJsonRequest } from "@/lib/aiip/application-api";
import { getAiipActorRequestContext, getServerApiClients } from "@/lib/api/server";
import { getGovernedIngestionJob } from "@/lib/ingestion/governed-operations";
import { ingestionServiceRequestContext } from "@/lib/ingestion/service-identity";
import {
  assertExactFields,
  createIngestionRequest,
  getDocumentExternalReferencesCurrent,
  getExactDocumentVersion,
  mapIngestionStatus,
  requiredString,
} from "@/lib/stratos/document-ai";
import { ApiClientError } from "@/lib/types";

import { stratosBridgeError } from "../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const { body } = await authenticateAiipDocumentServiceJsonRequest(request);
    assertExactFields(body, ["operation_id"], "AIIP ingestion retry");
    const operationId = requiredString(body, "operation_id");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(operationId)) {
      throw new ApiClientError(
        "operation_id must be a bounded opaque identifier between 8 and 128 characters.",
        422,
        "AIIP_RETRY_OPERATION_ID_INVALID",
        "web-stratos-bridge",
      );
    }
    const actorContext = await getAiipActorRequestContext(request);
    const correlationId = request.headers.get("X-Correlation-ID")?.trim() || crypto.randomUUID();
    const serviceContext = await ingestionServiceRequestContext(correlationId);
    const clients = getServerApiClients();
    const authorization = await clients.registry.authorizeDocument(
      documentId,
      "document.ingest",
      { ...actorContext, requestId: correlationId, correlationId },
    );
    if (!authorization.allowed) {
      throw new ApiClientError(
        "The current AIIP actor cannot retry ingestion for this exact governed AKB document.",
        403,
        "AIIP_DOCUMENT_INGEST_DENIED",
        "web-stratos-bridge",
      );
    }
    const externalReferences = await getDocumentExternalReferencesCurrent(documentId, actorContext);
    const externalReference = externalReferences.find((item) => item.external_system === "STRATOS_AIIP");
    const currentVersionId = externalReference?.current_document_version_id;
    const currentJobId = externalReference?.current_ingestion_job_id;
    if (!externalReference || !currentVersionId || !currentJobId) {
      throw new ApiClientError(
        "The exact current AIIP document version and ingestion attempt are required for retry.",
        409,
        "AIIP_RETRY_CURRENT_ATTEMPT_REQUIRED",
        "web-stratos-bridge",
      );
    }
    const version = await getExactDocumentVersion(documentId, currentVersionId, actorContext);
    const currentJob = await getGovernedIngestionJob(
      clients,
      actorContext,
      {
        documentId,
        documentVersionId: version.document_version_id,
        jobId: currentJobId,
        correlationId,
      },
    );
    const idempotencyKey = `retry:${documentId}:${currentVersionId}:${operationId}`;
    const ingestionAuthorization = await clients.registry.createIngestionAuthorization(
      documentId,
      version.document_version_id,
      {
        action: "document.ingest",
        correlation_id: correlationId,
        idempotency_key: idempotencyKey,
      },
      { ...actorContext, requestId: correlationId, correlationId },
    );
    if (
      ingestionAuthorization.confirmed_subject_id !== actorContext.subjectId ||
      ingestionAuthorization.document_id !== documentId ||
      ingestionAuthorization.document_version_id !== version.document_version_id ||
      ingestionAuthorization.correlation_id !== correlationId ||
      ingestionAuthorization.idempotency_key !== idempotencyKey
    ) {
      throw new ApiClientError(
        "Registry returned a conflicting ingestion authorization.",
        502,
        "INGESTION_AUTHORIZATION_CONFLICT",
        correlationId,
      );
    }
    const job = await clients.ingestion.createJob(
      createIngestionRequest({
        idempotencyKey,
        documentId,
        versionId: version.document_version_id,
        sourceFileUri: version.source_file_uri,
        body: {
          parser_profile: currentJob.parser_profile,
          ocr_enabled: currentJob.ocr_enabled,
          chunking_strategy: currentJob.chunking_strategy,
          embedding_profile: currentJob.embedding_profile,
        },
        expectedCurrentIngestionJobId: currentJobId,
      }),
      serviceContext,
      {
        delegatedActorSubjectId: ingestionAuthorization.confirmed_subject_id,
        authorizationToken: ingestionAuthorization.authorization_token,
      },
    );

    return NextResponse.json(
      {
        document_id: documentId,
        document_version_id: version.document_version_id,
        ingestion_job_id: job.job_id,
        ingestion_status: mapIngestionStatus({ version, job })
      },
      { status: 201 }
    );
  } catch (error) {
    return stratosBridgeError(error);
  }
}
