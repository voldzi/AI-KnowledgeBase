import { NextRequest, NextResponse } from "next/server";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";
import { getAklConfig } from "@/lib/api/config";
import { contextFromStratosAccessProjection } from "@/lib/auth/access-projection";
import { authorizeDirectorCopilotHistory } from "@/lib/director-copilot/history";
import type {
  ApiClients,
  AssistantConversationDetail,
  AssistantConversationMessage,
} from "@/lib/types";

import { assistantBridgeError, unauthorizedAssistantRequest } from "../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    conversationId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const requestContext = await getOptionalServerRequestContext(request);
    if (!requestContext) {
      return unauthorizedAssistantRequest();
    }
    const { conversationId } = await context.params;
    const clients = getServerApiClients();
    const conversation = await clients.registry.getAssistantConversation(conversationId, requestContext);
    const authorizationContext = await freshAuthorizationContext(requestContext);
    return NextResponse.json({
      conversation: await reauthorizeFederatedHistory(
        conversation,
        authorizationContext.context,
        authorizationContext.available,
        clients,
      ),
    });
  } catch (error) {
    return assistantBridgeError(error);
  }
}

async function reauthorizeFederatedHistory(
  conversation: AssistantConversationDetail,
  actorContext: Parameters<typeof authorizeDirectorCopilotHistory>[0]["actorContext"],
  authorizationProjectionAvailable = true,
  clients?: Pick<ApiClients, "registry">,
): Promise<AssistantConversationDetail> {
  let previousUserMessage = "";
  const messages: AssistantConversationMessage[] = [];
  for (const message of conversation.messages) {
    if (message.role === "user") {
      previousUserMessage = message.content;
      messages.push(message);
      continue;
    }
    if (
      message.availability === "source_access_changed"
      || !message.metadata.director_copilot_history
    ) {
      messages.push(message);
      continue;
    }
    if (!authorizationProjectionAvailable) {
      messages.push(unavailableHistoryMessage(message, "source_unavailable"));
      continue;
    }
    const authorization = await authorizeDirectorCopilotHistory({
      message,
      previousUserMessage,
      actorContext,
      config: getAklConfig(),
      clients,
    });
    if (authorization.status === "allowed") {
      messages.push(message);
      continue;
    }
    messages.push(unavailableHistoryMessage(message, authorization.status));
  }
  return { ...conversation, messages };
}

async function freshAuthorizationContext(
  requestContext: Parameters<typeof authorizeDirectorCopilotHistory>[0]["actorContext"],
): Promise<{
  context: Parameters<typeof authorizeDirectorCopilotHistory>[0]["actorContext"];
  available: boolean;
}> {
  if (!requestContext.accessToken) {
    return { context: requestContext, available: true };
  }
  try {
    const refreshed = await contextFromStratosAccessProjection(
      requestContext.accessToken,
      getAklConfig(),
      fetch,
      Date.now(),
      true,
    );
    return {
      context: {
        ...refreshed,
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId,
      },
      available: true,
    };
  } catch {
    return { context: requestContext, available: false };
  }
}

function unavailableHistoryMessage(
  message: AssistantConversationMessage,
  status: "access_changed" | "source_unavailable",
): AssistantConversationMessage {
  return {
    ...message,
    content: "",
    citations: [],
    metadata: {
      history_access_changed: status === "access_changed",
      history_source_temporarily_unavailable: status === "source_unavailable",
    },
    availability: status === "access_changed"
      ? "source_access_changed"
      : "source_temporarily_unavailable",
  };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const requestContext = await getOptionalServerRequestContext(request);
    if (!requestContext) {
      return unauthorizedAssistantRequest();
    }
    const { conversationId } = await context.params;
    const body = await request.json();
    const clients = getServerApiClients();
    const conversation = await clients.registry.updateAssistantConversation(conversationId, body, requestContext);
    return NextResponse.json({ conversation });
  } catch (error) {
    return assistantBridgeError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const requestContext = await getOptionalServerRequestContext(request);
    if (!requestContext) {
      return unauthorizedAssistantRequest();
    }
    const { conversationId } = await context.params;
    const clients = getServerApiClients();
    await clients.registry.deleteAssistantConversation(
      conversationId,
      requestContext,
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return assistantBridgeError(error);
  }
}
