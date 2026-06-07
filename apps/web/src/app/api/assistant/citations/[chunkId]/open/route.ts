import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

import { assistantBridgeError } from "../../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    chunkId: string;
  }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { chunkId } = await context.params;
    const requestContext = await getServerRequestContext();
    const clients = getServerApiClients();
    const sourceContext = await clients.rag.openAssistantCitation(chunkId, requestContext);

    return NextResponse.json({ source_context: sourceContext });
  } catch (error) {
    return assistantBridgeError(error);
  }
}
