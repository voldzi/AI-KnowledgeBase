import "server-only";

import { getAklConfig } from "@/lib/api/config";
import { contextFromStratosAccessProjection } from "@/lib/auth/access-projection";
import { authorizeDirectorCopilotV2History } from "@/lib/director-copilot-v2/history";
import type { ApiClients, ApiRequestContext, AssistantConversationDetail, AssistantConversationMessage } from "@/lib/types";

export async function authorizeAssistantHistoryResponse(
  conversation: AssistantConversationDetail,
  requestContext: ApiRequestContext,
  clients: Pick<ApiClients, "registry">,
): Promise<AssistantConversationDetail> {
  const authorization = await freshAuthorizationContext(requestContext);
  return reauthorizeFederatedHistory(conversation, authorization.context, authorization.available, clients);
}

export async function reauthorizeFederatedHistory(
  conversation: AssistantConversationDetail,
  actorContext: Parameters<typeof authorizeDirectorCopilotV2History>[0]["actorContext"],
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
      || !Object.hasOwn(message.metadata, "director_copilot_history")
    ) {
      messages.push(message);
      continue;
    }
    if (!authorizationProjectionAvailable) {
      messages.push(unavailableHistoryMessage(message, "source_unavailable"));
      continue;
    }
    const authorization = await authorizeDirectorCopilotV2History({
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
  const unavailable = messages.find((message) => message.availability === "source_access_changed"
    || message.availability === "source_temporarily_unavailable");
  if (!unavailable && authorizationProjectionAvailable) return { ...conversation, messages };
  // Follow-up prompts and uncited answers may quote earlier source material.
  // The stored model has no complete turn-dependency graph, so retain only
  // structural history until every source can be authorized again.
  const status = unavailable?.availability === "source_access_changed" ? "access_changed" : "source_unavailable";
  return { ...conversation, title: null, messages: messages.map((message) => unavailableHistoryMessage(message, status)) };
}

export async function freshAuthorizationContext(
  requestContext: Parameters<typeof authorizeDirectorCopilotV2History>[0]["actorContext"],
): Promise<{
  context: Parameters<typeof authorizeDirectorCopilotV2History>[0]["actorContext"];
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
    viewer_feedback: null,
    metadata: {
      history_access_changed: status === "access_changed",
      history_source_temporarily_unavailable: status === "source_unavailable",
      ...(message.metadata.history_live_source_refresh_required === true
        ? { history_live_source_refresh_required: true } : {}),
      ...(message.metadata.history_source_refresh_required === true
        ? { history_source_refresh_required: true } : {}),
    },
    availability: status === "access_changed"
      ? "source_access_changed"
      : "source_temporarily_unavailable",
  };
}
