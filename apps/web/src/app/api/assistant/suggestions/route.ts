import { NextResponse } from "next/server";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";
import { getAklConfig } from "@/lib/api/config";
import { personalizedAssistantSuggestions } from "@/lib/assistant/personalized-suggestions";
import { isAklLanguage } from "@/lib/language";

import { assistantBridgeError, unauthorizedAssistantRequest } from "../errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getOptionalServerRequestContext(request);
    if (!context) {
      return unauthorizedAssistantRequest();
    }
    const clients = getServerApiClients();
    const requestedLanguage = new URL(request.url).searchParams.get("language");
    const conversations = await clients.registry
      .listAssistantConversations(context, true, true)
      .then((response) => response.items)
      .catch(() => []);
    const response = await personalizedAssistantSuggestions({
      context,
      config: getAklConfig(),
      conversations,
      language: isAklLanguage(requestedLanguage) ? requestedLanguage : "cs",
    });

    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return assistantBridgeError(error);
  }
}
