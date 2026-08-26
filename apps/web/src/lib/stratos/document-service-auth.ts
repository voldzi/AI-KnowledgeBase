import "server-only";

import { getAklConfig } from "@/lib/api/config";
import { ApiClientError } from "@/lib/types";

type ServicePrincipal = {
  subjectId: string;
  accessToken: string;
  roles: string[];
};

type ExactServiceProfile = {
  clientId: string;
  audience: string;
  role: string;
};

export type StratosDocumentSourceSystem = "STRATOS_BUDGET";

type StratosDocumentServiceProfile = ExactServiceProfile & {
  allowedSourceSystems: readonly StratosDocumentSourceSystem[];
};

export type StratosDocumentServicePrincipal = ServicePrincipal & {
  clientId: string;
  allowedSourceSystems: readonly StratosDocumentSourceSystem[];
};

const STRATOS_BUDGET_DOCUMENT_SERVICE: StratosDocumentServiceProfile = {
  clientId: "stratos-akb-service",
  audience: "akl-api",
  role: "service_ingestion",
  allowedSourceSystems: ["STRATOS_BUDGET"],
};

const STRATOS_DOCUMENT_SERVICES = [STRATOS_BUDGET_DOCUMENT_SERVICE] as const;

export async function authenticateStratosDocumentServiceRequest(
  request: Request,
): Promise<StratosDocumentServicePrincipal> {
  try {
    rejectCallerInternalHeaders(request);
    return await authenticateStratosDocumentService(request);
  } catch (error) {
    if (error instanceof ServiceBridgeError) {
      throw new ApiClientError(
        error.message,
        error.status,
        error.code,
        "web-stratos-document-service-auth",
      );
    }
    throw error;
  }
}

export async function authenticateStratosDocumentServiceJsonRequest(
  request: Request,
  options: { rateLimitProfile?: "default" | "stratos-budget-upload" } = {},
): Promise<{ principal: StratosDocumentServicePrincipal; body: Record<string, unknown> }> {
  try {
    rejectCallerInternalHeaders(request);
    const principal = await authenticateStratosDocumentService(request);
    enforceRateLimit(principal.subjectId, options.rateLimitProfile ?? "default");
    enforceContentLength(request);
    const body = await readBoundedJson(request);
    return { principal, body };
  } catch (error) {
    if (error instanceof ServiceBridgeError) {
      throw new ApiClientError(
        error.message,
        error.status,
        error.code,
        "web-stratos-document-service-auth",
      );
    }
    throw error;
  }
}

export function requireStratosDocumentSourceAllowed(
  principal: StratosDocumentServicePrincipal,
  sourceSystem: unknown,
): StratosDocumentSourceSystem {
  if (
    sourceSystem !== "STRATOS_BUDGET"
    || !principal.allowedSourceSystems.includes(sourceSystem)
  ) {
    throw new ApiClientError(
      "The document service is not authorized for this STRATOS source system.",
      403,
      "SOURCE_SYSTEM_NOT_ALLOWED",
      "web-stratos-document-service-auth",
    );
  }
  return sourceSystem;
}

type OidcJsonWebKey = JsonWebKey & { kid?: string; alg?: string };

const MAX_PAYLOAD_BYTES = 64 * 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const rateWindows = new Map<string, number[]>();
let jwksCache: { expiresAt: number; keys: OidcJsonWebKey[] } | null = null;

class ServiceBridgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

function rejectCallerInternalHeaders(request: Request) {
  for (const name of [
    "X-AKL-Subject",
    "X-AKL-Roles",
    "X-AKL-Groups",
    "X-AKL-Audience",
    "X-AKL-On-Behalf-Of",
  ]) {
    if (request.headers.has(name)) {
      throw new ServiceBridgeError(400, "INTERNAL_HEADER_FORBIDDEN", `${name} is an AKB internal header.`);
    }
  }
}

function enforceContentLength(request: Request) {
  const header = request.headers.get("content-length");
  if (header === null) return;
  const value = Number(header);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ServiceBridgeError(400, "CONTENT_LENGTH_INVALID", "Content-Length must be a non-negative integer.");
  }
  if (value > MAX_PAYLOAD_BYTES) {
    throw new ServiceBridgeError(413, "PAYLOAD_TOO_LARGE", "The request body exceeds 64 kB.");
  }
}

