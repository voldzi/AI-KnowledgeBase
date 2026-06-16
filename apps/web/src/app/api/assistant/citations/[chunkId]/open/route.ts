import { NextRequest, NextResponse } from "next/server";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";

import { assistantBridgeError, unauthorizedAssistantRequest } from "../../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    chunkId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { chunkId } = await context.params;
    const requestContext = await getOptionalServerRequestContext(request);
    if (!requestContext) {
      return unauthorizedAssistantRequest();
    }
    const clients = getServerApiClients();
    const sourceContext = await clients.rag.openAssistantCitation(chunkId, requestContext);

    return NextResponse.json({ source_context: sourceContext });
  } catch (error) {
    return assistantBridgeError(error);
  }
}
