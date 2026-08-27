import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import type { AklConfig } from "../../src/lib/api/config";

export const SUBJECT = "11111111-1111-4111-8111-111111111111";
export const OTHER_SUBJECT = "22222222-2222-4222-8222-222222222222";
export const ISSUER = "https://identity.example/identity";

export function managedEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    AKL_ENV: "staging", AKL_API_CLIENT_MODE: "production", AKL_AUTH_MODE: "oidc",
    AKL_IDENTITY_MODE: "managed", AKL_MANAGED_IDENTITY_ISSUER: ISSUER,
    AKL_WEB_OIDC_ISSUER: ISSUER, AKL_WEB_OIDC_CLIENT_ID: "akl-web",
    AKL_WEB_PUBLIC_BASE_URL: "https://akb.example/akb", AKL_WEB_OIDC_SCOPES: "openid profile email",
    AKL_WEB_SESSION_SECRET: "test-only-state-secret",
    AKL_WEB_SESSION_ENCRYPTION_KEY: "test-only-encryption-key-with-32-bytes-minimum",
    AKL_WEB_SESSION_STORE_SECRET: "test-only-session-store-key-with-32-bytes-minimum",
    AKL_WEB_STRATOS_AUTH_ME_URL: "https://identity.example/api/v1/auth/me",
    AKL_WEB_STRATOS_ACCESS_CACHE_TTL_MS: "0", AKL_DIRECTOR_COPILOT_ENABLED: "false",
    AKL_REGISTRY_API_BASE_URL: "https://registry.example/api/v1",
    AKL_INGESTION_API_BASE_URL: "https://ingestion.example/api/v1",
    AKL_RAG_API_BASE_URL: "https://rag.example/api/v1",
    AKL_GOVERNANCE_API_BASE_URL: "https://governance.example/api/v1",
    AKL_EVALUATION_API_BASE_URL: "https://evaluation.example/api/v1",
  };
}

export function managedConfig(): AklConfig {
  return {
    environment: "test", apiClientMode: "production", authMode: "oidc",
    serviceBaseUrls: {
      registry: "https://registry.example/api/v1", ingestion: "https://ingestion.example/api/v1",
      rag: "https://rag.example/api/v1", governance: "https://governance.example/api/v1", evaluation: "https://evaluation.example/api/v1",
    },
    oidc: {
      identityMode: "managed", issuer: ISSUER, managedIssuer: ISSUER,
      clientId: "akl-web", clientSecret: "legacy-secret-must-not-be-sent",
      redirectUri: "https://akb.example/akb/api/auth/callback", logoutRedirectUri: "https://akb.example/akb",
      scopes: "openid profile email", sessionSecret: "test-only-state-secret",
      sessionEncryptionKey: "test-only-encryption-key-with-32-bytes-minimum",
      sessionStoreSecret: "test-only-session-store-key-with-32-bytes-minimum",
      stratosAuthMeUrl: "https://identity.example/api/v1/auth/me", accessProjectionTimeoutMs: 3000,
      accessProjectionCacheTtlMs: 0, identityValidationIntervalMs: 900_000,
      sessionAbsoluteTtlMs: 90 * 86_400_000, sessionIdleTtlMs: 30 * 86_400_000,
    },
  };
}

export async function identityFixture(nowMs = Date.now(), options: { issuer?: string; lifetime?: number; external?: boolean } = {}) {
  const issuer = options.issuer ?? ISSUER;
  const endpointBase = options.external ? `${issuer}/protocol/openid-connect` : issuer;
  const keys = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...await exportJWK(keys.publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  const claims = {
    sub: SUBJECT, aud: ["akl-api", "stratos-access-api"], stratos_roles: ["stratos_user"],
    identity_source: "directory-a", identity_audience: "employees", stratos_remember_device: false,
    stratos_session_started_at: Math.floor(nowMs / 1000),
    sid: "source-session", preferred_username: "same-login", email: "same@example.invalid",
  };
  const discovery = {
    issuer, authorization_endpoint: `${endpointBase}/auth`, token_endpoint: `${endpointBase}/token`,
    jwks_uri: `${endpointBase}/jwks`, userinfo_endpoint: `${endpointBase}/userinfo`,
    revocation_endpoint: `${endpointBase}/token/revocation`, end_session_endpoint: `${endpointBase}/session/end`,
    code_challenge_methods_supported: ["S256"], response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"], id_token_signing_alg_values_supported: ["RS256"],
  };
  const sign = (payload: JWTPayload, at = nowMs) => new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(issuer)
    .setIssuedAt(Math.floor(at / 1000)).setExpirationTime(Math.floor(at / 1000) + (options.lifetime ?? 300)).sign(keys.privateKey);
  const tokens = async (override: JWTPayload = {}, nonce = "test-nonce", at = nowMs) => ({
    access_token: await sign({ ...claims, ...override }, at),
    id_token: await sign({ sub: override.sub ?? SUBJECT, aud: "akl-web", nonce }, at),
    refresh_token: "synthetic-refresh-token", token_type: "Bearer", expires_in: 300,
  });
  const requests: { url: string; init?: RequestInit }[] = [];
  const state = { handle: undefined as ((url: string, init?: RequestInit) => Promise<Response | undefined> | Response | undefined) | undefined };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    const handled = await state.handle?.(url, init);
    if (handled) return handled;
    if (url === `${issuer}/.well-known/openid-configuration`) return Response.json(discovery);
    if (url === discovery.jwks_uri) return Response.json({ keys: [jwk] });
    if (url === discovery.token_endpoint) return Response.json(await tokens());
    if (url === discovery.userinfo_endpoint) return Response.json({ sub: SUBJECT });
    if (url === discovery.revocation_endpoint) return new Response(null, { status: 200 });
    if (url.endsWith("/auth/me")) return Response.json({ id: SUBJECT, identitySubject: SUBJECT, tenantId: "org_stratos",
      applicationAccess: [{ application: "akb", profileId: "knowledge-reader", capabilities: ["akb:access", "akb:chat", "akb:read_document"],
        scopes: [], effectiveScopes: [{ type: "recipient_set", id: "employee-directives" }] }],
    });
    throw new Error("Unexpected fixture route");
  };
  return { keys, jwk, claims, discovery, sign, tokens, requests, state, fetcher, nowMs };
}
