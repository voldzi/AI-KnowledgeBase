import "server-only";

import { getAklConfig } from "@/lib/api/config";
import { contextFromStratosAccessProjection } from "@/lib/auth/access-projection";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";

type ActorRequest = Pick<Request, "headers">;

export async function getStratosActorRequestContext(
  request: ActorRequest,
): Promise<ApiRequestContext> {
  const authorization = request.headers.get("X-STRATOS-Actor-Authorization") ?? "";
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new ApiClientError(
      "A fresh STRATOS actor bearer is required.",
      401,
      "STRATOS_ACTOR_AUTH_REQUIRED",
      "web-stratos-bridge",
    );
  }
  return contextFromStratosAccessProjection(token, getAklConfig());
}

export function requireStratosActorSubjectMatch(
  actorContext: ApiRequestContext,
  envelopeActorSubjectId: string,
): void {
  const expectedSubjectId = envelopeActorSubjectId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$/.test(expectedSubjectId)) {
    throw new ApiClientError(
      "The STRATOS envelope actor subject is invalid.",
      422,
      "STRATOS_ACTOR_SUBJECT_INVALID",
      "web-stratos-bridge",
    );
  }
  if (actorContext.subjectId !== expectedSubjectId) {
    throw new ApiClientError(
      "The STRATOS actor bearer does not match the canonical envelope actor.",
      403,
      "STRATOS_ACTOR_SUBJECT_MISMATCH",
      "web-stratos-bridge",
    );
  }
}
