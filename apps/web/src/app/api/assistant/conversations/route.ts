import { NextResponse } from "next/server";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";

import { assistantBridgeError, unauthorizedAssistantRequest } from "../errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getOptionalServerRequestContext(request);
    if (!context) {
      return unauthorizedAssistantRequest();
    }
    const includeArchived = new URL(request.url).searchParams.get("include_archived") === "true";
    const clients = getServerApiClients();
    const response = await clients.registry.listAssistantConversations(context, includeArchived);
    return NextResponse.json(response);
  } catch (error) {
    return assistantBridgeError(error);
  }
}
