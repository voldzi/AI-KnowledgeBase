import "server-only";

import { createLocalJWKSet, decodeProtectedHeader, errors, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";

import { assertManagedIssuer, type AklConfig } from "@/lib/api/config";

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
  revocation_endpoint: string;
  end_session_endpoint: string;
}

type DiscoveryEntry = { value: OidcDiscovery; expiresAt: number };
type KeysEntry = { resolve: ReturnType<typeof createLocalJWKSet>; fetchedAt: number };
let discoveryCache = new WeakMap<typeof fetch, Map<string, DiscoveryEntry>>();
let keysCache = new WeakMap<typeof fetch, Map<string, KeysEntry>>();
const CACHE_TTL_MS = 300_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USER_FORBIDDEN = ["stratos_service", "stratos_service_roles", "realm_access", "resource_access", "role", "roles"];
const SERVICE_FORBIDDEN = ["stratos_roles", "realm_access", "resource_access", "role", "roles", "identity_source", "identity_audience", "stratos_remember_device", "stratos_session_started_at", "email", "preferred_username", "name", "groups", "auth_time"];

export function isManagedIdentity(config: AklConfig): boolean {
  return config.oidc?.identityMode === "managed";
}

export async function managedDiscovery(config: AklConfig, fetcher: typeof fetch = fetch, nowMs = Date.now()): Promise<OidcDiscovery> {
  if (!isManagedIdentity(config)) throw new Error("MANAGED_IDENTITY_NOT_CONFIGURED");
  return approvedOidcDiscovery(config, fetcher, nowMs);
}

