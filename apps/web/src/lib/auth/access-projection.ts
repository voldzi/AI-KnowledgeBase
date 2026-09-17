import crypto from "node:crypto";

import type { AklConfig } from "@/lib/api/config";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";

import { contextFromOidcAccessToken } from "./oidc";
import { isManagedIdentity, verifyManagedUserToken } from "./managed-oidc";
import { parseActiveProjectionV2 } from "./access-projection-v2-shadow";

interface CacheEntry {
  context: ApiRequestContext;
  expiresAt: number;
}

const projectionCache = new Map<string, CacheEntry>();
const projectionFlights = new Map<string, Promise<ApiRequestContext>>();

export async function contextFromStratosAccessProjection(
  accessToken: string,
  config: AklConfig,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
  bypassCache = false,
  sessionProbe = false,
): Promise<ApiRequestContext> {
  const oidc = config.oidc;
  if (!oidc) throw projectionUnavailable("OIDC access projection is not configured.");

  const managed = isManagedIdentity(config);
  const managedClaims = managed
    ? await verifyManagedUserToken(config, accessToken, fetcher, nowMs).catch(() => null)
    : null;
  const identity = managed
    ? managedClaims ? { subjectId: managedClaims.sub! } : null
    : contextFromOidcAccessToken(accessToken, nowMs);
  if (!identity) {
    throw new ApiClientError("Bearer token is invalid or expired.", 401, "ACCESS_TOKEN_INVALID", "stratos-access");
  }
  const key = crypto.createHash("sha256").update(accessToken).digest("hex");
  const cached = projectionCache.get(key);
  if (!managed && !bypassCache && cached && cached.expiresAt > nowMs) return cached.context;

  // Managed identity intentionally has no cross-request TTL cache: every new
  // operation must observe a revoked membership or grant.  A chat turn can,
  // however, fan out into several requests at the same instant.  Coalesce only
  // those overlapping reads of the same bearer identity.  The flight is
  // removed immediately after completion, so the next operation still loads
  // a fresh projection and preserves revocation semantics.
  const flightKey = `${key}:${sessionProbe ? "probe" : "request"}`;
  const existingFlight = projectionFlights.get(flightKey);
  if (existingFlight) return existingFlight;

  const flight = (async () => {

  const projectionRequestStartedAtMs = Date.now();
  let response: Response;
  try {
    response = await fetcher(oidc.stratosAuthMeUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(sessionProbe ? { "X-STRATOS-Session-Probe": "1" } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(oidc.accessProjectionTimeoutMs),
    });
  } catch {
    throw projectionUnavailable("STRATOS access projection is unavailable.");
  }
  if (response.status === 401 || response.status === 403) {
    console.warn("STRATOS access projection rejected bearer identity.", {
      status: response.status,
    });
    throw new ApiClientError("STRATOS rejected the bearer identity.", response.status, "ACCESS_PROJECTION_DENIED", "stratos-access");
  }
  if (!response.ok) throw projectionUnavailable(`STRATOS access projection returned ${response.status}.`);

  const body = await response.json().catch(() => null);
  // `nowMs` is captured by the caller before the authority request. STRATOS
  // generates the projection while serving that request, so comparing its
  // generatedAt with the pre-request instant falsely classifies every fresh
  // projection as future-dated. Advance the caller's clock only by the time
  // actually spent fetching the projection; this preserves deterministic
  // tests and still rejects genuine clock drift or forged future timestamps.
  const projectionNowMs = nowMs + Math.max(0, Date.now() - projectionRequestStartedAtMs);
  let projection: ReturnType<typeof parseActiveProjectionV2>;
  try {
    projection = parseActiveProjectionV2(body, projectionNowMs);
  } catch {
    throw projectionUnavailable("STRATOS access projection is malformed, stale, or incompatible.");
  }
  if (projection.subjectId !== identity.subjectId) {
    throw new ApiClientError("STRATOS identity does not match the verified subject.", 403, "ACCESS_PROJECTION_IDENTITY_MISMATCH", "stratos-access");
  }
  if (!projection.identityActive || !projection.membershipActive) {
    throw new ApiClientError("STRATOS identity or membership is inactive.", 403, "ACCESS_PROJECTION_DENIED", "stratos-access");
  }

  const currentEntitlement = (validFrom: string | null, validUntil: string | null) =>
    (validFrom === null || Date.parse(validFrom) <= projectionNowMs)
    && (validUntil === null || Date.parse(validUntil) > projectionNowMs);
  const applicationAccess = projection.applicationAccess.flatMap((item) =>
    item.entitlements
      .filter((entitlement) => currentEntitlement(entitlement.validFrom, entitlement.validUntil))
      .map((entitlement) => ({
        application: item.applicationId,
        entitlementId: entitlement.entitlementId,
        profileId: entitlement.profileId,
        source: entitlement.source,
        virtual: entitlement.virtual,
        capabilities: entitlement.capabilities,
        scopes: entitlement.scopes.map(scopeKey),
        effectiveScopes: entitlement.effectiveScopes.map(scopeKey),
        validUntil: entitlement.validUntil,
      }))
  );
  const akbEntitlements = applicationAccess.filter((item) => normalizeApplication(item.application) === "akb");
  const active = Boolean(projection.identityActive && projection.membershipActive && akbEntitlements.length > 0);
  const context: ApiRequestContext = {
    subjectId: identity.subjectId,
    roles: [],
    groups: [],
    capabilities: active ? [...new Set(akbEntitlements.flatMap((item) => item.capabilities))] : [],
    // Only the central projection's effective scope closure is authoritative.
    // Raw grants can contain inactive, orphaned or non-descendant scopes and
    // must never be evaluated locally as runtime access.
    scopes: active ? [...new Set(akbEntitlements.flatMap((item) => item.effectiveScopes))] : [],
    organizationId: "org_stratos",
    identityActive: projection.identityActive,
    membershipActive: projection.membershipActive,
    applicationAccessActive: active,
    applicationAccess,
    authorizationSource: "stratos_projection",
    accessToken,
  };
  if (managedClaims?.identity_audience === "external") {
    if (projection.employeeEligible || applicationAccess.some((item) => item.entitlementId === "system:akb:employee-baseline")) {
      throw new ApiClientError("Employee scope is not valid for this identity.", 403, "ACCESS_PROJECTION_IDENTITY_MISMATCH", "stratos-access");
    }
  }

  const tokenExpiry = tokenExpiryMs(accessToken);
  const configuredExpiry = nowMs + oidc.accessProjectionCacheTtlMs;
  const expiresAt = Math.min(tokenExpiry ?? configuredExpiry, configuredExpiry, Date.parse(projection.expiresAt));
  if (!managed && oidc.accessProjectionCacheTtlMs > 0 && expiresAt > nowMs) {
    projectionCache.set(key, { context, expiresAt });
  }
  return context;
  })();
  projectionFlights.set(flightKey, flight);
  try {
    return await flight;
  } finally {
    if (projectionFlights.get(flightKey) === flight) projectionFlights.delete(flightKey);
  }
}

export function resetAccessProjectionCacheForTests(): void {
  projectionCache.clear();
  projectionFlights.clear();
}

function normalizeApplication(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replaceAll("_", "-") : "";
}

function scopeKey(scope: { type: string; id?: string }): string {
  return scope.id ? `${scope.type}:${scope.id}` : scope.type;
}

function tokenExpiryMs(token: string): number | null {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

function projectionUnavailable(message: string): ApiClientError {
  return new ApiClientError(message, 503, "ACCESS_PROJECTION_UNAVAILABLE", "stratos-access");
}
