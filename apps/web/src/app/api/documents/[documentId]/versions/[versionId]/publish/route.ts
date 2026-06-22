import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";

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
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;
    const clients = getServerApiClients();
    const version = await clients.registry.publishDocumentVersion(documentId, versionId, requestContext);

    return NextResponse.json({ version });
  } catch (error) {
    return documentWorkflowBridgeError(error);
  }
}
