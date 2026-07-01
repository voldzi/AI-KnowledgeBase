import { NextRequest, NextResponse } from "next/server";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";

import { assistantBridgeError, unauthorizedAssistantRequest } from "../../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    conversationId: string;
  }>;
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const requestContext = await getOptionalServerRequestContext(request);
    if (!requestContext) {
      return unauthorizedAssistantRequest();
    }
    const { conversationId } = await context.params;
    const body = await request.json();
    const clients = getServerApiClients();
    const conversation = await clients.registry.replaceAssistantConversationShares(conversationId, body, requestContext);
    return NextResponse.json({ conversation });
  } catch (error) {
    return assistantBridgeError(error);
  }
}
