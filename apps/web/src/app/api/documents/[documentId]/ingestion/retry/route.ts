import { NextRequest, NextResponse } from "next/server";

import {
  getServerApiClients,
  getServerRequestContextForRequest,
} from "@/lib/api/server";
import { retryCurrentGovernedIngestionAttempt } from "@/lib/ingestion/governed-operations";
import { mapIngestionStatus } from "@/lib/stratos/document-ai";

import { documentWorkflowBadRequest, documentWorkflowBridgeError } from "../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (
      !body
      || Array.isArray(body)
      || Object.keys(body).some((field) => field !== "operation_id")
      || typeof body.operation_id !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(body.operation_id)
    ) {
      return documentWorkflowBadRequest(
        "A bounded operation_id is required for an ingestion retry.",
        400,
      );
    }

    const { documentId } = await context.params;
    const actorContext = await getServerRequestContextForRequest(request);
    const clients = getServerApiClients();
    const { job, version } = await retryCurrentGovernedIngestionAttempt(
      clients,
      actorContext,
      documentId,
      body.operation_id,
    );

    return NextResponse.json(
      {
        document_id: documentId,
        document_version_id: version.document_version_id,
        ingestion_job_id: job.job_id,
        ingestion_status: mapIngestionStatus({ version, job }),
      },
      { status: 201 },
    );
  } catch (error) {
    return documentWorkflowBridgeError(error);
  }
}
