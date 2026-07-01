import { NextRequest, NextResponse } from "next/server";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";
import type { ApiClients } from "@/lib/types/api";
import { ApiClientError, type ApiRequestContext, type SourceContext } from "@/lib/types";

import { assistantBridgeError, unauthorizedAssistantRequest } from "../../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    chunkId: string;
  }>;
}

async function openCitationSourceContext(
  clients: ApiClients,
  chunkId: string,
  requestContext: ApiRequestContext
): Promise<SourceContext> {
  try {
    return await clients.rag.openAssistantCitation(chunkId, requestContext);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
      return clients.rag.openCitation(chunkId, requestContext);
    }
    throw error;
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { chunkId } = await context.params;
    const requestContext = await getOptionalServerRequestContext(request);
    if (!requestContext) {
      return unauthorizedAssistantRequest();
    }
    const clients = getServerApiClients();
    const sourceContext = await openCitationSourceContext(clients, chunkId, requestContext);

    return NextResponse.json({ source_context: sourceContext });
  } catch (error) {
    return assistantBridgeError(error);
  }
}
