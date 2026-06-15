import crypto from "node:crypto";

import type { AklConfig } from "@/lib/api/config";
import type { ApiRequestContext } from "@/lib/types";

export const OIDC_STATE_COOKIE = "akl_oidc_state";
export const OIDC_SESSION_COOKIE = "akl_session";

export interface OidcSession {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  subjectId: string;
  roles: string[];
  groups: string[];
  name?: string;
  email?: string;
}

export interface OidcCallbackTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

export function buildAuthorizationUrl(config: AklConfig, state: string): string {
  const oidc = requireOidcConfig(config);
  const url = new URL(`${oidc.issuer}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", oidc.clientId);
  url.searchParams.set("redirect_uri", oidc.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", oidc.scopes);
  url.searchParams.set("state", state);
  return url.toString();
}

export function buildLogoutUrl(config: AklConfig): string {
  const oidc = requireOidcConfig(config);
  const url = new URL(`${oidc.issuer}/protocol/openid-connect/logout`);
  url.searchParams.set("client_id", oidc.clientId);
  url.searchParams.set("post_logout_redirect_uri", oidc.redirectUri.replace(/\/api\/auth\/callback$/, ""));
  return url.toString();
}

export function buildPublicAppUrl(config: AklConfig, path: string): string {
  const oidc = requireOidcConfig(config);
  const publicBaseUrl = oidc.redirectUri.replace(/\/api\/auth\/callback$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${publicBaseUrl}${normalizedPath === "/" ? "" : normalizedPath}`;
}

export async function exchangeAuthorizationCode(config: AklConfig, code: string): Promise<OidcCallbackTokens> {
  const oidc = requireOidcConfig(config);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: oidc.clientId,
    code,
    redirect_uri: oidc.redirectUri
  });
  if (oidc.clientSecret) {
    body.set("client_secret", oidc.clientSecret);
  }

  const response = await fetch(`${oidc.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const summary = detail ? `: ${detail.slice(0, 300)}` : "";
    throw new Error(`OIDC token exchange failed with ${response.status}${summary}`);
  }
  return (await response.json()) as OidcCallbackTokens;
}

export function sessionFromTokens(tokens: OidcCallbackTokens, nowMs = Date.now()): OidcSession {
  const claims = decodeJwtPayload(tokens.access_token);
  const fallbackClaims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : {};
  const subjectId = stringClaim(claims.sub) ?? stringClaim(claims.preferred_username) ?? stringClaim(fallbackClaims.sub);
  if (!subjectId) {
    throw new Error("OIDC token does not contain a subject.");
  }

  return {
    accessToken: tokens.access_token,
    expiresAt: nowMs + Math.max(tokens.expires_in ?? 300, 30) * 1000,
    subjectId,
    roles: extractRoles(claims),
    groups: stringArrayClaim(claims.groups),
    name: stringClaim(claims.name) ?? stringClaim(fallbackClaims.name),
    email: stringClaim(claims.email) ?? stringClaim(fallbackClaims.email)
  };
}

export function contextFromOidcSession(session: OidcSession): ApiRequestContext {
  return {
    subjectId: session.subjectId,
    roles: session.roles,
    groups: session.groups,
    accessToken: session.accessToken
  };
}

export function contextFromOidcAccessToken(accessToken: string): ApiRequestContext {
  const claims = decodeJwtPayload(accessToken);
  const subjectId = stringClaim(claims.sub) ?? stringClaim(claims.preferred_username);
  if (!subjectId) {
    throw new Error("OIDC bearer token does not contain a subject.");
  }

  return {
    subjectId,
    roles: extractRoles(claims),
    groups: stringArrayClaim(claims.groups),
    accessToken
  };
}

export function createState(returnTo: string | null): string {
  const nonce = crypto.randomBytes(18).toString("base64url");
  return Buffer.from(JSON.stringify({ nonce, returnTo: returnTo || "/" }), "utf8").toString("base64url");
}

export function parseState(value: string): { nonce: string; returnTo: string } {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
    nonce?: unknown;
    returnTo?: unknown;
  };
  return {
    nonce: typeof parsed.nonce === "string" ? parsed.nonce : "",
    returnTo: typeof parsed.returnTo === "string" && parsed.returnTo.startsWith("/") ? parsed.returnTo : "/"
  };
}

export function sealSession(session: OidcSession, secret: string): string {
  const iv = crypto.randomBytes(12);
  const key = sessionKey(secret);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function openSession(value: string, secret: string, nowMs = Date.now()): OidcSession | null {
  try {
    const payload = Buffer.from(value, "base64url");
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", sessionKey(secret), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const session = JSON.parse(plaintext.toString("utf8")) as OidcSession;
    if (!session.accessToken || !session.subjectId || session.expiresAt <= nowMs) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function readSessionCookie(
  cookies: { get(name: string): { value: string } | undefined },
  config: AklConfig,
  nowMs = Date.now()
): OidcSession | null {
  const oidc = requireOidcConfig(config);
  const value = cookies.get(OIDC_SESSION_COOKIE)?.value;
  return value ? openSession(value, oidc.sessionSecret, nowMs) : null;
}

export function cookieOptions(config: AklConfig) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.environment === "production",
    path: "/",
    maxAge: 60 * 60 * 8
  };
}

export function requireOidcConfig(config: AklConfig): NonNullable<AklConfig["oidc"]> {
  if (!config.oidc) {
    throw new Error("OIDC configuration is not available.");
  }
  return config.oidc;
}

function sessionKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) {
    return {};
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

function extractRoles(claims: Record<string, unknown>): string[] {
  const realmAccess = claims.realm_access as { roles?: unknown } | undefined;
  const resourceAccess = claims.resource_access as Record<string, { roles?: unknown }> | undefined;
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
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
