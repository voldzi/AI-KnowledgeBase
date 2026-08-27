import crypto from "node:crypto";

import type { AklConfig } from "@/lib/api/config";
import type { ApiRequestContext } from "@/lib/types";
import {
  identityJson, isManagedIdentity, managedDiscovery,
  verifyManagedIdToken, verifyManagedUserToken, verifyApprovedOidcJwt,
} from "./managed-oidc";
import { centralSessionPolicy, type CentralSessionPolicy, type SessionPolicyReason } from "./session-policy";

export const OIDC_STATE_COOKIE = "akl_oidc_state";
export const OIDC_SESSION_COOKIE = "akl_session";
export const OIDC_ACCESS_COOKIE = "akl_access";
export const OIDC_REFRESH_COOKIE = "akl_refresh";
export const OIDC_PKCE_COOKIE = "akl_oidc_pkce";

const OIDC_REFRESH_RACE_TTL_MS = 2 * 60 * 1000;
const OIDC_SESSION_CACHE_MAX_ENTRIES = 256;
const OIDC_SESSION_CACHE_SKEW_MS = 5_000;

type CachedOidcSession = {
  expiresAt: number;
  promise: Promise<OidcSession | null>;
};

const oidcSessionCache = new Map<string, CachedOidcSession>();

export interface OidcSession {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  subjectId: string;
  roles: string[];
  groups: string[];
  name?: string;
  email?: string;
  keycloakSessionId?: string;
  identityIssuer?: string;
  identityClientId?: string;
  identitySource?: string;
  identityAudience?: "employees" | "external";
  rememberDevice?: boolean;
  centralSessionStartedAt?: number;
  sessionAbsoluteExpiresAt?: number;
  sessionPolicyReason?: SessionPolicyReason;
}

