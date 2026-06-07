import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { isAklLanguage } from "@/lib/language";

import { assistantBridgeError, badAssistantRequest } from "../errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await getServerRequestContext();
    const clients = getServerApiClients();
    const message = String(body.message ?? "").trim();

    if (!message) {
      return badAssistantRequest("message is required.");
    }

    const response = await clients.rag.assistantClarify(
      {
        user_id: context.subjectId,
        conversation_id: typeof body.conversation_id === "string" ? body.conversation_id : null,
        message,
        context: _objectContext(body.context),
        mode: body.mode ?? "it_support_answer",
        response_language: isAklLanguage(body.response_language) ? body.response_language : "cs"
      },
      context
    );

    return NextResponse.json({ response });
  } catch (error) {
    return assistantBridgeError(error);
  }
}

function _objectContext(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
