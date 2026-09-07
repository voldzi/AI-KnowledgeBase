import "server-only";

import {
  getStratosActorRequestContext,
  requireStratosActorSubjectMatch,
} from "@/lib/stratos/actor-authorization";
import type { StratosDocumentServicePrincipal } from "@/lib/stratos/document-service-auth";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";

export async function budgetActorContextForMode(
  request: Request,
  expectedSubjectId: string,
  mode: "interactive" | "historical_batch",
  correlationId: string,
  resolveActor: (request: Request) => Promise<ApiRequestContext> = getStratosActorRequestContext,
): Promise<ApiRequestContext | null> {
  const actorHeaderPresent = request.headers.get("X-STRATOS-Actor-Authorization") !== null;
  if (mode === "historical_batch") {
    if (actorHeaderPresent) {
      throw new ApiClientError(
        "Historical batch intake must remain service-only.",
        409,
        "STRATOS_BUDGET_UPLOAD_MODE_CONFLICT",
        correlationId,
      );
    }
    return null;
  }
  if (!actorHeaderPresent) {
    throw new ApiClientError(
      "A fresh STRATOS actor bearer is required for interactive intake.",
      401,
      "STRATOS_BUDGET_ACTOR_AUTH_REQUIRED",
      correlationId,
    );
  }
  const actorContext = await resolveActor(request);
  requireStratosActorSubjectMatch(actorContext, expectedSubjectId);
  return actorContext;
}

export function budgetServiceContext(
  service: StratosDocumentServicePrincipal,
  correlationId: string,
): ApiRequestContext {
  return {
    subjectId: service.subjectId,
    roles: service.roles,
    organizationId: "org_stratos",
    identityActive: true,
    membershipActive: false,
    applicationAccessActive: false,
    authorizationSource: "stratos_projection",
    serviceClientId: service.clientId,
    accessToken: service.accessToken,
    requestId: correlationId,
    correlationId,
  };
}