export interface OidcCallbackTokens {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

export type OidcAuthorizationMode = "interactive" | "silent";

export function buildAuthorizationUrl(
  config: AklConfig,
  state: string,
  codeVerifier?: string,
  mode: OidcAuthorizationMode = "interactive",
  authorizationEndpoint?: string,
): string {
  const oidc = requireOidcConfig(config);
  if (isManagedIdentity(config) && (!authorizationEndpoint || !codeVerifier)) throw new Error("OIDC_DISCOVERY_AND_PKCE_REQUIRED");
  const url = new URL(authorizationEndpoint ?? `${oidc.issuer}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", oidc.clientId);
  url.searchParams.set("redirect_uri", oidc.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", oidc.scopes);
  url.searchParams.set("state", state);
  if (codeVerifier) {
    const nonce = parseState(state).nonce;
    if (!nonce) throw new Error("OIDC_NONCE_REQUIRED");
    url.searchParams.set("nonce", nonce);
  }
  if (mode === "silent") {
    url.searchParams.set("prompt", "none");
  }
  if (codeVerifier) {
    url.searchParams.set("code_challenge", pkceCodeChallenge(codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export async function resolveAuthorizationUrl(config: AklConfig, state: string, codeVerifier: string, mode: OidcAuthorizationMode = "interactive", fetcher: typeof fetch = fetch): Promise<string> {
  const endpoint = isManagedIdentity(config) ? (await managedDiscovery(config, fetcher)).authorization_endpoint : undefined;
  return buildAuthorizationUrl(config, state, codeVerifier, mode, endpoint);
}

export function createPkceVerifier(): string {
  return crypto.randomBytes(48).toString("base64url");
}

export function buildLogoutUrl(config: AklConfig, endpoint?: string): string {
  const oidc = requireOidcConfig(config);
  if (isManagedIdentity(config) && !endpoint) throw new Error("OIDC_DISCOVERY_REQUIRED");
  const url = new URL(endpoint ?? `${oidc.issuer}/protocol/openid-connect/logout`);
  url.searchParams.set("client_id", oidc.clientId);
  url.searchParams.set(
    "post_logout_redirect_uri",
    oidc.logoutRedirectUri ?? oidc.redirectUri.replace(/\/api\/auth\/callback$/, ""),
  );
  return url.toString();
}

export async function resolveLogoutUrl(config: AklConfig, fetcher: typeof fetch = fetch): Promise<string> {
  const endpoint = isManagedIdentity(config) ? (await managedDiscovery(config, fetcher)).end_session_endpoint : undefined;
  return buildLogoutUrl(config, endpoint);
}

export async function revokeOidcRefreshToken(config: AklConfig, session: OidcSession, fetcher: typeof fetch = fetch): Promise<void> {
  const oidc = requireOidcConfig(config);
  if (!session.refreshToken) return;
  if (isManagedIdentity(config) && (session.identityIssuer !== oidc.issuer || session.identityClientId !== oidc.clientId)) return;
  const endpoint = isManagedIdentity(config) ? (await managedDiscovery(config, fetcher)).revocation_endpoint : `${oidc.issuer}/protocol/openid-connect/revoke`;
  const body = new URLSearchParams({ token: session.refreshToken, token_type_hint: "refresh_token", client_id: oidc.clientId });
  if (!isManagedIdentity(config) && oidc.clientSecret) body.set("client_secret", oidc.clientSecret);
  await fetcher(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3_000), opentelemetry: { ignore: true, propagateContext: false } });
}

export function buildPublicAppUrl(config: AklConfig, path: string): string {
  const oidc = requireOidcConfig(config);
  const publicBaseUrl = oidc.redirectUri.replace(/\/api\/auth\/callback$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${publicBaseUrl}${normalizedPath === "/" ? "" : normalizedPath}`;
}

export function isAllowedPublicOrigin(
  config: AklConfig,
  origin: string | null,
): boolean {
  if (!origin) return false;
  try {
    return (
      new URL(origin).origin === new URL(buildPublicAppUrl(config, "/")).origin
    );
  } catch {
    return false;
  }
}

export function isAllowedAuthNavigationRequestOrigin(
  config: AklConfig,
  headers: Pick<Headers, "get">,
): boolean {
  const origin = headers.get("origin");
  if (isAllowedPublicOrigin(config, origin)) return true;

  // Some managed browser shells serialize a same-origin form navigation with
  // an opaque Origin. Fetch Metadata headers are browser-controlled and keep
  // this exception limited to a top-level, same-origin document navigation.
  return (
    origin === "null" &&
    headers.get("sec-fetch-site") === "same-origin" &&
    headers.get("sec-fetch-mode") === "navigate" &&
    headers.get("sec-fetch-dest") === "document"
  );
}

export function normalizeReturnToForPublicBase(
  config: AklConfig,
  returnTo: string | null | undefined,
): string {
  const safeReturnTo =
    returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
      ? returnTo
      : "/";
  const oidc = requireOidcConfig(config);
  const publicBaseUrl = new URL(
    oidc.redirectUri.replace(/\/api\/auth\/callback$/, ""),
  );
  const publicBasePath = publicBaseUrl.pathname.replace(/\/+$/, "");
  if (
    publicBasePath &&
    (safeReturnTo === publicBasePath ||
      safeReturnTo.startsWith(`${publicBasePath}/`))
  ) {
    return safeReturnTo.slice(publicBasePath.length) || "/";
  }
  return safeReturnTo;
}

export async function exchangeAuthorizationCode(
  config: AklConfig,
  code: string,
  codeVerifier?: string,
  fetcher: typeof fetch = fetch,
): Promise<OidcCallbackTokens> {
  const oidc = requireOidcConfig(config);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: oidc.clientId,
    code,
    redirect_uri: oidc.redirectUri,
  });
  if (!isManagedIdentity(config) && oidc.clientSecret) {
    body.set("client_secret", oidc.clientSecret);
  }
  if (codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }

