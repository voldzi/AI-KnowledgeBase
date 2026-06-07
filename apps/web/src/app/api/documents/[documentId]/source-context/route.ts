import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

import { documentWorkflowBadRequest, documentWorkflowBridgeError } from "../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const chunkId = request.nextUrl.searchParams.get("chunk_id")?.trim();
  if (!chunkId) {
    return documentWorkflowBadRequest("chunk_id query parameter is required.");
  }

  try {
    const { documentId } = await context.params;
    const requestContext = await getServerRequestContext();
    const clients = getServerApiClients();
    const [document, versions, sourceContext] = await Promise.all([
      clients.registry.getDocument(documentId, requestContext),
      clients.registry.listDocumentVersions(documentId, requestContext),
      clients.rag.openCitation(chunkId, requestContext)
    ]);
    const versionIds = new Set(versions.map((version) => version.document_version_id));

    if (sourceContext.document_id !== document.document_id) {
      return documentWorkflowBadRequest("Source context belongs to a different document.", 409);
    }
    if (!versionIds.has(sourceContext.document_version_id)) {
      return documentWorkflowBadRequest("Source context belongs to a version outside this document detail.", 409);
    }

    return NextResponse.json({ source_context: sourceContext });
  } catch (error) {
    return documentWorkflowBridgeError(error);
  }
}
