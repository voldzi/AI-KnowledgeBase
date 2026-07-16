import { NextResponse } from "next/server";

import { authenticateAiipDocumentServiceRequest } from "@/lib/aiip/application-api";
import { getAiipActorRequestContext, getServerApiClients } from "@/lib/api/server";
import { getGovernedIngestionJob } from "@/lib/ingestion/governed-operations";
import {
  getDocumentExternalReferencesCurrent,
  getExactDocumentVersion,
  mapIngestionStatus,
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

export async function GET(request: Request, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    await authenticateAiipDocumentServiceRequest(request);
    const actorContext = await getAiipActorRequestContext(request);
    const correlationId = request.headers.get("X-Correlation-ID")?.trim() || crypto.randomUUID();
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
    const [document, externalReferences] = await Promise.all([
      clients.registry.getDocument(documentId, actorContext),
      getDocumentExternalReferencesCurrent(documentId, actorContext),
    ]);
    const externalReference = externalReferences.find((item) => item.external_system === "STRATOS_AIIP") ?? null;
    const version = externalReference?.current_document_version_id
      ? await getExactDocumentVersion(documentId, externalReference.current_document_version_id, actorContext)
      : null;
    let job = null;
    if (externalReference?.current_ingestion_job_id && version) {
      job = await getGovernedIngestionJob(
        clients,
        actorContext,
        {
          documentId,
          documentVersionId: version.document_version_id,
          jobId: externalReference.current_ingestion_job_id,
          correlationId,
        },
      );
    }

    return NextResponse.json({
      document_id: document.document_id,
      document_version_id: version?.document_version_id ?? null,
      ingestion_job_id: job?.job_id ?? null,
      ingestion_status: mapIngestionStatus({
        version,
        job,
        externalStatus: externalReference?.current_ingestion_status,
      }),
      updated_at: job?.finished_at ?? job?.started_at ?? job?.created_at ?? version?.created_at ?? document.updated_at,
      error_code: job?.status === "failed" ? "INGESTION_FAILED" : null,
      error_message: null
    });
  } catch (error) {
    return stratosBridgeError(error);
  }
}
