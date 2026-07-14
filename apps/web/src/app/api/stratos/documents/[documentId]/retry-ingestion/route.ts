import { NextResponse } from "next/server";

import { authenticateAiipServiceJsonRequest } from "@/lib/aiip/application-api";
import { getAiipActorRequestContext, getServerApiClients } from "@/lib/api/server";
import { createIngestionRequest, latestVersion, mapIngestionStatus } from "@/lib/stratos/document-ai";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";

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
    const { principal: service, body } = await authenticateAiipServiceJsonRequest(request);
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
      "document.ingest",
      actorContext,
    );
    if (!authorization.allowed) {
      throw new ApiClientError(
        "The current AIIP actor cannot retry ingestion for this exact governed AKB document.",
        403,
        "AIIP_DOCUMENT_INGEST_DENIED",
        "web-stratos-bridge",
      );
    }
    const versions = await clients.registry.listDocumentVersions(documentId, actorContext);
    const version = latestVersion(versions);
    if (!version) {
      throw new ApiClientError("Document has no version to ingest.", 404, "DOCUMENT_VERSION_NOT_FOUND", "web-stratos-bridge");
    }
    const job = await clients.ingestion.createJob(
      createIngestionRequest({
        documentId,
        versionId: version.document_version_id,
        sourceFileUri: version.source_file_uri,
        body
      }),
      serviceContext
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