export async function approvedOidcDiscovery(config: AklConfig, fetcher: typeof fetch = fetch, nowMs = Date.now()): Promise<OidcDiscovery> {
  const oidc = config.oidc;
  if (!oidc) throw new Error("OIDC_NOT_CONFIGURED");
  if (isManagedIdentity(config)) assertManagedIssuer(oidc.issuer, oidc.managedIssuer);
  const issuerUrl = new URL(oidc.issuer);
  if (issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash || (issuerUrl.protocol !== "https:" && (config.environment === "production" || isManagedIdentity(config) || issuerUrl.protocol !== "http:"))) throw new Error("OIDC_ISSUER_INVALID");
  let cache = discoveryCache.get(fetcher);
  if (!cache) discoveryCache.set(fetcher, cache = new Map());
  const cacheKey = `${oidc.identityMode ?? "external_oidc"}:${oidc.issuer}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.value;
  const body = await identityJson(`${oidc.issuer}/.well-known/openid-configuration`, {}, fetcher);
  if (body.issuer !== oidc.issuer || !has(body.code_challenge_methods_supported, "S256") || !has(body.response_types_supported, "code") || !has(body.id_token_signing_alg_values_supported, "RS256") || (isManagedIdentity(config) && (!has(body.token_endpoint_auth_methods_supported, "none") || !has(body.token_endpoint_auth_methods_supported, "client_secret_post") || !["authorization_code", "refresh_token", "client_credentials"].every((grant) => has(body.grant_types_supported, grant))))) {
    throw new Error("OIDC_DISCOVERY_CONTRACT_INVALID");
  }
  const endpoints = ["authorization_endpoint", "token_endpoint", "jwks_uri", "userinfo_endpoint", "revocation_endpoint", "end_session_endpoint"] as const;
  for (const key of endpoints) assertIssuerEndpoint(oidc.issuer, body[key], config.environment !== "production" && !isManagedIdentity(config));
  const value = Object.fromEntries(["issuer", ...endpoints].map((key) => [key, body[key]])) as unknown as OidcDiscovery;
  cache.set(cacheKey, { value, expiresAt: nowMs + CACHE_TTL_MS });
  return value;
}

export async function verifyManagedJwt(config: AklConfig, token: string, audience: string, fetcher: typeof fetch = fetch, nowMs = Date.now()): Promise<JWTPayload> {
  if (!isManagedIdentity(config)) throw new Error("MANAGED_IDENTITY_NOT_CONFIGURED");
  return verifyApprovedOidcJwt(config, token, audience, fetcher, nowMs);
}

export async function verifyApprovedOidcJwt(config: AklConfig, token: string, audience: string, fetcher: typeof fetch = fetch, nowMs = Date.now()): Promise<JWTPayload> {
  if (typeof token !== "string" || token.length > 16_384 || token.split(".").length !== 3) throw new Error("OIDC_TOKEN_INVALID");
  const header = decodeProtectedHeader(token);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length < 1 || header.kid.length > 160) throw new Error("OIDC_TOKEN_INVALID");
  const discovery = await approvedOidcDiscovery(config, fetcher, nowMs);
  let cache = keysCache.get(fetcher);
  if (!cache) keysCache.set(fetcher, cache = new Map());
  let keys = cache.get(discovery.jwks_uri);
  const load = async () => {
    const body = await identityJson(discovery.jwks_uri, {}, fetcher);
    if (!Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 32) throw new Error("OIDC_JWKS_INVALID");
    const entry = { resolve: createLocalJWKSet(body as unknown as JSONWebKeySet), fetchedAt: nowMs };
    cache!.set(discovery.jwks_uri, entry);
    return entry;
  };
  if (!keys || keys.fetchedAt + CACHE_TTL_MS <= nowMs) keys = await load();
  const verify = (entry: KeysEntry) => jwtVerify(token, entry.resolve, {
    issuer: discovery.issuer, audience, algorithms: ["RS256"],
    requiredClaims: ["iss", "sub", "aud", "iat", "exp"],
    currentDate: new Date(nowMs), clockTolerance: 5,
  });
  let result;
  try {
    result = await verify(keys);
  } catch (error) {
    if (!(error instanceof errors.JWKSNoMatchingKey) || keys.fetchedAt + 30_000 > nowMs) throw new Error("OIDC_TOKEN_INVALID");
    result = await verify(await load()).catch(() => { throw new Error("OIDC_TOKEN_INVALID"); });
  }
  const claims = result.payload;
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat! > nowMs / 1000 + 5 || claims.exp! <= nowMs / 1000 || claims.exp! <= claims.iat! || (isManagedIdentity(config) && claims.exp! - claims.iat! > 300)) {
    throw new Error("OIDC_TOKEN_LIFETIME_INVALID");
  }
  return claims;
}

export async function verifyManagedUserToken(config: AklConfig, token: string, fetcher: typeof fetch = fetch, nowMs = Date.now()): Promise<JWTPayload> {
  const claims = await verifyManagedJwt(config, token, "akl-api", fetcher, nowMs);
  if (!exactValues(claims.aud, ["akl-api", "stratos-access-api"]) || !UUID.test(claims.sub ?? "") || !exactValues(claims.stratos_roles, ["stratos_user"]) || USER_FORBIDDEN.some((key) => Object.hasOwn(claims, key)) || (claims.identity_audience !== "employees" && claims.identity_audience !== "external") || typeof claims.identity_source !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(claims.identity_source) || typeof claims.stratos_remember_device !== "boolean") {
    throw new Error("OIDC_USER_CLAIMS_INVALID");
  }
  return claims;
}

export async function verifyManagedIdToken(config: AklConfig, token: string, subject: string, nonce: string | undefined, fetcher: typeof fetch = fetch, nowMs = Date.now()): Promise<JWTPayload> {
  const clientId = config.oidc!.clientId;
  const claims = await verifyApprovedOidcJwt(config, token, clientId, fetcher, nowMs);
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (!exactValues(audiences, [clientId]) || claims.sub !== subject || (claims.azp !== undefined && claims.azp !== clientId) || (nonce !== undefined && (!nonce || claims.nonce !== nonce))) {
    throw new Error("OIDC_ID_TOKEN_INVALID");
  }
  return claims;
}

export async function verifyManagedServiceToken(config: AklConfig, token: string, audience: string, clientId: string, fetcher: typeof fetch = fetch, nowMs = Date.now()): Promise<JWTPayload> {
  const claims = await verifyManagedJwt(config, token, audience, fetcher, nowMs);
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (!exactValues(audiences, [audience]) || claims.client_id !== clientId || (claims.azp !== undefined && claims.azp !== clientId) || claims.stratos_service !== true || claims.scope !== "director-copilot:read" || SERVICE_FORBIDDEN.some((key) => Object.hasOwn(claims, key)) || Object.hasOwn(claims, "stratos_service_roles")) {
    throw new Error("OIDC_SERVICE_CLAIMS_INVALID");
  }
  return claims;
}

export function exactValues(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && new Set(value).size === expected.length && value.every((entry) => typeof entry === "string" && expected.includes(entry));
}

export async function identityJson(url: string, init: RequestInit, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  try {
    const response = await fetcher(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000), opentelemetry: { ignore: true, propagateContext: false } });
    if (!response.ok) throw new Error("OIDC_ENDPOINT_REJECTED");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("OIDC_RESPONSE_INVALID");
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) { await reader.cancel(); throw new Error("OIDC_RESPONSE_TOO_LARGE"); }
      parts.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("OIDC_RESPONSE_INVALID");
    return body as Record<string, unknown>;
  } catch {
    // Never surface upstream bodies, tokens, URL parameters or transport errors.
    throw new Error("OIDC_ENDPOINT_UNAVAILABLE_OR_INVALID");
  }
}

function assertIssuerEndpoint(issuer: string, endpoint: unknown, allowDevelopmentHttp = false): void {
  if (typeof endpoint !== "string") throw new Error("OIDC_DISCOVERY_ENDPOINT_INVALID");
  const base = new URL(issuer);
  const url = new URL(endpoint);
  if ((url.protocol !== "https:" && !(allowDevelopmentHttp && url.protocol === "http:")) || url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/`) || url.username || url.password || url.search || url.hash) {
    throw new Error("OIDC_DISCOVERY_ENDPOINT_INVALID");
  }
}

function has(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.includes(expected);
}

export function resetManagedOidcCachesForTests(): void {
  discoveryCache = new WeakMap();
  keysCache = new WeakMap();
}
