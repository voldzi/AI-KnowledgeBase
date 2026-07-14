import { NextResponse } from "next/server";

import { authenticateAiipServiceRequest } from "@/lib/aiip/application-api";
import { getAiipActorRequestContext, getServerApiClients } from "@/lib/api/server";
import { latestVersion, mapIngestionStatus } from "@/lib/stratos/document-ai";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";

import { stratosBridgeError } from "../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const service = await authenticateAiipServiceRequest(request);
    const actorContext = await getAiipActorRequestContext(request);
    const correlationId = request.headers.get("X-Correlation-ID")?.trim() || crypto.randomUUID();
    const serviceContext: ApiRequestContext = {
      subjectId: service.subjectId,
      roles: service.roles,
      organizationId: "org_stratos",
      authorizationSource: "stratos_projection",
      accessToken: service.accessToken,
      requestId: correlationId,
      correlationId,
    };
    const clients = getServerApiClients();
    const authorization = await clients.registry.authorizeDocument(
      documentId,
      "document.read",
      actorContext,
    );
    if (!authorization.allowed) {
      throw new ApiClientError(
        "The current AIIP actor cannot read this exact governed AKB document.",
        403,
        "AIIP_DOCUMENT_ACCESS_DENIED",
        "web-stratos-bridge",
      );
    }
    const [document, versions, jobs] = await Promise.all([
      clients.registry.getDocument(documentId, actorContext),
      clients.registry.listDocumentVersions(documentId, actorContext),
      clients.ingestion.listJobs(serviceContext).catch(() => [])
    ]);
    const version = latestVersion(versions);
    const job = version
      ? jobs.find((candidate) => candidate.document_version_id === version.document_version_id) ?? null
      : null;

    return NextResponse.json({
      document_id: document.document_id,
      document_version_id: version?.document_version_id ?? null,
      ingestion_job_id: job?.job_id ?? null,
      ingestion_status: mapIngestionStatus({ version, job }),
      updated_at: job?.finished_at ?? job?.started_at ?? job?.created_at ?? version?.created_at ?? document.updated_at,
      error_code: job?.status === "failed" ? "INGESTION_FAILED" : null,
      error_message: null
    });
  } catch (error) {
    return stratosBridgeError(error);
  }
}