  if (isManagedIdentity(config)) {
    if (!codeVerifier) throw new Error("OIDC_PKCE_REQUIRED");
    const discovery = await managedDiscovery(config, fetcher);
    return await identityJson(discovery.token_endpoint, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
    }, fetcher) as unknown as OidcCallbackTokens;
  }

  return await identityJson(`${oidc.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }, fetcher) as unknown as OidcCallbackTokens;
}

export async function verifiedSessionFromTokens(config: AklConfig, tokens: OidcCallbackTokens, nonce: string | undefined, nowMs = Date.now(), fetcher: typeof fetch = fetch, previous?: OidcSession): Promise<OidcSession> {
  if (typeof tokens.access_token !== "string" || !tokens.access_token) throw new Error("OIDC_ACCESS_TOKEN_MISSING");
  if (typeof tokens.token_type !== "string" || tokens.token_type.toLowerCase() !== "bearer" || (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== "string" || !tokens.refresh_token))) throw new Error("OIDC_TOKEN_RESPONSE_INVALID");
  if (nonce !== undefined && !tokens.refresh_token) throw new Error("OIDC_REFRESH_TOKEN_MISSING");
  const managed = isManagedIdentity(config);
  const claims = managed ? await verifyManagedUserToken(config, tokens.access_token, fetcher, nowMs)
    : await verifyApprovedOidcJwt(config, tokens.access_token, config.oidc!.accessTokenAudience ?? "akl-api", fetcher, nowMs);
  if (!stringClaim(claims.sub) || claims.sub!.length > 160 || claims.stratos_service === true || claims.typ === "Offline" || (claims.azp !== undefined && claims.azp !== config.oidc!.clientId) || (claims.client_id !== undefined && claims.client_id !== config.oidc!.clientId)) throw new Error("OIDC_USER_CLAIMS_INVALID");
  if (nonce !== undefined && !tokens.id_token) throw new Error("OIDC_ID_TOKEN_MISSING");
  if (tokens.id_token) await verifyManagedIdToken(config, tokens.id_token, claims.sub!, nonce, fetcher, nowMs);
  const previousPolicy = previous?.sessionAbsoluteExpiresAt !== undefined ? {
    rememberDevice: previous.rememberDevice === true, centralSessionStartedAt: previous.centralSessionStartedAt,
    sessionAbsoluteExpiresAt: previous.sessionAbsoluteExpiresAt, sessionPolicyReason: previous.sessionPolicyReason ?? "REMEMBER_CLAIM_MISSING",
  } satisfies CentralSessionPolicy : undefined;
  const policy = centralSessionPolicy(claims, nowMs, previousPolicy);
  return {
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token,
    expiresAt: claims.exp! * 1_000, subjectId: claims.sub!, roles: managed ? [] : extractRoles(claims), groups: managed ? [] : stringArrayClaim(claims.groups),
    name: stringClaim(claims.name), email: stringClaim(claims.email),
    keycloakSessionId: stringClaim(claims.sid), identityIssuer: config.oidc!.issuer,
    identityClientId: config.oidc!.clientId, identitySource: managed ? String(claims.identity_source) : undefined,
    identityAudience: managed ? claims.identity_audience as "employees" | "external" : undefined,
    ...policy,
  };
}

function pkceCodeChallenge(codeVerifier: string): string {
  return crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
}

export function sessionFromTokens(
  tokens: OidcCallbackTokens,
  nowMs = Date.now(),
): OidcSession {
  const claims = decodeJwtPayload(tokens.access_token);
  const fallbackClaims = tokens.id_token
    ? decodeJwtPayload(tokens.id_token)
    : {};
  const subjectId =
    stringClaim(claims.sub) ??
    stringClaim(claims.preferred_username) ??
    stringClaim(fallbackClaims.sub);
  if (!subjectId) {
    throw new Error("OIDC token does not contain a subject.");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: nowMs + Math.max(tokens.expires_in ?? 300, 30) * 1000,
    subjectId,
    roles: extractRoles(claims),
    groups: stringArrayClaim(claims.groups),
    name: stringClaim(claims.name) ?? stringClaim(fallbackClaims.name),
    email: stringClaim(claims.email) ?? stringClaim(fallbackClaims.email),
    keycloakSessionId:
      stringClaim(claims.sid) ??
      stringClaim(claims.session_state) ??
      stringClaim(fallbackClaims.sid),
  };
}

export function contextFromOidcSession(
  session: OidcSession,
): ApiRequestContext {
  return {
    subjectId: session.subjectId,
    roles: session.roles,
    groups: session.groups,
    accessToken: session.accessToken,
  };
}

export function contextFromOidcAccessToken(
  accessToken: string,
  nowMs = Date.now(),
): ApiRequestContext | null {
  try {
    const claims = decodeJwtPayload(accessToken);
    const subjectId =
      stringClaim(claims.sub) ??
      stringClaim(claims.client_id) ??
      stringClaim(claims.azp) ??
      stringClaim(claims.preferred_username);
    if (!subjectId) {
      return null;
    }
    const expiresAtSeconds =
      typeof claims.exp === "number" ? claims.exp : undefined;
    if (expiresAtSeconds !== undefined && expiresAtSeconds <= nowMs / 1000) {
      return null;
    }

    return {
      subjectId,
      roles: extractRoles(claims),
      groups: stringArrayClaim(claims.groups),
      accessToken,
    };
  } catch {
    return null;
  }
}

export function createState(
  returnTo: string | null,
  remember = false,
  mode: OidcAuthorizationMode = "interactive",
): string {
  const nonce = crypto.randomBytes(18).toString("base64url");
  return Buffer.from(
    JSON.stringify({ nonce, returnTo: returnTo || "/", remember, mode }),
    "utf8",
  ).toString("base64url");
}

export function parseState(value: string): {
  nonce: string;
  returnTo: string;
  remember: boolean;
  mode: OidcAuthorizationMode;
} {
  const parsed = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  ) as {
    nonce?: unknown;
    returnTo?: unknown;
    remember?: unknown;
    mode?: unknown;
  };
  return {
    nonce: typeof parsed.nonce === "string" ? parsed.nonce : "",
    returnTo:
      typeof parsed.returnTo === "string" && parsed.returnTo.startsWith("/")
        ? parsed.returnTo
        : "/",
    remember: parsed.remember === true,
    mode: parsed.mode === "silent" ? "silent" : "interactive",
  };
}

export function safeReturnToFromState(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }
  try {
    return parseState(value).returnTo || fallback;
  } catch {
    return fallback;
  }
}

export function rememberOidcSession(
  config: AklConfig,
  session: OidcSession,
  nowMs = Date.now(),
): void {
  if (
    !session.accessToken ||
    !session.refreshToken ||
    session.expiresAt <= nowMs + OIDC_SESSION_CACHE_SKEW_MS
  ) {
    return;
  }
  pruneOidcSessionCache(nowMs);
  setOidcSessionCacheEntry(
    oidcSessionCacheKey(config, session.refreshToken),
    {
      expiresAt: session.expiresAt - OIDC_SESSION_CACHE_SKEW_MS,
      promise: Promise.resolve(session),
    },
  );
}

export async function getOrRefreshOidcSession(
  config: AklConfig,
  session: OidcSession,
  nowMs = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<OidcSession | null> {
  if (!matchesManagedClient(config, session)) return null;
  if (session.accessToken && session.expiresAt > nowMs) {
    return session;
  }
  if (!session.refreshToken) {
    return null;
  }

  pruneOidcSessionCache(nowMs);
  const cacheKey = oidcSessionCacheKey(config, session.refreshToken);
  const cached = oidcSessionCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    return cached.promise;
  }

  const pending = refreshOidcSession(config, session, nowMs, fetchImpl)
    .then((refreshed) => {
      if (!refreshed) {
        oidcSessionCache.delete(cacheKey);
        return null;
      }
      rememberOidcSession(config, refreshed, nowMs);
      return refreshed;
    })
    .catch((error: unknown) => {
      oidcSessionCache.delete(cacheKey);
      throw error;
    });
  setOidcSessionCacheEntry(cacheKey, {
    expiresAt: nowMs + OIDC_REFRESH_RACE_TTL_MS,
    promise: pending,
  });
  return pending;
}

export async function refreshOidcSession(
  config: AklConfig,
  session: OidcSession,
  nowMs = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<OidcSession | null> {
  if (!matchesManagedClient(config, session)) return null;
  if (session.accessToken && session.expiresAt > nowMs) {
    return session;
  }
  if (!session.refreshToken) {
    return null;
  }

  const oidc = requireOidcConfig(config);
  if (isManagedIdentity(config)) {
    try {
      const discovery = await managedDiscovery(config, fetchImpl, nowMs);
      const body = new URLSearchParams({ grant_type: "refresh_token", client_id: oidc.clientId, refresh_token: session.refreshToken });
      const tokens = await identityJson(discovery.token_endpoint, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
      }, fetchImpl) as unknown as OidcCallbackTokens;
      const refreshed = await verifiedSessionFromTokens(config, tokens, undefined, nowMs, fetchImpl, session);
      if (refreshed.subjectId !== session.subjectId || refreshed.identitySource !== session.identitySource || refreshed.identityAudience !== session.identityAudience || refreshed.keycloakSessionId !== session.keycloakSessionId) return null;
      const userinfo = await identityJson(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${refreshed.accessToken}` },
      }, fetchImpl);
      if (userinfo.sub !== session.subjectId) return null;
      return { ...refreshed, refreshToken: refreshed.refreshToken ?? session.refreshToken };
    } catch {
      return null;
    }
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: oidc.clientId,
    refresh_token: session.refreshToken,
  });
  if (oidc.clientSecret) {
    body.set("client_secret", oidc.clientSecret);
  }

  try {
    const tokens = await identityJson(`${oidc.issuer}/protocol/openid-connect/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
    }, fetchImpl) as unknown as OidcCallbackTokens;
    const refreshed = await verifiedSessionFromTokens(config, tokens, undefined, nowMs, fetchImpl, session);
    if (refreshed.subjectId !== session.subjectId || refreshed.keycloakSessionId !== session.keycloakSessionId) return null;
    return { ...refreshed, refreshToken: refreshed.refreshToken ?? session.refreshToken };
  } catch {
    return null;
  }
}

function matchesManagedClient(config: AklConfig, session: OidcSession): boolean {
  return !isManagedIdentity(config) || (session.identityIssuer === config.oidc?.issuer && session.identityClientId === config.oidc?.clientId);
}

export function cookieOptions(config: AklConfig) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.environment === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  };
}

export function requireOidcConfig(
  config: AklConfig,
): NonNullable<AklConfig["oidc"]> {
  if (!config.oidc) {
    throw new Error("OIDC configuration is not available.");
  }
  return config.oidc;
}

function oidcSessionCacheKey(config: AklConfig, refreshToken: string): string {
  const oidc = requireOidcConfig(config);
  return crypto
    .createHash("sha256")
    .update(`${oidc.issuer}\u0000${oidc.clientId}\u0000${refreshToken}`)
    .digest("hex");
}

function pruneOidcSessionCache(nowMs: number): void {
  for (const [key, entry] of oidcSessionCache) {
    if (entry.expiresAt <= nowMs) {
      oidcSessionCache.delete(key);
    }
  }
}

function setOidcSessionCacheEntry(
  key: string,
  entry: CachedOidcSession,
): void {
  oidcSessionCache.delete(key);
  oidcSessionCache.set(key, entry);
  while (oidcSessionCache.size > OIDC_SESSION_CACHE_MAX_ENTRIES) {
    const oldestKey = oidcSessionCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    oidcSessionCache.delete(oldestKey);
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) {
    return {};
  }
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

function extractRoles(claims: Record<string, unknown>): string[] {
  const realmAccess = claims.realm_access as { roles?: unknown } | undefined;
  const resourceAccess = claims.resource_access as
    Record<string, { roles?: unknown }> | undefined;
  const roles = new Set<string>(stringArrayClaim(realmAccess?.roles));
  if (resourceAccess) {
    for (const access of Object.values(resourceAccess)) {
      for (const role of stringArrayClaim(access.roles)) {
        roles.add(role);
      }
    }
  }
  return [...roles];
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringArrayClaim(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
}
