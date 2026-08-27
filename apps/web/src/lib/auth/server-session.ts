import "server-only";

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

import type { AklConfig } from "@/lib/api/config";
import { isManagedIdentity } from "@/lib/auth/managed-oidc";
import {
  refreshOidcSession,
  requireOidcConfig,
  type OidcSession,
} from "@/lib/auth/oidc";

export const SERVER_SESSION_COOKIE = "akl_session";
export const CENTRAL_SSO_SYNC_COOKIE = "akl_sso_sync";
export const SSO_ATTEMPT_COOKIE = "akb_sso_attempt";
export const SSO_SIGNED_OUT_COOKIE = "akb_sso_signed_out";

type StoredSession = {
  session_id: string;
  session_id_hash: string;
  subject_id: string;
  issuer: string;
  client_id: string;
  keycloak_session_id: string | null;
  encrypted_payload: string;
  persistent: boolean;
  identity_validated_at: string;
  last_seen_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ResolvedServerSession = {
  oidc: OidcSession;
  internalSessionId: string;
  persistent: boolean;
  absoluteExpiresAt: number;
};

export type ServerSessionDevice = {
  sessionId: string;
  persistent: boolean;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
};

const secretCache = new Map<string, Promise<string>>();
const resolvingSessions = new WeakMap<AklConfig, Map<string, Promise<ResolvedServerSession | null>>>();
const ABSOLUTE_TTL_MS = 90 * 86_400_000;
const IDLE_TTL_MS = 30 * 86_400_000;
const IDENTITY_VALIDATION_INTERVAL_MS = 15 * 60_000;
// This marker breaks the silent-SSO redirect loop while keeping each new
// application entry tied to the current Keycloak browser session.
const CENTRAL_SSO_SYNC_TTL_MS = 5_000;

export async function createServerSession(
  config: AklConfig,
  oidcSession: OidcSession,
  persistent: boolean,
  nowMs = Date.now(),
  absoluteDeadlineMs?: number,
): Promise<string> {
  const oidc = requireOidcConfig(config);
  if ((isManagedIdentity(config) && !boundManagedSession(config, oidcSession)) || (persistent && (oidcSession.rememberDevice !== true || oidcSession.sessionPolicyReason !== "CENTRAL_REMEMBER_DEVICE" || oidcSession.centralSessionStartedAt === undefined))) {
    throw new Error("SESSION_IDENTITY_BINDING_INVALID");
  }
  const selector = crypto.randomBytes(32).toString("base64url");
  const sessionHash = selectorHash(selector);
  const ttl = sessionTtls(config, persistent);
  const absoluteExpiresAt = serverSessionDeadline(config, oidcSession, persistent, nowMs, absoluteDeadlineMs);
  if (!Number.isFinite(absoluteExpiresAt) || absoluteExpiresAt <= nowMs) throw new Error("SESSION_EXPIRED");
  const idleExpiresAt = Math.min(nowMs + ttl.idle, absoluteExpiresAt);
  const timestamp = new Date(nowMs).toISOString();
  const response = await sessionStoreRequest(config, "", {
    method: "POST",
    body: JSON.stringify({
      session_id_hash: sessionHash,
      subject_id: oidcSession.subjectId,
      issuer: oidc.issuer,
      client_id: oidc.clientId,
      keycloak_session_id: oidcSession.keycloakSessionId ?? null,
      encrypted_payload: await encryptSession(config, { ...oidcSession, sessionAbsoluteExpiresAt: absoluteExpiresAt }),
      persistent,
      identity_validated_at: timestamp,
      last_seen_at: timestamp,
      idle_expires_at: new Date(idleExpiresAt).toISOString(),
      absolute_expires_at: new Date(absoluteExpiresAt).toISOString(),
    }),
  });
  if (!response.ok) throw new Error("SESSION_STORE_WRITE_FAILED");
  return selector;
}

export async function resolveServerSession(
  config: AklConfig,
  selector: string,
  nowMs = Date.now(),
): Promise<ResolvedServerSession | null> {
  if (!validSelector(selector)) return null;
  const sessionHash = selectorHash(selector);
  let pending = resolvingSessions.get(config);
  if (!pending) resolvingSessions.set(config, pending = new Map());
  const existing = pending.get(sessionHash);
  if (existing) return existing;
  // Share only the in-flight read/rotation, never an authorization result cache.
  const resolution = resolveStoredServerSession(config, selector, sessionHash, nowMs);
  pending.set(sessionHash, resolution);
  try {
    return await resolution;
  } finally {
    pending.delete(sessionHash);
  }
}

export async function synchronizeServerSession(
  config: AklConfig,
  selector: string,
  current: ResolvedServerSession,
  verified: OidcSession,
  nowMs = Date.now(),
): Promise<ResolvedServerSession> {
  if (!validSelector(selector)) throw new Error("SESSION_IDENTITY_BINDING_INVALID");
  const oidc = requireOidcConfig(config);
  const sessionHash = selectorHash(selector);
  const stored = await readStoredSession(config, sessionHash);
  const previous = stored ? await decryptSession(config, stored.encrypted_payload) : null;
  if (!stored || !previous || !storedSessionActive(stored, nowMs) || stored.session_id !== current.internalSessionId || stored.subject_id !== verified.subjectId || previous.subjectId !== verified.subjectId || stored.issuer !== oidc.issuer || stored.client_id !== oidc.clientId || previous.keycloakSessionId !== verified.keycloakSessionId || verified.identityIssuer !== oidc.issuer || verified.identityClientId !== oidc.clientId || (previous.centralSessionStartedAt !== undefined && verified.centralSessionStartedAt !== undefined && previous.centralSessionStartedAt !== verified.centralSessionStartedAt) || (isManagedIdentity(config) && (!boundManagedSession(config, verified) || previous.identitySource !== verified.identitySource || previous.identityAudience !== verified.identityAudience))) {
    throw new Error("SESSION_IDENTITY_BINDING_INVALID");
  }
  const persistent = stored.persistent && current.persistent && verified.rememberDevice === true && verified.sessionPolicyReason === "CENTRAL_REMEMBER_DEVICE";
  const ttl = sessionTtls(config, persistent);
  const centralSessionStartedAt = verified.centralSessionStartedAt ?? previous.centralSessionStartedAt;
  const absoluteExpiresAt = Math.min(
    Date.parse(stored.absolute_expires_at), current.absoluteExpiresAt,
    serverSessionDeadline(config, verified, persistent, nowMs),
    Date.parse(stored.created_at) + ttl.absolute,
    centralSessionStartedAt === undefined ? Infinity : Math.min(centralSessionStartedAt * 1000, nowMs) + ttl.absolute,
  );
  if (absoluteExpiresAt <= nowMs) throw new Error("SESSION_EXPIRED");
  const session = { ...verified, centralSessionStartedAt, sessionAbsoluteExpiresAt: absoluteExpiresAt };
  // Keep the selector so an in-flight logout still targets this session.
  // The Registry CAS rejects a revoked row or a concurrent token rotation.
  const response = await sessionStoreRequest(config, `/${sessionHash}`, {
    method: "PATCH",
    body: JSON.stringify({
      expected_updated_at: stored.updated_at,
      encrypted_payload: await encryptSession(config, session),
      identity_validated_at: new Date(nowMs).toISOString(),
      last_seen_at: new Date(nowMs).toISOString(),
      idle_expires_at: new Date(Math.min(nowMs + ttl.idle, absoluteExpiresAt)).toISOString(),
      absolute_expires_at: new Date(absoluteExpiresAt).toISOString(),
      persistent,
    }),
  });
  if (!response.ok) throw new Error("SESSION_SYNCHRONIZATION_REJECTED");
  const confirmed = await response.json() as StoredSession;
  if (!storedSessionActive(confirmed, nowMs) || confirmed.session_id !== current.internalSessionId || confirmed.subject_id !== session.subjectId || confirmed.issuer !== oidc.issuer || confirmed.client_id !== oidc.clientId || confirmed.persistent !== persistent || Date.parse(confirmed.absolute_expires_at) !== absoluteExpiresAt) throw new Error("SESSION_SYNCHRONIZATION_REJECTED");
  return { oidc: session, internalSessionId: current.internalSessionId, persistent, absoluteExpiresAt };
}

async function resolveStoredServerSession(
  config: AklConfig,
  selector: string,
  sessionHash: string,
  nowMs: number,
): Promise<ResolvedServerSession | null> {
  let stored = await readStoredSession(config, sessionHash);
  if (!stored) return null;
  if (!storedSessionActive(stored, nowMs)) {
    await revokeServerSession(config, selector, "expired");
    return null;
  }

  let oidcSession = await decryptSession(config, stored.encrypted_payload);
  const oidc = requireOidcConfig(config);
  if (
    !oidcSession ||
    oidcSession.subjectId !== stored.subject_id ||
    stored.issuer !== oidc.issuer ||
    stored.client_id !== oidc.clientId ||
    Boolean(stored.keycloak_session_id) !== Boolean(oidcSession.keycloakSessionId) ||
    (stored.keycloak_session_id && stored.keycloak_session_id !== oidcSession.keycloakSessionId) ||
    (isManagedIdentity(config) && (!boundManagedSession(config, oidcSession) || (stored.persistent && !oidcSession.rememberDevice)))
  ) {
    await revokeServerSession(config, selector, "undecryptable");
    return null;
  }

  const requiresIdentityValidation =
    !oidcSession.sessionPolicyReason || Date.parse(stored.identity_validated_at) + Math.min(oidc.identityValidationIntervalMs ?? IDENTITY_VALIDATION_INTERVAL_MS, IDENTITY_VALIDATION_INTERVAL_MS) <= nowMs;
  const requiresTokenRefresh = oidcSession.expiresAt <= nowMs + 5_000;
  if (requiresIdentityValidation || requiresTokenRefresh) {
    const previousUpdatedAt = stored.updated_at;
    const previousIdentityValidatedAt = stored.identity_validated_at;
    const refreshed = await refreshOidcSession(
      config,
      { ...oidcSession, accessToken: undefined },
      nowMs,
    );
    if (!refreshed) {
      // A concurrent web instance may already have rotated the refresh token.
      stored = (await readStoredSession(config, sessionHash)) ?? stored;
      const concurrent = await decryptSession(config, stored.encrypted_payload);
      const concurrentlyValidated =
        stored.updated_at !== previousUpdatedAt &&
        Date.parse(stored.identity_validated_at) > Date.parse(previousIdentityValidatedAt);
      if (!concurrent || !storedSessionActive(stored, nowMs) || concurrent.subjectId !== oidcSession.subjectId || stored.issuer !== oidc.issuer || stored.client_id !== oidc.clientId || concurrent.keycloakSessionId !== oidcSession.keycloakSessionId || (isManagedIdentity(config) && (!boundManagedSession(config, concurrent) || concurrent.identitySource !== oidcSession.identitySource || concurrent.identityAudience !== oidcSession.identityAudience || (stored.persistent && !concurrent.rememberDevice))) || concurrent.expiresAt <= nowMs || !concurrentlyValidated) {
        await revokeServerSession(config, selector, "identity_invalid");
        return null;
      }
      oidcSession = concurrent;
    } else {
      oidcSession = refreshed;
    }
  }

  const persistent = stored.persistent && oidcSession.rememberDevice === true && oidcSession.sessionPolicyReason === "CENTRAL_REMEMBER_DEVICE";
  const absoluteExpiresAt = Math.min(Date.parse(stored.absolute_expires_at), oidcSession.sessionAbsoluteExpiresAt ?? Infinity, Date.parse(stored.created_at) + sessionTtls(config, persistent).absolute);
  if (absoluteExpiresAt <= nowMs) {
    await revokeServerSession(config, selector, "central_session_expired");
    return null;
  }
  const patch: Record<string, unknown> = {
    last_seen_at: new Date(nowMs).toISOString(),
    idle_expires_at: new Date(
      Math.min(nowMs + sessionTtls(config, persistent).idle, absoluteExpiresAt),
    ).toISOString(),
  };
  if (requiresIdentityValidation || requiresTokenRefresh) {
    patch.expected_updated_at = stored.updated_at;
    patch.encrypted_payload = await encryptSession(config, oidcSession);
    patch.identity_validated_at = new Date(nowMs).toISOString();
    patch.persistent = persistent;
    patch.absolute_expires_at = new Date(absoluteExpiresAt).toISOString();
  }
  let updated = await sessionStoreRequest(config, `/${sessionHash}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (updated.status === 409 && patch.expected_updated_at) {
    const latest = await readStoredSession(config, sessionHash);
    // An activity-only update may race with token rotation. Retry the verified
    // tokens once, but never overwrite another rotation or a revocation.
    if (latest && storedSessionActive(latest, nowMs) && latest.encrypted_payload === stored.encrypted_payload && latest.subject_id === stored.subject_id && latest.issuer === stored.issuer && latest.client_id === stored.client_id && latest.persistent === stored.persistent && latest.absolute_expires_at === stored.absolute_expires_at) {
      patch.expected_updated_at = latest.updated_at;
      updated = await sessionStoreRequest(config, `/${sessionHash}`, {
        method: "PATCH", body: JSON.stringify(patch),
      });
    }
  }
  if (!updated.ok) return null;
  const confirmed = await updated.json() as StoredSession;
  if (!storedSessionActive(confirmed, nowMs) || confirmed.subject_id !== oidcSession.subjectId || confirmed.issuer !== oidc.issuer || confirmed.client_id !== oidc.clientId) return null;
  return {
    oidc: oidcSession,
    internalSessionId: stored.session_id,
    persistent: confirmed.persistent,
    absoluteExpiresAt,
  };
}

export async function revokeServerSession(
  config: AklConfig,
  selector: string,
  reason = "logout",
): Promise<OidcSession | null> {
  if (!validSelector(selector)) return null;
  const sessionHash = selectorHash(selector);
  const stored = await readStoredSession(config, sessionHash);
  const oidcSession = stored ? await decryptSession(config, stored.encrypted_payload) : null;
  const response = await sessionStoreRequest(config, `/${sessionHash}`, {
    method: "PATCH",
    body: JSON.stringify({ revoked_reason: reason }),
  });
  if (!response.ok && response.status !== 404) throw new Error("SESSION_REVOCATION_FAILED");
  return oidcSession;
}

export async function revokeAllSubjectSessions(
  config: AklConfig,
  subjectId: string,
): Promise<boolean> {
  const response = await sessionStoreRequest(
    config,
    `/subjects/${encodeURIComponent(subjectId)}/all`,
    { method: "DELETE" },
  );
  return response.ok;
}

export async function listSubjectSessions(
  config: AklConfig,
  subjectId: string,
): Promise<ServerSessionDevice[]> {
  const response = await sessionStoreRequest(
    config,
    `/subjects/${encodeURIComponent(subjectId)}/sessions`,
    { method: "GET" },
  );
  if (!response.ok) return [];
  const records = await response.json() as StoredSession[];
  return records.filter((record) => record.issuer === config.oidc?.issuer && record.client_id === config.oidc?.clientId && storedSessionActive(record, Date.now())).map((record) => ({
    sessionId: record.session_id,
    persistent: record.persistent,
    createdAt: record.created_at,
    lastSeenAt: record.last_seen_at,
    idleExpiresAt: record.idle_expires_at,
    absoluteExpiresAt: record.absolute_expires_at,
  }));
}

export async function revokeSubjectSession(
  config: AklConfig,
  subjectId: string,
  sessionId: string,
): Promise<boolean> {
  const response = await sessionStoreRequest(
    config,
    `/subjects/${encodeURIComponent(subjectId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  return response.ok;
}

export function serverSessionDeadline(config: AklConfig, session: OidcSession, persistent: boolean, nowMs: number, priorDeadline?: number): number {
  return Math.min(nowMs + sessionTtls(config, persistent).absolute, session.sessionAbsoluteExpiresAt ?? Infinity, priorDeadline ?? Infinity);
}

export function serverSessionCookieOptions(config: AklConfig, persistent: boolean, absoluteExpiresAt?: number, nowMs = Date.now()) {
  const oidc = requireOidcConfig(config);
  const path = new URL(oidc.redirectUri).pathname.replace(/\/api\/auth\/callback$/, "") || "/";
  return {
    httpOnly: true,
    secure: new URL(oidc.redirectUri).protocol === "https:" || config.environment === "production",
    sameSite: "lax" as const,
    path,
    ...(persistent ? { maxAge: Math.max(0, Math.floor(Math.min(sessionTtls(config, true).absolute, (absoluteExpiresAt ?? nowMs + sessionTtls(config, true).absolute) - nowMs) / 1000)) } : {}),
  };
}

export function centralSsoSyncCookieOptions(config: AklConfig) {
  return {
    ...serverSessionCookieOptions(config, false),
    maxAge: Math.ceil(CENTRAL_SSO_SYNC_TTL_MS / 1_000),
  };
}

export async function createCentralSsoSyncMarker(
  config: AklConfig,
  selector: string,
  nowMs = Date.now(),
): Promise<string> {
  const expiresAt = nowMs + CENTRAL_SSO_SYNC_TTL_MS;
  const payload = `${expiresAt}.${selectorHash(selector)}`;
  const signature = crypto
    .createHmac("sha256", await sessionStoreSecret(config))
    .update(`central-sso-sync:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export async function hasCurrentCentralSsoSyncMarker(
  config: AklConfig,
  selector: string,
  marker: string | undefined,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!marker || !validSelector(selector)) return false;
  const [rawExpiry, sessionHash, signature, ...extra] = marker.split(".");
  const expiresAt = Number(rawExpiry);
  if (
    extra.length > 0 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < nowMs ||
    sessionHash !== selectorHash(selector) ||
    !signature
  ) {
    return false;
  }
  const payload = `${rawExpiry}.${sessionHash}`;
  const expected = crypto
    .createHmac("sha256", await sessionStoreSecret(config))
    .update(`central-sso-sync:${payload}`)
    .digest("base64url");
  const received = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    received.length === expectedBuffer.length &&
    crypto.timingSafeEqual(received, expectedBuffer)
  );
}

async function readStoredSession(config: AklConfig, sessionHash: string): Promise<StoredSession | null> {
  const response = await sessionStoreRequest(config, `/${sessionHash}`, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  return await response.json() as StoredSession;
}

async function sessionStoreRequest(
  config: AklConfig,
  suffix: string,
  init: RequestInit,
): Promise<Response> {
  return signedInternalRegistryRequest(config, `/internal/web-sessions${suffix}`, init);
}

export async function signedInternalRegistryRequest(config: AklConfig, suffix: string, init: RequestInit): Promise<Response> {
  if (!suffix.startsWith("/internal/web-sessions") && suffix !== "/internal/director-copilot/audit") throw new Error("INTERNAL_ROUTE_INVALID");
  const secret = await sessionStoreSecret(config);
  const body = typeof init.body === "string" ? init.body : "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = `/api/v1${suffix}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update([timestamp, (init.method ?? "GET").toUpperCase(), path, crypto.createHash("sha256").update(body).digest("hex")].join("\n"))
    .digest("hex");
  return fetch(`${config.serviceBaseUrls.registry}${suffix}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-AKB-Session-Timestamp": timestamp,
      "X-AKB-Session-Signature": signature,
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    opentelemetry: { ignore: true, propagateContext: false },
  });
}

function sessionTtls(config: AklConfig, persistent: boolean) {
  const oidc = requireOidcConfig(config);
  const browserSession = !persistent;
  return {
    absolute: Math.min(oidc.sessionAbsoluteTtlMs ?? ABSOLUTE_TTL_MS, browserSession ? 86_400_000 : ABSOLUTE_TTL_MS),
    idle: Math.min(oidc.sessionIdleTtlMs ?? IDLE_TTL_MS, browserSession ? 8 * 3_600_000 : IDLE_TTL_MS),
  };
}

function boundManagedSession(config: AklConfig, session: OidcSession): boolean {
  return session.identityIssuer === config.oidc?.issuer && session.identityClientId === config.oidc?.clientId && typeof session.rememberDevice === "boolean" && Boolean(session.identitySource) && ["employees", "external"].includes(session.identityAudience ?? "");
}

function storedSessionActive(stored: StoredSession, nowMs: number): boolean {
  return !stored.revoked_at && Date.parse(stored.absolute_expires_at) > nowMs && Date.parse(stored.idle_expires_at) > nowMs && Number.isFinite(Date.parse(stored.identity_validated_at));
}

async function encryptSession(config: AklConfig, session: OidcSession): Promise<string> {
  const key = await encryptionKey(config);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

async function decryptSession(config: AklConfig, value: string): Promise<OidcSession | null> {
  try {
    const payload = Buffer.from(value, "base64url");
    if (payload[0] !== 1) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", await encryptionKey(config), payload.subarray(1, 13));
    decipher.setAuthTag(payload.subarray(13, 29));
    return JSON.parse(Buffer.concat([
      decipher.update(payload.subarray(29)),
      decipher.final(),
    ]).toString("utf8")) as OidcSession;
  } catch {
    return null;
  }
}

async function encryptionKey(config: AklConfig): Promise<Buffer> {
  const oidc = requireOidcConfig(config);
  const secret = await configuredSecret(
    oidc.sessionEncryptionKey,
    oidc.sessionEncryptionKeyFile,
    "session-encryption",
  );
  return crypto.createHash("sha256").update(secret).digest();
}

async function sessionStoreSecret(config: AklConfig): Promise<string> {
  const oidc = requireOidcConfig(config);
  return configuredSecret(
    oidc.sessionStoreSecret,
    oidc.sessionStoreSecretFile,
    "session-store",
  );
}

async function configuredSecret(value: string | undefined, file: string | undefined, purpose: string): Promise<string> {
  const cacheKey = `${purpose}:${file ?? "inline"}:${value ? crypto.createHash("sha256").update(value).digest("hex") : ""}`;
  let pending = secretCache.get(cacheKey);
  if (!pending) {
    pending = file ? readFile(file, "utf8").then((content) => content.trim()) : Promise.resolve(value ?? "");
    secretCache.set(cacheKey, pending);
  }
  const resolved = await pending;
  if (resolved.length < 32) throw new Error(`AKB ${purpose} secret is unavailable or too short.`);
  return resolved;
}

function selectorHash(selector: string): string {
  return crypto.createHash("sha256").update(selector).digest("hex");
}

function validSelector(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
