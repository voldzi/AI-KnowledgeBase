import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { canonicalDocumentUrl, embedDocumentUrl } from "@/lib/stratos/document-ai";

import { stratosBridgeError } from "../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const requestContext = await getServerRequestContext();
    const clients = getServerApiClients();
    const document = await clients.registry.getDocument(documentId, requestContext);
    const documentVersionId = request.nextUrl.searchParams.get("version_id")?.trim() || null;
    const chunkId = request.nextUrl.searchParams.get("chunk_id")?.trim() || null;
    const page = request.nextUrl.searchParams.get("page")?.trim() || null;

    return NextResponse.json({
      document_id: document.document_id,
      document_version_id: documentVersionId,
      canonical_open_url: canonicalDocumentUrl({ documentId, documentVersionId, chunkId, page }),
      viewer_url: embedDocumentUrl({ documentId, documentVersionId, chunkId, page })
    });
  } catch (error) {
    return stratosBridgeError(error);
  }
}
