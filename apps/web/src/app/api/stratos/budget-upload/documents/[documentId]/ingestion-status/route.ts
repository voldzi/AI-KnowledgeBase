import { NextResponse } from "next/server";

import {
  authenticateStratosDocumentServiceRequest,
  requireStratosDocumentSourceAllowed,
  type StratosDocumentServicePrincipal,
} from "@/lib/aiip/application-api";
import { getStratosBudgetDocumentStatus, type StratosIngestionStatus } from "@/lib/stratos/document-ai";
import { ApiClientError, type ApiRequestContext, type RegistryIngestionAttempt } from "@/lib/types";

import { stratosBridgeError } from "../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const service = await authenticateStratosDocumentServiceRequest(request);
    requireStratosDocumentSourceAllowed(service, "STRATOS_BUDGET");
    const correlationId = request.headers.get("X-Correlation-ID")?.trim() || crypto.randomUUID();
    const status = await getStratosBudgetDocumentStatus(
      documentId,
      budgetServiceContext(service, correlationId),
    );
    const reference = exactBudgetReference(status.items, documentId);
    const attempt = status.ingestion_attempt;
    if (
      attempt
      && (
        attempt.document_id !== documentId
        || attempt.document_version_id !== reference.current_document_version_id
        || attempt.ingestion_job_id !== reference.current_ingestion_job_id
      )
    ) {
      throw new ApiClientError(
        "Registry returned a conflicting Budget ingestion attempt projection.",
        502,
        "STRATOS_BUDGET_STATUS_CONFLICT",
        correlationId,
      );
    }

    return NextResponse.json({
      document_id: documentId,
      document_version_id: reference.current_document_version_id,
      ingestion_job_id: reference.current_ingestion_job_id,
      ingestion_status: projectedStatus(reference.current_document_version_id, reference.current_ingestion_status, attempt),
      updated_at: attempt?.updated_at ?? reference.updated_at,
      error_code: attempt?.ingestion_status === "FAILED" ? "INGESTION_FAILED" : null,
      error_message: null,
    });
  } catch (error) {
    return stratosBridgeError(error);
  }
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

function projectedStatus(
  versionId: string | null,
  externalStatus: string | null,
  attempt: RegistryIngestionAttempt | null,
): StratosIngestionStatus {
  if (!versionId) return "REGISTERED";
  if (!attempt) return externalStatus === "FAILED" ? "FAILED" : "VERSION_CREATED";
  if (attempt.ingestion_status === "INDEXED") return "INDEXED";
  if (attempt.ingestion_status === "FAILED") return "FAILED";
  return "INGESTING";
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
