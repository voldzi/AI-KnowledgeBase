import { NextRequest, NextResponse } from "next/server";

import {
  getServerApiClients,
  getServerRequestContextForRequest,
} from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { refreshPublishedVersionIndexes } from "@/lib/ingestion/governed-operations";

import { documentWorkflowBridgeError } from "../../../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    documentId: string;
    versionId: string;
  }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { documentId, versionId } = await context.params;
    const requestContext = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;
    const clients = getServerApiClients();
    const version = await clients.registry.publishDocumentVersion(documentId, versionId, requestContext);
    const { job } = await refreshPublishedVersionIndexes(
      clients,
      requestContext,
      documentId,
      version.document_version_id,
    );

    return NextResponse.json({
      version,
      index_refresh: {
        ingestion_job_id: job.job_id,
        ingestion_status: job.status,
      },
    });
  } catch (error) {
    return documentWorkflowBridgeError(error);
  }
}
