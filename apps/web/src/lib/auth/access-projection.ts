import crypto from "node:crypto";

import type { AklConfig } from "@/lib/api/config";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";

import { contextFromOidcAccessToken } from "./oidc";

interface ProjectionAccess {
  application?: unknown;
  profileId?: unknown;
  capabilities?: unknown;
  effectiveScopes?: unknown;
  validUntil?: unknown;
}

interface CacheEntry {
  context: ApiRequestContext;
  expiresAt: number;
}

const projectionCache = new Map<string, CacheEntry>();

export async function contextFromStratosAccessProjection(
  accessToken: string,
  config: AklConfig,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<ApiRequestContext> {
  const oidc = config.oidc;
  if (!oidc) throw projectionUnavailable("OIDC access projection is not configured.");

  const identity = contextFromOidcAccessToken(accessToken, nowMs);
  if (!identity) {
    throw new ApiClientError("Bearer token is invalid or expired.", 401, "ACCESS_TOKEN_INVALID", "stratos-access");
  }
  const key = crypto.createHash("sha256").update(accessToken).digest("hex");
  const cached = projectionCache.get(key);
  if (cached && cached.expiresAt > nowMs) return cached.context;

  let response: Response;
  try {
    response = await fetcher(oidc.stratosAuthMeUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(oidc.accessProjectionTimeoutMs),
    });
  } catch {
    throw projectionUnavailable("STRATOS access projection is unavailable.");
  }
  if (response.status === 401 || response.status === 403) {
    const reason = await upstreamRejectionReason(response);
    const tokenRouting = tokenRoutingClaims(accessToken);
    console.warn("STRATOS access projection rejected bearer identity.", {
      status: response.status,
      reason,
      ...tokenRouting,
    });
    throw new ApiClientError("STRATOS rejected the bearer identity.", response.status, "ACCESS_PROJECTION_DENIED", "stratos-access");
  }
  if (!response.ok) throw projectionUnavailable(`STRATOS access projection returned ${response.status}.`);

  const body = await response.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.applicationAccess)) {
    throw projectionUnavailable("STRATOS access projection is malformed.");
  }
  if (body.tenantId !== "org_stratos") {
    throw new ApiClientError("STRATOS organization does not match AKB.", 403, "ORGANIZATION_MISMATCH", "stratos-access");
  }

  const applicationAccess = body.applicationAccess
    .filter(isRecord)
    .flatMap((item) => {
      if (typeof item.application !== "string" || !item.application) return [];
      return [{
        application: item.application,
        capabilities: stringArray(item.capabilities),
        scopes: scopeArray(item.effectiveScopes),
        validUntil: typeof item.validUntil === "string" ? item.validUntil : null,
      }];
    });
  const access = body.applicationAccess
    .filter(isRecord)
    .find((item) => normalizeApplication(item.application) === "akb") as ProjectionAccess | undefined;
  const validUntil = typeof access?.validUntil === "string" ? Date.parse(access.validUntil) : Number.POSITIVE_INFINITY;
  if (access && Number.isNaN(validUntil)) {
    throw projectionUnavailable("STRATOS access projection contains an invalid validity boundary.");
  }
  const active = Boolean(access && validUntil > nowMs);
  const context: ApiRequestContext = {
    subjectId: identity.subjectId,
    roles: [],
    groups: [],
    capabilities: active ? stringArray(access?.capabilities) : [],
    // Only the central projection's effective scope closure is authoritative.
    // Raw grants can contain inactive, orphaned or non-descendant scopes and
    // must never be evaluated locally as runtime access.
    scopes: active ? scopeArray(access?.effectiveScopes) : [],
    organizationId: "org_stratos",
    identityActive: true,
    membershipActive: true,
    applicationAccessActive: active,
    applicationAccess,
    authorizationSource: "stratos_projection",
    accessToken,
  };

  const tokenExpiry = tokenExpiryMs(accessToken);
  const configuredExpiry = nowMs + oidc.accessProjectionCacheTtlMs;
  const expiresAt = Math.min(tokenExpiry ?? configuredExpiry, configuredExpiry);
  if (oidc.accessProjectionCacheTtlMs > 0 && expiresAt > nowMs) {
    projectionCache.set(key, { context, expiresAt });
  }
  return context;
}

export function resetAccessProjectionCacheForTests(): void {
  projectionCache.clear();
}

function normalizeApplication(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replaceAll("_", "-") : "";
}

async function upstreamRejectionReason(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  if (!isRecord(body) || typeof body.message !== "string") return "unspecified";
  const normalized = body.message.replaceAll(/[\r\n\t]+/g, " ").trim();
  return normalized.slice(0, 160) || "unspecified";
}

function tokenRoutingClaims(accessToken: string): { audiences: string[]; authorizedParty: string | null } {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    const audiences = Array.isArray(payload.aud)
      ? stringArray(payload.aud)
      : typeof payload.aud === "string" && payload.aud
        ? [payload.aud]
        : [];
    return {
      audiences: audiences.slice(0, 8).map((audience) => audience.slice(0, 80)),
      authorizedParty: typeof payload.azp === "string" ? payload.azp.slice(0, 80) : null,
    };
  } catch {
    return { audiences: [], authorizedParty: null };
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function scopeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((scope) => {
    if (!isRecord(scope) || typeof scope.type !== "string" || !scope.type) return [];
    return [typeof scope.id === "string" && scope.id ? `${scope.type}:${scope.id}` : scope.type];
  });
}

function tokenExpiryMs(token: string): number | null {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function projectionUnavailable(message: string): ApiClientError {
  return new ApiClientError(message, 503, "ACCESS_PROJECTION_UNAVAILABLE", "stratos-access");
}