async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) {
    throw new ServiceBridgeError(400, "INVALID_JSON", "The request body must be a JSON object.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_PAYLOAD_BYTES) {
        try {
          await reader.cancel("payload exceeds 64 kB");
        } catch {
          // The size decision is authoritative even if the peer rejects cancellation.
        }
        throw new ServiceBridgeError(413, "PAYLOAD_TOO_LARGE", "The request body exceeds 64 kB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ServiceBridgeError) throw error;
    throw new ServiceBridgeError(400, "INVALID_JSON", "The request body must be a JSON object.");
  }
}

async function authenticateStratosDocumentService(
  request: Request,
): Promise<StratosDocumentServicePrincipal> {
  const resolved = await resolveServiceToken(request);
  const authorizedParty = stringClaim(resolved.claims.azp);
  const profile = STRATOS_DOCUMENT_SERVICES.find(
    (candidate) => candidate.clientId === authorizedParty,
  );
  if (!profile) {
    throw new ServiceBridgeError(
      403,
      "AUTH_FORBIDDEN",
      "A trusted STRATOS document service identity is required.",
    );
  }
  const principal = authenticateResolvedExactService(resolved, profile);
  return {
    ...principal,
    clientId: profile.clientId,
    allowedSourceSystems: profile.allowedSourceSystems,
  };
}

async function resolveServiceToken(request: Request): Promise<{
  accessToken: string;
  claims: Record<string, unknown>;
}> {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, accessToken] = authorization.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !accessToken) {
    throw new ServiceBridgeError(401, "AUTH_REQUIRED", "Bearer token is required.");
  }
  const config = getAklConfig();
  if (!config.oidc) {
    throw new ServiceBridgeError(503, "AUTH_VALIDATION_UNAVAILABLE", "OIDC token validation is not configured.");
  }
  const claims = config.oidc.clientSecret
    ? await introspectAccessToken(config.oidc.issuer, config.oidc.clientId, config.oidc.clientSecret, accessToken)
    : await validateJwtAccessToken(config.oidc.issuer, accessToken);
  return { accessToken, claims };
}

function authenticateResolvedExactService(
  resolved: { accessToken: string; claims: Record<string, unknown> },
  profile: ExactServiceProfile,
): ServicePrincipal {
  const { accessToken, claims } = resolved;
  const authorizedParty = stringClaim(claims.azp);
  const clientId = stringClaim(claims.client_id);
  if (
    authorizedParty !== profile.clientId
    || (clientId !== null && clientId !== profile.clientId)
  ) {
    throw new ServiceBridgeError(
      403,
      "AUTH_FORBIDDEN",
      `The ${profile.clientId} client identity is required.`,
    );
  }
  const subjectId = stringClaim(claims.sub);
  if (
    !subjectId
    || stringClaim(claims.preferred_username) !== `service-account-${profile.clientId}`
  ) {
    throw new ServiceBridgeError(
      403,
      "AUTH_FORBIDDEN",
      `The exact ${profile.clientId} service-account identity is required.`,
    );
  }
  const audiences = stringListClaim(claims.aud);
  if (!audiences.includes(profile.audience)) {
    throw new ServiceBridgeError(
      403,
      "AUTH_AUDIENCE_INVALID",
      `The token audience must include ${profile.audience}.`,
    );
  }
  const roles = extractRoles(claims);
  if (!roles.includes(profile.role)) {
    throw new ServiceBridgeError(403, "AUTH_ROLE_REQUIRED", `The ${profile.role} role is required.`);
  }
  return { subjectId, accessToken, roles: [profile.role] };
}

