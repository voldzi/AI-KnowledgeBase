import { NextRequest, NextResponse } from "next/server";

import {
  getOptionalServerRequestContext,
  getServerApiClients,
} from "@/lib/api/server";
import type {
  AssistantMessageFeedbackPutRequest,
  AssistantMessageFeedbackRating,
  AssistantMessageFeedbackReason,
} from "@/lib/types";

import { assistantBridgeError, badAssistantRequest, unauthorizedAssistantRequest } from "../../../../../errors";

export const runtime = "nodejs";

const RATINGS = new Set<AssistantMessageFeedbackRating>([
  "helpful",
  "not_helpful",
]);
const REASONS = new Set<AssistantMessageFeedbackReason>([
  "accurate_useful",
  "incomplete",
  "incorrect",
  "citation_problem",
  "access_problem",
  "other",
]);

interface RouteContext {
  params: Promise<{
    conversationId: string;
    messageId: string;
  }>;
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const requestContext = await getOptionalServerRequestContext(request);
    if (!requestContext) {
      return unauthorizedAssistantRequest();
    }
    const body = await request.json();
    const rating = body.rating as AssistantMessageFeedbackRating;
    const reasonCode = body.reason_code as
      | AssistantMessageFeedbackReason
      | null
      | undefined;
    if (!RATINGS.has(rating)) {
      return badAssistantRequest("A supported feedback rating is required.");
    }
    if (reasonCode != null && !REASONS.has(reasonCode)) {
      return badAssistantRequest("A supported feedback reason is required.");
    }
    if (rating === "not_helpful" && reasonCode == null) {
      return badAssistantRequest(
        "A feedback reason is required when the answer did not help.",
      );
    }
    const payload: AssistantMessageFeedbackPutRequest = {
      rating,
      reason_code: reasonCode ?? null,
    };
    const { conversationId, messageId } = await context.params;
    const clients = getServerApiClients();
    const feedback = await clients.registry.putAssistantMessageFeedback(
      conversationId,
      messageId,
      payload,
      requestContext,
    );
    return NextResponse.json({ feedback });
  } catch (error) {
    return assistantBridgeError(error);
  }
}
