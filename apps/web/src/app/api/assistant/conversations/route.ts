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

export async function POST(request: Request) {
  try {
    const context = await getOptionalServerRequestContext(request);
    if (!context) {
      return unauthorizedAssistantRequest();
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const title = typeof body.title === "string"
      ? body.title.replace(/\s+/g, " ").trim().slice(0, 300)
      : null;
    const clients = getServerApiClients();
    const conversation = await clients.registry.createAssistantConversation(
      {
        title: title || null,
        visibility: "private",
      },
      context,
    );
    return NextResponse.json({ conversation });
  } catch (error) {
    return assistantBridgeError(error);
  }
}
