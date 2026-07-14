import "server-only";

import { readFile } from "node:fs/promises";

import { getAklConfig, type AklConfig } from "@/lib/api/config";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";

const TRANSPORT_CLIENT_ID = "svc-akb-web-ingestion";
const TRANSPORT_ROLE = "service_akb_web_ingestion";

type CachedToken = {
  cacheKey: string;
  token: string;
  refreshAt: number;
};

let cachedToken: CachedToken | null = null;
const pendingTokens = new Map<string, Promise<CachedToken>>();

export async function ingestionServiceRequestContext(
  correlationId: string,
  config: AklConfig = getAklConfig(),
): Promise<ApiRequestContext> {
  if (config.authMode !== "oidc") {
    return {
      subjectId: `service-account-${TRANSPORT_CLIENT_ID}`,
      roles: [TRANSPORT_ROLE],
      organizationId: "org_stratos",
      authorizationSource: "mock",
      serviceClientId: TRANSPORT_CLIENT_ID,
      requestId: correlationId,
      correlationId,
    };
  }
  const token = await ingestionServiceAccessToken(config);
  return {
    subjectId: `service-account-${TRANSPORT_CLIENT_ID}`,
    roles: [TRANSPORT_ROLE],
    organizationId: "org_stratos",
    identityActive: true,
    membershipActive: false,
    applicationAccessActive: false,
    authorizationSource: "stratos_projection",
    serviceClientId: TRANSPORT_CLIENT_ID,
    accessToken: token,
    requestId: correlationId,
    correlationId,
  };
}

export async function ingestionServiceAccessToken(
  config: AklConfig = getAklConfig(),
): Promise<string> {
  const transport = config.ingestionTransport;
  if (!transport || transport.clientId !== TRANSPORT_CLIENT_ID) {
    throw new ApiClientError(
      "The dedicated web-to-ingestion service identity is not configured.",
      503,
      "INGESTION_TRANSPORT_AUTH_UNAVAILABLE",
      "web-ingestion-transport",
    );
  }
  const cacheKey = `${transport.tokenUrl}|${transport.clientId}`;
  const now = Date.now();
  if (cachedToken?.cacheKey === cacheKey && now < cachedToken.refreshAt) {
    return cachedToken.token;
  }
  let pendingToken = pendingTokens.get(cacheKey);
  if (!pendingToken) {
    pendingToken = obtainToken(config, cacheKey);
    pendingTokens.set(cacheKey, pendingToken);
    const clearPending = () => {
      if (pendingTokens.get(cacheKey) === pendingToken) {
        pendingTokens.delete(cacheKey);
      }
    };
    void pendingToken.then(clearPending, clearPending);
  }
  const resolved = await pendingToken;
  cachedToken = resolved;
  return resolved.token;
}

async function obtainToken(config: AklConfig, cacheKey: string): Promise<CachedToken> {
  const transport = config.ingestionTransport;
  if (!transport) {
    throw new ApiClientError(
      "The dedicated web-to-ingestion service identity is not configured.",
      503,
      "INGESTION_TRANSPORT_AUTH_UNAVAILABLE",
      "web-ingestion-transport",
    );
  }
  const clientSecret = transport.clientSecret
    ?? (transport.clientSecretFile
      ? await readFile(transport.clientSecretFile, "utf8").then((value) => value.trim())
      : "");
  if (!clientSecret) {
    throw new ApiClientError(
      "The web-to-ingestion service credential is unavailable.",
      503,
      "INGESTION_TRANSPORT_AUTH_UNAVAILABLE",
      "web-ingestion-transport",
    );
  }

  let response: Response;
  try {
    response = await fetch(transport.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: transport.clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new ApiClientError(
      "The web-to-ingestion service credential could not be obtained.",
      503,
      "INGESTION_TRANSPORT_AUTH_UNAVAILABLE",
      "web-ingestion-transport",
    );
  }
  if (!response.ok) {
    throw new ApiClientError(
      "The web-to-ingestion service credential was rejected.",
      503,
      "INGESTION_TRANSPORT_AUTH_UNAVAILABLE",
      "web-ingestion-transport",
    );
  }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const token = typeof payload?.access_token === "string" ? payload.access_token : "";
  const lifetimeSeconds = typeof payload?.expires_in === "number" ? payload.expires_in : Number.NaN;
  if (
    !token ||
    !Number.isFinite(lifetimeSeconds) ||
    lifetimeSeconds <= 0 ||
    lifetimeSeconds > 86_400
  ) {
    throw new ApiClientError(
      "The web-to-ingestion service credential response is invalid.",
      503,
      "INGESTION_TRANSPORT_AUTH_INVALID",
      "web-ingestion-transport",
    );
  }
  const lifetimeMs = lifetimeSeconds * 1000;
  const refreshMarginMs = Math.min(30_000, Math.max(1_000, lifetimeMs * 0.1));
  return {
    cacheKey,
    token,
    refreshAt: Date.now() + Math.max(0, lifetimeMs - refreshMarginMs),
  };
}

export function resetIngestionServiceTokenCacheForTests(): void {
  cachedToken = null;
  pendingTokens.clear();
}
