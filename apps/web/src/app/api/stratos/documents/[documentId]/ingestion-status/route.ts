import { NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { latestVersion, mapIngestionStatus } from "@/lib/stratos/document-ai";

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
    const requestContext = await getServerRequestContextForRequest(request);
    const clients = getServerApiClients();
    const [document, versions, jobs] = await Promise.all([
      clients.registry.getDocument(documentId, requestContext),
      clients.registry.listDocumentVersions(documentId, requestContext),
      clients.ingestion.listJobs(requestContext).catch(() => [])
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