async function introspectAccessToken(
  issuer: string,
  clientId: string,
  clientSecret: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${issuer}/protocol/openid-connect/token/introspect`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: accessToken, client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ServiceBridgeError(503, "AUTH_VALIDATION_UNAVAILABLE", "OIDC token validation is unavailable.");
  }
  const claims = (await response.json()) as Record<string, unknown>;
  if (claims.active !== true) {
    throw new ServiceBridgeError(401, "AUTH_INVALID", "Bearer token is invalid or expired.");
  }
  return claims;
}

async function validateJwtAccessToken(issuer: string, accessToken: string): Promise<Record<string, unknown>> {
  const segments = accessToken.split(".");
  if (segments.length !== 3) {
    throw new ServiceBridgeError(401, "AUTH_INVALID", "Bearer token is invalid or expired.");
  }
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(segments[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    throw new ServiceBridgeError(401, "AUTH_INVALID", "Bearer token is invalid or expired.");
  }
  const kid = stringClaim(header.kid);
  if (header.alg !== "RS256" || !kid) {
    throw new ServiceBridgeError(401, "AUTH_INVALID", "Bearer token uses an unsupported signature.");
  }
  const keys = await loadOidcKeys(issuer);
  const jwk = keys.find((key) => key.kid === kid && (!key.alg || key.alg === "RS256"));
  if (!jwk) {
    jwksCache = null;
    throw new ServiceBridgeError(401, "AUTH_INVALID", "Bearer token signing key is not trusted.");
  }
  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      Buffer.from(segments[2], "base64url"),
      Buffer.from(`${segments[0]}.${segments[1]}`),
    );
  } catch {
    verified = false;
  }
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = typeof claims.exp === "number" ? claims.exp : 0;
  const notBefore = typeof claims.nbf === "number" ? claims.nbf : 0;
  if (!verified || claims.iss !== issuer || expiresAt <= now - 30 || notBefore > now + 30) {
    throw new ServiceBridgeError(401, "AUTH_INVALID", "Bearer token is invalid or expired.");
  }
  return claims;
}

async function loadOidcKeys(issuer: string): Promise<OidcJsonWebKey[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(`${issuer}/protocol/openid-connect/certs`, {
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ServiceBridgeError(503, "AUTH_VALIDATION_UNAVAILABLE", "OIDC signing keys are unavailable.");
  }
  const payload = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(payload.keys)) {
    throw new ServiceBridgeError(503, "AUTH_VALIDATION_UNAVAILABLE", "OIDC signing keys are invalid.");
  }
  const keys = payload.keys.filter((key): key is OidcJsonWebKey => Boolean(key && typeof key === "object"));
  jwksCache = { keys, expiresAt: Date.now() + 5 * 60_000 };
  return keys;
}

function extractRoles(claims: Record<string, unknown>): string[] {
  const roles = new Set(stringListClaim(claims.roles));
  const realmAccess = objectClaim(claims.realm_access);
  for (const role of stringListClaim(realmAccess?.roles)) roles.add(role);
  const resourceAccess = objectClaim(claims.resource_access);
  if (resourceAccess) {
    for (const value of Object.values(resourceAccess)) {
      for (const role of stringListClaim(objectClaim(value)?.roles)) roles.add(role);
    }
  }
  return [...roles].sort();
}

function enforceRateLimit(
  subjectId: string,
  profile: "default" | "stratos-budget-upload" = "default",
) {
  const now = Date.now();
  const rateLimit = profile === "stratos-budget-upload"
    ? boundedIntegerEnvironment("AKL_WEB_STRATOS_BUDGET_SERVICE_RATE_LIMIT", 300, 1, 1_000)
    : RATE_LIMIT;
  const rateWindowMs = profile === "stratos-budget-upload"
    ? boundedIntegerEnvironment("AKL_WEB_STRATOS_BUDGET_SERVICE_RATE_WINDOW_SECONDS", 60, 1, 300) * 1_000
    : RATE_WINDOW_MS;
  const key = `${profile}:${subjectId}`;
  const active = (rateWindows.get(key) ?? []).filter((timestamp) => timestamp > now - rateWindowMs);
  if (active.length >= rateLimit) {
    const retryAfter = Math.max(1, Math.ceil((active[0] + rateWindowMs - now) / 1000));
    throw new ServiceBridgeError(
      429,
      "RATE_LIMIT_EXCEEDED",
      "STRATOS document service request rate limit exceeded.",
      retryAfter,
    );
  }
  active.push(now);
  rateWindows.set(key, active);
}

function boundedIntegerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function stringClaim(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function stringListClaim(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function objectClaim(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
