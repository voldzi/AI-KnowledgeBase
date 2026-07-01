import { NextResponse } from "next/server";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";
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
    const response = await clients.rag.assistantSuggestions(
      context,
      isAklLanguage(requestedLanguage) ? requestedLanguage : "cs"
    );

    return NextResponse.json(response);
  } catch (error) {
    return assistantBridgeError(error);
  }
}
