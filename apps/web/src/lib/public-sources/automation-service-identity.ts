import "server-only";

import { readFile } from "node:fs/promises";
import { decodeJwt } from "jose";

import { getAklConfig, type AklConfig } from "@/lib/api/config";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";

export const OFFICIAL_SOURCE_SERVICE_CLIENT_ID = "svc-akb-official-source-sync";
export const OFFICIAL_SOURCE_REQUIRED_AUDIENCES = new Set(["stratos-official-sources", "akl-api"]);
const OFFICIAL_SOURCE_SERVICE_ROLE = "service_akb_official_source_sync";

type CachedToken = { cacheKey: string; token: string; subjectId: string; refreshAt: number };
let cachedToken: CachedToken | null = null;
let pendingToken: Promise<CachedToken> | null = null;

export async function officialSourceServiceRequestContext(
  correlationId: string,
  config: AklConfig = getAklConfig(),
): Promise<ApiRequestContext> {
  if (!config.officialSourceAutomation?.enabled) throw unavailable("Official-source automation is disabled.");
  if (config.authMode !== "oidc") {
    return {
      subjectId: `service-account-${OFFICIAL_SOURCE_SERVICE_CLIENT_ID}`,
      roles: [OFFICIAL_SOURCE_SERVICE_ROLE],
      capabilities: ["akb:access", "akb:manage_document", "akb:publish_public"],
      scopes: ["organization:org_stratos"],
      organizationId: "org_stratos",
      identityActive: true,
      membershipActive: true,
      applicationAccessActive: true,
      authorizationSource: "mock",
      serviceClientId: OFFICIAL_SOURCE_SERVICE_CLIENT_ID,
      accessToken: config.devAccessToken,
      requestId: correlationId,
      correlationId,
    };
  }
  const resolved = await accessToken(config);
  return {
    subjectId: resolved.subjectId,
    roles: [OFFICIAL_SOURCE_SERVICE_ROLE],
    capabilities: ["akb:access", "akb:manage_document", "akb:publish_public"],
    scopes: ["organization:org_stratos"],
    organizationId: "org_stratos",
    identityActive: true,
    membershipActive: true,
    applicationAccessActive: true,
    authorizationSource: "service",
    serviceClientId: OFFICIAL_SOURCE_SERVICE_CLIENT_ID,
    accessToken: resolved.token,
    requestId: correlationId,
    correlationId,
  };
}

async function accessToken(config: AklConfig): Promise<CachedToken> {
  const automation = config.officialSourceAutomation;
  if (!automation?.tokenUrl || automation.clientId !== OFFICIAL_SOURCE_SERVICE_CLIENT_ID) throw unavailable("Dedicated service identity is not configured.");
  const cacheKey = `${automation.tokenUrl}|${automation.clientId}`;
  if (cachedToken?.cacheKey === cacheKey && cachedToken.refreshAt > Date.now()) return cachedToken;
  if (!pendingToken) pendingToken = obtainToken(config, cacheKey).finally(() => { pendingToken = null; });
  cachedToken = await pendingToken;
  return cachedToken;
}

async function obtainToken(config: AklConfig, cacheKey: string): Promise<CachedToken> {
  const automation = config.officialSourceAutomation!;
  const secret = automation.clientSecret ?? (automation.clientSecretFile
    ? await readFile(automation.clientSecretFile, "utf8").then((value) => value.trim())
    : "");
  if (!secret) throw unavailable("Official-source service credential is unavailable.");
  let response: Response;
  try {
    response = await fetch(automation.tokenUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: automation.clientId, client_secret: secret }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch { throw unavailable("Official-source service token endpoint is unavailable."); }
  if (!response.ok) throw unavailable("Official-source service credential was rejected.");
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const token = typeof payload?.access_token === "string" ? payload.access_token : "";
  const lifetimeSeconds = typeof payload?.expires_in === "number" ? payload.expires_in : Number.NaN;
  let claims: ReturnType<typeof decodeJwt>;
  try { claims = decodeJwt(token); } catch { throw unavailable("Official-source token response is invalid."); }
  const clientId = typeof claims.client_id === "string" ? claims.client_id : "";
  const authorizedParty = typeof claims.azp === "string" ? claims.azp : "";
  const preferredUsername = typeof claims.preferred_username === "string" ? claims.preferred_username : "";
  const subjectId = typeof claims.sub === "string" ? claims.sub : "";
  const audiences = typeof claims.aud === "string" ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
  const audienceSet = new Set(audiences.filter((audience): audience is string => typeof audience === "string"));
  if (!token || !subjectId || clientId !== OFFICIAL_SOURCE_SERVICE_CLIENT_ID
      || authorizedParty !== OFFICIAL_SOURCE_SERVICE_CLIENT_ID
      || preferredUsername !== `service-account-${OFFICIAL_SOURCE_SERVICE_CLIENT_ID}`
      || audienceSet.size !== OFFICIAL_SOURCE_REQUIRED_AUDIENCES.size
      || [...OFFICIAL_SOURCE_REQUIRED_AUDIENCES].some((audience) => !audienceSet.has(audience))
      || !audienceSet.has(automation.audience)
      || !Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0 || lifetimeSeconds > 86_400) {
    throw unavailable("Official-source token identity is invalid.");
  }
  const lifetimeMs = lifetimeSeconds * 1_000;
  return { cacheKey, token, subjectId, refreshAt: Date.now() + Math.max(0, lifetimeMs - Math.min(30_000, lifetimeMs * 0.1)) };
}

export async function officialSourceInternalSecret(config: AklConfig = getAklConfig()): Promise<string> {
  const automation = config.officialSourceAutomation;
  const secret = automation?.internalSecret ?? (automation?.internalSecretFile
    ? await readFile(automation.internalSecretFile, "utf8").then((value) => value.trim())
    : "") ?? "";
  if (!automation?.enabled || secret.length < 32) throw unavailable("Official-source internal authorization is unavailable.");
  return secret;
}

function unavailable(message: string): ApiClientError {
  return new ApiClientError(message, 503, "OFFICIAL_SOURCE_AUTOMATION_UNAVAILABLE", "official-source-automation");
}

export function resetOfficialSourceServiceTokenCacheForTests(): void {
  cachedToken = null;
  pendingToken = null;
}
