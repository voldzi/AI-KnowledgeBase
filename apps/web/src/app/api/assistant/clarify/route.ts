import { NextRequest, NextResponse } from "next/server";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";
import { normalizeAssistantChatResponse } from "@/lib/assistant/assistant-response-normalizer";
import { ragContextForAssistantRoute, routeAssistantMessageForRag } from "@/lib/assistant/assistant-tool-router";
import { isAklLanguage } from "@/lib/language";

import { assistantBridgeError, badAssistantRequest, unauthorizedAssistantRequest } from "../errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await getOptionalServerRequestContext(request);
    if (!context) {
      return unauthorizedAssistantRequest();
    }
    const clients = getServerApiClients();
    const message = String(body.message ?? "").trim();

    if (!message) {
      return badAssistantRequest("message is required.");
    }
    const responseLanguage = isAklLanguage(body.response_language) ? body.response_language : "cs";
    const requestContext = _objectContext(body.context);
    const assistantRoute = routeAssistantMessageForRag(message, responseLanguage, requestContext);

    const response = await clients.rag.assistantClarify(
      {
        user_id: context.subjectId,
        conversation_id: typeof body.conversation_id === "string" ? body.conversation_id : null,
        message,
        context: ragContextForAssistantRoute(requestContext, assistantRoute),
        mode: body.mode ?? "it_support_answer",
        response_language: responseLanguage
      },
      context
    );

    return NextResponse.json({
      response: normalizeAssistantChatResponse({
        response,
        message,
        language: responseLanguage,
        route: assistantRoute
      })
    });
  } catch (error) {
    return assistantBridgeError(error);
  }
}

function _objectContext(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
