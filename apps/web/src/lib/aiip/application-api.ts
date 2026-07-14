import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import { ApiClientError } from "@/lib/types";

type AiipOperation = "harmonize" | "duplicates/search";

type AiipPrincipal = {
  subjectId: string;
  accessToken: string;
  roles: string[];
};

export async function authenticateAiipServiceRequest(
  request: Request,
): Promise<AiipPrincipal> {
  try {
    return await authenticateAiipService(request);
  } catch (error) {
    if (error instanceof AiipBridgeError) {
      throw new ApiClientError(error.message, error.status, error.code, "web-aiip-service-auth");
    }
    throw error;
  }
}

export async function authenticateAiipServiceJsonRequest(
  request: Request,
): Promise<{ principal: AiipPrincipal; body: Record<string, unknown> }> {
  try {
    rejectCallerInternalHeaders(request);
    const principal = await authenticateAiipService(request);
    enforceRateLimit(principal.subjectId);
    enforceContentLength(request);
    const body = await readBoundedJson(request);
    return { principal, body };
  } catch (error) {
    if (error instanceof AiipBridgeError) {
      throw new ApiClientError(error.message, error.status, error.code, "web-aiip-service-auth");
    }
    throw error;
  }
}

type OidcJsonWebKey = JsonWebKey & { kid?: string; alg?: string };

const MAX_PAYLOAD_BYTES = 64 * 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const rateWindows = new Map<string, number[]>();
const activeRequests = new Map<string, number>();
let jwksCache: { expiresAt: number; keys: OidcJsonWebKey[] } | null = null;

class AiipBridgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export async function handleAiipApplicationRequest(
  request: NextRequest,
  operation: AiipOperation,
): Promise<NextResponse> {
  let requestId = request.headers.get("X-Request-ID")?.trim() || crypto.randomUUID();
  let correlationId = request.headers.get("X-Correlation-ID")?.trim() || requestId;

  try {
    requestId = requiredIdentifier(request, "X-Request-ID");
    correlationId = requiredIdentifier(request, "X-Correlation-ID");
    rejectCallerInternalHeaders(request);
    const idempotencyKey = requiredIdempotencyKey(request);
    const principal = await authenticateAiipService(request);
    enforceRateLimit(principal.subjectId);
    enforceContentLength(request);
    const body = await readBoundedJson(request);
    enforceClassification(body);

    const config = getAklConfig();
    acquireConcurrency(principal.subjectId);
    let upstream: Response;
    try {
      upstream = await fetch(
        `${config.serviceBaseUrls.rag}/integrations/aiip/${operation}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${principal.accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Request-ID": requestId,
            "X-Correlation-ID": correlationId,
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(70_000),
          cache: "no-store",
        },
      );
    } finally {
      releaseConcurrency(principal.subjectId);
    }
    let payload: unknown = await upstream.json().catch(() => ({
      error: {
        code: "UPSTREAM_INVALID_RESPONSE",
        message: "AKB application service returned an invalid response.",
      },
    }));
    if (!upstream.ok && (!payload || typeof payload !== "object" || !("error" in payload))) {
      payload = {
        error: {
          code: "AKB_APPLICATION_ERROR",
          message: "AKB application service rejected the request.",
          details: {},
        },
      };
    }
    const response = NextResponse.json(withErrorIdentifiers(payload, requestId, correlationId), {
      status: upstream.status,
    });
    response.headers.set("X-Request-ID", requestId);
    response.headers.set("X-Correlation-ID", correlationId);
    copyHeader(upstream, response, "Idempotency-Replayed");
    copyHeader(upstream, response, "Retry-After");
    return response;
  } catch (error) {
    const mapped = mapAiipError(error);
    const response = NextResponse.json(
      {
        error: {
          code: mapped.code,
          message: mapped.message,
          details: {},
          trace_id: correlationId,
          request_id: requestId,
          correlation_id: correlationId,
          audit_event_id: null,
        },
      },
      { status: mapped.status },
    );
    response.headers.set("X-Request-ID", requestId);
    response.headers.set("X-Correlation-ID", correlationId);
    if (mapped.retryAfter) response.headers.set("Retry-After", String(mapped.retryAfter));
    return response;
  }
}

function requiredIdentifier(request: NextRequest, name: string): string {
  const value = request.headers.get(name)?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) {
    throw new AiipBridgeError(400, "REQUIRED_HEADER_INVALID", `${name} is required and must be a stable identifier.`);
  }
  return value;
}

function requiredIdempotencyKey(request: NextRequest): string {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (value.length < 8 || value.length > 128) {
    throw new AiipBridgeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key must contain 8 to 128 characters.");
  }
  return value;
}

function rejectCallerInternalHeaders(request: Request) {
  for (const name of ["X-AKL-Subject", "X-AKL-Roles", "X-AKL-Groups", "X-AKL-Audience"]) {
    if (request.headers.has(name)) {
      throw new AiipBridgeError(400, "INTERNAL_HEADER_FORBIDDEN", `${name} is an AKB internal header.`);
    }
  }
}

function enforceContentLength(request: Request) {
  const header = request.headers.get("content-length");
  if (header === null) return;
  const value = Number(header);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AiipBridgeError(400, "CONTENT_LENGTH_INVALID", "Content-Length must be a non-negative integer.");
  }
  if (value > MAX_PAYLOAD_BYTES) {
    throw new AiipBridgeError(413, "PAYLOAD_TOO_LARGE", "The request body exceeds 64 kB.");
  }
}

async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) {
    throw new AiipBridgeError(400, "INVALID_JSON", "The request body must be a JSON object.");
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
        throw new AiipBridgeError(413, "PAYLOAD_TOO_LARGE", "The request body exceeds 64 kB.");
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
    if (error instanceof AiipBridgeError) throw error;
    throw new AiipBridgeError(400, "INVALID_JSON", "The request body must be a JSON object.");
  }
}

function enforceClassification(body: Record<string, unknown>) {
  if (body.classification === "restricted" || body.classification === "confidential") {
    throw new AiipBridgeError(
      403,
      "CLASSIFICATION_NOT_ALLOWED",
      "AIIP processing is allowed only for public and internal data.",
    );
  }
}

async function authenticateAiipService(request: Request): Promise<AiipPrincipal> {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, accessToken] = authorization.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !accessToken) {
    throw new AiipBridgeError(401, "AUTH_REQUIRED", "Bearer token is required.");
  }
  const config = getAklConfig();
  if (!config.oidc) {
    throw new AiipBridgeError(503, "AUTH_VALIDATION_UNAVAILABLE", "OIDC token validation is not configured.");
  }
  const claims = config.oidc.clientSecret
    ? await introspectAccessToken(config.oidc.issuer, config.oidc.clientId, config.oidc.clientSecret, accessToken)
    : await validateJwtAccessToken(config.oidc.issuer, accessToken);
  const clientId = stringClaim(claims.client_id) ?? stringClaim(claims.azp);
  if (clientId !== "aiip-service") {
    throw new AiipBridgeError(403, "AUTH_FORBIDDEN", "The aiip-service client identity is required.");
  }
  const audiences = stringListClaim(claims.aud);
  if (!audiences.includes("akb-api")) {
    throw new AiipBridgeError(403, "AUTH_AUDIENCE_INVALID", "The token audience must include akb-api.");
  }
  const roles = extractRoles(claims);
  if (!roles.includes("service_aiip")) {
    throw new AiipBridgeError(403, "AUTH_ROLE_REQUIRED", "The service_aiip role is required.");
  }
  const subjectId = stringClaim(claims.sub) ?? "service-account-aiip-service";
  return { subjectId, accessToken, roles: ["service_aiip"] };
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
    throw new AiipBridgeError(503, "AUTH_VALIDATION_UNAVAILABLE", "OIDC token validation is unavailable.");
  }
  const claims = (await response.json()) as Record<string, unknown>;
  if (claims.active !== true) {
    throw new AiipBridgeError(401, "AUTH_INVALID", "Bearer token is invalid or expired.");
  }
  return claims;
}

async function validateJwtAccessToken(issuer: string, accessToken: string): Promise<Record<string, unknown>> {
  const segments = accessToken.split(".");
  if (segments.length !== 3) {
    throw new AiipBridgeError(401, "AUTH_INVALID", "Bearer token is invalid or expired.");
  }
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(segments[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    throw new AiipBridgeError(401, "AUTH_INVALID", "Bearer token is invalid or expired.");
  }
  const kid = stringClaim(header.kid);
  if (header.alg !== "RS256" || !kid) {
    throw new AiipBridgeError(401, "AUTH_INVALID", "Bearer token uses an unsupported signature.");
  }
  const keys = await loadOidcKeys(issuer);
  const jwk = keys.find((key) => key.kid === kid && (!key.alg || key.alg === "RS256"));
  if (!jwk) {
    jwksCache = null;
    throw new AiipBridgeError(401, "AUTH_INVALID", "Bearer token signing key is not trusted.");
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
    throw new AiipBridgeError(401, "AUTH_INVALID", "Bearer token is invalid or expired.");
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
    throw new AiipBridgeError(503, "AUTH_VALIDATION_UNAVAILABLE", "OIDC signing keys are unavailable.");
  }
  const payload = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(payload.keys)) {
    throw new AiipBridgeError(503, "AUTH_VALIDATION_UNAVAILABLE", "OIDC signing keys are invalid.");
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

function enforceRateLimit(subjectId: string) {
  const now = Date.now();
  const active = (rateWindows.get(subjectId) ?? []).filter((timestamp) => timestamp > now - RATE_WINDOW_MS);
  if (active.length >= RATE_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((active[0] + RATE_WINDOW_MS - now) / 1000));
    throw new AiipBridgeError(429, "RATE_LIMIT_EXCEEDED", "AIIP request rate limit exceeded.", retryAfter);
  }
  active.push(now);
  rateWindows.set(subjectId, active);
}

function acquireConcurrency(subjectId: string) {
  const active = activeRequests.get(subjectId) ?? 0;
  if (active >= 4) {
    throw new AiipBridgeError(429, "CONCURRENCY_LIMIT_EXCEEDED", "AIIP concurrency limit exceeded.", 1);
  }
  activeRequests.set(subjectId, active + 1);
}

function releaseConcurrency(subjectId: string) {
  const active = activeRequests.get(subjectId) ?? 0;
  if (active <= 1) activeRequests.delete(subjectId);
  else activeRequests.set(subjectId, active - 1);
}

function withErrorIdentifiers(payload: unknown, requestId: string, correlationId: string): unknown {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return payload;
  const envelope = payload as { error?: unknown };
  const error = objectClaim(envelope.error);
  if (!error) return payload;
  return {
    ...envelope,
    error: {
      ...error,
      trace_id: correlationId,
      request_id: requestId,
      correlation_id: correlationId,
      audit_event_id: error.audit_event_id ?? null,
    },
  };
}

function mapAiipError(error: unknown): AiipBridgeError {
  if (error instanceof AiipBridgeError) return error;
  if (
    (error instanceof DOMException && error.name === "TimeoutError") ||
    (error instanceof Error && error.name === "TimeoutError")
  ) {
    return new AiipBridgeError(503, "UPSTREAM_TIMEOUT", "AKB application processing timed out.");
  }
  return new AiipBridgeError(502, "AKB_APPLICATION_ERROR", "AKB application processing failed.");
}

function copyHeader(source: Response, target: NextResponse, name: string) {
  const value = source.headers.get(name);
  if (value) target.headers.set(name, value);
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
