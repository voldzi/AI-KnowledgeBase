import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

import { documentWorkflowBridgeError } from "../../../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    documentId: string;
    versionId: string;
  }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { documentId, versionId } = await context.params;
    const requestContext = await getServerRequestContext();
    const clients = getServerApiClients();
    const version = await clients.registry.archiveDocumentVersion(documentId, versionId, requestContext);

    return NextResponse.json({ version });
  } catch (error) {
    return documentWorkflowBridgeError(error);
  }
}
