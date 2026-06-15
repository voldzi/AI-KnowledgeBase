import { NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { createIngestionRequest, latestVersion, mapIngestionStatus } from "@/lib/stratos/document-ai";
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
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const requestContext = await getServerRequestContextForRequest(request);
    const clients = getServerApiClients();
    const versions = await clients.registry.listDocumentVersions(documentId, requestContext);
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
      requestContext
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
