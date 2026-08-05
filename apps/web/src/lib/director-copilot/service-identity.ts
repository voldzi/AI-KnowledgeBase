import "server-only";

import { readFile } from "node:fs/promises";

import { getAklConfig, getDirectorCopilotConfig, type AklConfig } from "@/lib/api/config";

import { DirectorCopilotTransportError } from "./transport-error";

const CLIENT_ID = "svc-akb-director-copilot";

interface CachedToken {
  cacheKey: string;
  token: string;
  refreshAt: number;
}

export interface DirectorCopilotServiceTarget {
  audience:
    | "akl-api"
    | "budget-api"
    | "projectflow-api"
    | "archflow-api";
  scope:
    | "director-copilot-akl-api"
    | "director-copilot-budget-api"
    | "director-copilot-projectflow-api"
    | "director-copilot-archflow-api";
}

export const DIRECTOR_COPILOT_AUDIT_TARGET: DirectorCopilotServiceTarget = {
  audience: "akl-api",
  scope: "director-copilot-akl-api",
};

const cachedTokens = new Map<string, CachedToken>();
const pendingTokens = new Map<string, Promise<CachedToken>>();

export async function directorCopilotServiceToken(
  config: AklConfig = getAklConfig(),
  fetcher: typeof fetch = fetch,
  target?: DirectorCopilotServiceTarget,
): Promise<string> {
  if (config.authMode !== "oidc") {
    return target
      ? `mock-director-copilot-service-token-${target.audience}`
      : "mock-director-copilot-service-token";
  }
  const transport = getDirectorCopilotConfig(config);
  if (!transport.enabled || !transport.tokenUrl || transport.clientId !== CLIENT_ID) {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_TRANSPORT_AUTH_UNAVAILABLE",
      "Director Copilot service identity is not configured.",
      "unavailable",
    );
  }
  const cacheKey = `${transport.tokenUrl}|${transport.clientId}|${target?.scope ?? "default"}`;
  const now = Date.now();
  const cachedToken = cachedTokens.get(cacheKey);
  if (cachedToken?.refreshAt && cachedToken.refreshAt > now) return cachedToken.token;
  let pending = pendingTokens.get(cacheKey);
  if (!pending) {
    pending = obtainToken(config, cacheKey, fetcher, target);
    pendingTokens.set(cacheKey, pending);
    const clear = () => {
      if (pendingTokens.get(cacheKey) === pending) pendingTokens.delete(cacheKey);
    };
    void pending.then(clear, clear);
  }
  const resolved = await pending;
  cachedTokens.set(cacheKey, resolved);
  return resolved.token;
}

async function obtainToken(
  config: AklConfig,
  cacheKey: string,
  fetcher: typeof fetch,
  target?: DirectorCopilotServiceTarget,
): Promise<CachedToken> {
  const transport = getDirectorCopilotConfig(config);
  const secret = transport.clientSecret
    ?? (transport.clientSecretFile
      ? await readFile(transport.clientSecretFile, "utf8").then((value) => value.trim())
      : "");
  if (!transport.tokenUrl || !secret) {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_TRANSPORT_AUTH_UNAVAILABLE",
      "Director Copilot service credential is unavailable.",
      "unavailable",
    );
  }
  let response: Response;
  try {
    response = await fetcher(transport.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: transport.clientId,
        client_secret: secret,
        ...(target ? { scope: target.scope } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_TRANSPORT_AUTH_UNAVAILABLE",
      "Director Copilot service credential could not be obtained.",
      "unavailable",
    );
  }
  if (!response.ok) {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_TRANSPORT_AUTH_REJECTED",
      "Director Copilot service credential was rejected.",
      "unavailable",
      response.status,
    );
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const token = typeof body?.access_token === "string" ? body.access_token : "";
  const expiresIn = typeof body?.expires_in === "number" ? body.expires_in : Number.NaN;
  if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 86_400) {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_TRANSPORT_AUTH_INVALID",
      "Director Copilot service credential response is invalid.",
      "unavailable",
    );
  }
  if (target) {
    assertExactAudience(token, target.audience);
  }
  const lifetimeMs = expiresIn * 1_000;
  const marginMs = Math.min(30_000, Math.max(1_000, lifetimeMs * 0.1));
  return { cacheKey, token, refreshAt: Date.now() + Math.max(0, lifetimeMs - marginMs) };
}

export function resetDirectorCopilotServiceTokenCacheForTests(): void {
  cachedTokens.clear();
  pendingTokens.clear();
}

function assertExactAudience(
  token: string,
  expectedAudience: DirectorCopilotServiceTarget["audience"],
): void {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_TRANSPORT_AUTH_INVALID",
      "Director Copilot target credential is not a JWT.",
      "unavailable",
    );
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const audiences = typeof payload.aud === "string"
      ? [payload.aud]
      : Array.isArray(payload.aud)
        ? payload.aud.filter((value): value is string => typeof value === "string")
        : [];
    if (audiences.length !== 1 || audiences[0] !== expectedAudience) {
      throw new Error("audience mismatch");
    }
  } catch {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_TRANSPORT_AUDIENCE_INVALID",
      "Director Copilot target credential does not contain the exact required audience.",
      "unavailable",
    );
  }
}
