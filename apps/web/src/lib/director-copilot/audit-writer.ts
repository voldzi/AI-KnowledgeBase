import "server-only";

import type { AklConfig } from "@/lib/api/config";
import type { ApiClients, ApiRequestContext, CreateAuditEventRequest } from "@/lib/types";
import { isManagedIdentity } from "@/lib/auth/managed-oidc";
import { signedInternalRegistryRequest } from "@/lib/auth/server-session";
import { DIRECTOR_COPILOT_AUDIT_TARGET, directorCopilotServiceToken } from "./service-identity";

export async function writeDirectorAudit(config: AklConfig, clients: ApiClients, actorContext: ApiRequestContext, payload: CreateAuditEventRequest): Promise<void> {
  if (isManagedIdentity(config)) {
    const response = await signedInternalRegistryRequest(config, "/internal/director-copilot/audit", {
      method: "POST",
      body: JSON.stringify({ ...payload, correlation_id: actorContext.correlationId ?? actorContext.requestId ?? null }),
    });
    if (!response.ok) throw new Error("DIRECTOR_COPILOT_AUDIT_UNAVAILABLE");
    return;
  }
  const clientId = "svc-akb-director-copilot";
  const serviceToken = await directorCopilotServiceToken(config, fetch, DIRECTOR_COPILOT_AUDIT_TARGET);
  await clients.registry.createAuditEvent(payload, {
    ...actorContext, subjectId: clientId, accessToken: serviceToken,
    roles: [], groups: [], capabilities: [], scopes: [], applicationAccess: [], serviceClientId: clientId,
  });
}
