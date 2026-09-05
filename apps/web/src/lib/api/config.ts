export type AklEnvironment = "development" | "test" | "staging" | "production";
export type ApiClientMode = "mock" | "production";
export type AuthMode = "mock" | "oidc";
export type WebProfile = "platform" | "chat";
export type IdentityMode = "external_oidc" | "managed";
export interface ManagedServiceClient {
  clientId: string;
  clientSecret?: string;
  clientSecretFile?: string;
}
export interface DirectorCopilotConfig {
  enabled: boolean;
  v2ManifestCacheTtlMs?: number;
  tokenUrl?: string;
  clientId: string;
  clientSecret?: string;
  clientSecretFile?: string;
  budgetBaseUrl?: string;
  projectflowBaseUrl?: string;
  archflowBaseUrl?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  managedIssuer?: string;
  managedClients?: Record<"budget-api" | "projectflow-api" | "archflow-api", ManagedServiceClient>;
}

export interface AklConfig {
  environment: AklEnvironment;
  apiClientMode: ApiClientMode;
  authMode: AuthMode;
  webProfile?: WebProfile;
  serviceBaseUrls: {
    registry: string;
    ingestion: string;
    rag: string;
    governance: string;
    evaluation: string;
  };
  ragAssistantTimeoutMs?: number;
  oidc?: {
    identityMode?: IdentityMode;
    managedIssuer?: string;
    issuer: string;
    clientId: string;
    accessTokenAudience?: string;
    clientSecret?: string;
    redirectUri: string;
    logoutRedirectUri?: string;
    scopes: string;
    sessionSecret: string;
    stratosAuthMeUrl: string;
    accessProjectionTimeoutMs: number;
    accessProjectionCacheTtlMs: number;
    sessionEncryptionKey?: string;
    sessionEncryptionKeyFile?: string;
    sessionStoreSecret?: string;
    sessionStoreSecretFile?: string;
    sessionAbsoluteTtlMs?: number;
    sessionIdleTtlMs?: number;
    identityValidationIntervalMs?: number;
  };
  ingestionTransport?: {
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
    clientSecretFile?: string;
  };
  governanceTransport?: {
    serviceToken: string;
  };
  directorCopilot?: DirectorCopilotConfig;
  devAccessToken?: string;
}

export function getDirectorCopilotConfig(config: AklConfig): DirectorCopilotConfig {
  return config.directorCopilot ?? {
    enabled: false,
    v2ManifestCacheTtlMs: 300_000,
    clientId: "svc-akb-director-copilot",
    timeoutMs: 8_000,
    maxResponseBytes: 262_144,
  };
}

type EnvSource = Record<string, string | undefined>;

function parseEnvironment(value: string | undefined): AklEnvironment {
  const normalized = value ?? "development";
  if (["development", "test", "staging", "production"].includes(normalized)) {
    return normalized as AklEnvironment;
  }
  throw new Error(`Unsupported AKL_ENV value: ${normalized}`);
}

function parseClientMode(value: string | undefined): ApiClientMode {
  const normalized = value ?? "mock";
  if (normalized === "mock" || normalized === "production") {
    return normalized;
  }
  throw new Error(`Unsupported AKL_API_CLIENT_MODE value: ${normalized}`);
}

function parseAuthMode(value: string | undefined): AuthMode {
  const normalized = value ?? "mock";
  if (normalized === "mock" || normalized === "oidc") {
    return normalized;
  }
  throw new Error(`Unsupported AKL_AUTH_MODE value: ${normalized}`);
}

function parseWebProfile(value: string | undefined): WebProfile {
  const normalized = value ?? "platform";
  if (normalized === "platform" || normalized === "chat") {
    return normalized;
  }
  throw new Error(`Unsupported AKL_WEB_PROFILE value: ${normalized}`);
}

function normalizeBaseUrl(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when AKL_API_CLIENT_MODE=production`);
  }
  return value.replace(/\/+$/, "");
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when AKL_AUTH_MODE=oidc`);
  }
  return value;
}

function normalizeOidcScopes(value: string | undefined): string {
  const raw = value ?? "openid profile email";
  const trimmed = raw.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  const normalized = unquoted.trim().split(/\s+/).filter(Boolean).join(" ");
  return normalized || "openid profile email";
}

function positiveNumber(value: string | undefined, fallback: number, name: string, allowZero = false): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(`${name} must be ${allowZero ? "zero or a positive number" : "a positive number"}`);
  }
  return parsed;
}

function strictBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function getAklConfig(env: EnvSource = process.env): AklConfig {
  const environment = parseEnvironment(env.AKL_ENV);
  const apiClientMode = parseClientMode(env.AKL_API_CLIENT_MODE);
  const authMode = parseAuthMode(env.AKL_AUTH_MODE);
  const webProfile = parseWebProfile(env.AKL_WEB_PROFILE);
  const identityMode = env.AKL_IDENTITY_MODE || "external_oidc";
  if (identityMode !== "external_oidc" && identityMode !== "managed") {
    throw new Error("AKL_IDENTITY_MODE must be external_oidc or managed");
  }
  if (identityMode === "managed" && authMode !== "oidc") {
    throw new Error("Managed identity requires AKL_AUTH_MODE=oidc");
  }

  if (environment === "production" && apiClientMode === "mock") {
    throw new Error("Refusing to start production with AKL_API_CLIENT_MODE=mock");
  }

  if (environment === "production" && authMode === "mock") {
    throw new Error("Refusing to start production with AKL_AUTH_MODE=mock");
  }

  const serviceBaseUrls =
    apiClientMode === "production"
      ? {
          registry: normalizeBaseUrl(env.AKL_REGISTRY_API_BASE_URL, "AKL_REGISTRY_API_BASE_URL"),
          ingestion: normalizeBaseUrl(env.AKL_INGESTION_API_BASE_URL, "AKL_INGESTION_API_BASE_URL"),
          rag: normalizeBaseUrl(env.AKL_RAG_API_BASE_URL, "AKL_RAG_API_BASE_URL"),
          governance: normalizeBaseUrl(env.AKL_GOVERNANCE_API_BASE_URL, "AKL_GOVERNANCE_API_BASE_URL"),
          evaluation: normalizeBaseUrl(env.AKL_EVALUATION_API_BASE_URL, "AKL_EVALUATION_API_BASE_URL")
        }
      : {
          registry: "mock://registry",
          ingestion: "mock://ingestion",
          rag: "mock://rag",
          governance: "mock://governance",
          evaluation: "mock://evaluation"
        };
  const publicBaseUrl = env.AKL_WEB_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  const oidc =
    authMode === "oidc"
      ? {
          identityMode: identityMode as IdentityMode,
          managedIssuer: env.AKL_MANAGED_IDENTITY_ISSUER || undefined,
          issuer: identityMode === "managed"
            ? requireEnv(env.AKL_WEB_OIDC_ISSUER ?? env.AKL_OIDC_ISSUER, "AKL_WEB_OIDC_ISSUER")
            : requireEnv(env.AKL_WEB_OIDC_ISSUER ?? env.AKL_OIDC_ISSUER, "AKL_WEB_OIDC_ISSUER").replace(/\/+$/, ""),
          clientId: requireEnv(env.AKL_WEB_OIDC_CLIENT_ID ?? "akl-web", "AKL_WEB_OIDC_CLIENT_ID"),
          accessTokenAudience: env.AKL_OIDC_AUDIENCE || "akl-api",
          clientSecret: identityMode === "managed" ? undefined : env.AKL_WEB_OIDC_CLIENT_SECRET || undefined,
          redirectUri: `${requireEnv(publicBaseUrl, "AKL_WEB_PUBLIC_BASE_URL")}/api/auth/callback`,
          logoutRedirectUri: env.AKL_WEB_OIDC_LOGOUT_REDIRECT_URI || publicBaseUrl,
          scopes: normalizeOidcScopes(env.AKL_WEB_OIDC_SCOPES),
          sessionSecret: requireEnv(env.AKL_WEB_SESSION_SECRET, "AKL_WEB_SESSION_SECRET"),
          stratosAuthMeUrl: requireEnv(
            env.AKL_WEB_STRATOS_AUTH_ME_URL
              ?? (env.AKL_STRATOS_API_BASE_URL
                ? `${env.AKL_STRATOS_API_BASE_URL.replace(/\/+$/, "")}/api/v1/auth/me`
                : undefined),
            "AKL_WEB_STRATOS_AUTH_ME_URL"
          ),
          accessProjectionTimeoutMs: positiveNumber(
            env.AKL_WEB_STRATOS_ACCESS_TIMEOUT_MS,
            3000,
            "AKL_WEB_STRATOS_ACCESS_TIMEOUT_MS"
          ),
          accessProjectionCacheTtlMs: positiveNumber(
            env.AKL_WEB_STRATOS_ACCESS_CACHE_TTL_MS,
            0,
            "AKL_WEB_STRATOS_ACCESS_CACHE_TTL_MS",
            true
          ),
          sessionEncryptionKey: env.AKL_WEB_SESSION_ENCRYPTION_KEY || undefined,
          sessionEncryptionKeyFile: env.AKL_WEB_SESSION_ENCRYPTION_KEY_FILE || undefined,
          sessionStoreSecret: env.AKL_WEB_SESSION_STORE_SECRET || undefined,
          sessionStoreSecretFile: env.AKL_WEB_SESSION_STORE_SECRET_FILE || undefined,
          sessionAbsoluteTtlMs: positiveNumber(
            env.AKL_WEB_SESSION_ABSOLUTE_TTL_DAYS,
            90,
            "AKL_WEB_SESSION_ABSOLUTE_TTL_DAYS",
          ) * 86_400_000,
          sessionIdleTtlMs: positiveNumber(
            env.AKL_WEB_SESSION_IDLE_TTL_DAYS,
            30,
            "AKL_WEB_SESSION_IDLE_TTL_DAYS",
          ) * 86_400_000,
          identityValidationIntervalMs: positiveNumber(
            env.AKL_WEB_IDENTITY_VALIDATION_INTERVAL_MINUTES,
            15,
            "AKL_WEB_IDENTITY_VALIDATION_INTERVAL_MINUTES",
          ) * 60_000,
        }
      : undefined;

  if (oidc) {
    if (identityMode === "managed") {
      assertManagedIssuer(oidc.issuer, oidc.managedIssuer);
      if (oidc.accessTokenAudience !== "akl-api") throw new Error("Managed browser access audience must be akl-api");
      if (!env.AKL_WEB_OIDC_CLIENT_ID) throw new Error("Managed identity requires an explicit browser client ID");
      if (oidc.scopes !== "openid profile email") throw new Error("Managed browser scopes must be openid profile email");
      for (const uri of [oidc.redirectUri, oidc.logoutRedirectUri, oidc.stratosAuthMeUrl]) {
        if (!uri || !isApprovedHttpsUrl(uri)) throw new Error("Managed identity requires explicit HTTPS application and projection URLs");
      }
      if (oidc.accessProjectionCacheTtlMs !== 0) throw new Error("Managed access projection must be checked on every request");
      if (oidc.identityValidationIntervalMs > 15 * 60_000 || oidc.sessionIdleTtlMs > 30 * 86_400_000 || oidc.sessionAbsoluteTtlMs > 90 * 86_400_000) {
        throw new Error("Managed session limits cannot exceed the identity contract");
      }
    }
    if (oidc.sessionEncryptionKey && oidc.sessionEncryptionKeyFile) {
      throw new Error("Configure only one AKL_WEB_SESSION_ENCRYPTION_KEY source");
    }
    if (oidc.sessionStoreSecret && oidc.sessionStoreSecretFile) {
      throw new Error("Configure only one AKL_WEB_SESSION_STORE_SECRET source");
    }
    if (environment === "production") {
      if (!oidc.sessionEncryptionKeyFile || !oidc.sessionStoreSecretFile) {
        throw new Error("Production OIDC requires file-backed server session encryption and store secrets");
      }
      if ((oidc.sessionIdleTtlMs ?? 0) > (oidc.sessionAbsoluteTtlMs ?? 0)) {
        throw new Error("OIDC idle session lifetime cannot exceed absolute lifetime");
      }
      if ((oidc.sessionAbsoluteTtlMs ?? 0) > 90 * 86_400_000) {
        throw new Error("OIDC absolute session lifetime cannot exceed 90 days");
      }
      if ((oidc.sessionIdleTtlMs ?? 0) > 30 * 86_400_000) {
        throw new Error("OIDC idle session lifetime cannot exceed 30 days");
      }
      if ((oidc.identityValidationIntervalMs ?? 0) > 15 * 60_000) {
        throw new Error("OIDC identity validation interval cannot exceed 15 minutes");
      }
    }
  }
  const ingestionTransportConfigured = authMode === "oidc" && Boolean(
    env.AKL_WEB_INGESTION_TOKEN_URL
      || env.AKL_WEB_INGESTION_CLIENT_ID
      || env.AKL_WEB_INGESTION_CLIENT_SECRET
      || env.AKL_WEB_INGESTION_CLIENT_SECRET_FILE,
  );
  const ingestionTransport = ingestionTransportConfigured
    ? {
        tokenUrl: requireEnv(
          env.AKL_WEB_INGESTION_TOKEN_URL,
          "AKL_WEB_INGESTION_TOKEN_URL",
        ).replace(/\/+$/, ""),
        clientId: requireEnv(
          env.AKL_WEB_INGESTION_CLIENT_ID,
          "AKL_WEB_INGESTION_CLIENT_ID",
        ),
        clientSecret: env.AKL_WEB_INGESTION_CLIENT_SECRET || undefined,
        clientSecretFile: env.AKL_WEB_INGESTION_CLIENT_SECRET_FILE || undefined,
      }
    : undefined;

  if (ingestionTransport?.clientSecret && ingestionTransport.clientSecretFile) {
    throw new Error(
      "Configure only one of AKL_WEB_INGESTION_CLIENT_SECRET or AKL_WEB_INGESTION_CLIENT_SECRET_FILE",
    );
  }
  if (environment === "production" && webProfile === "platform") {
    if (!ingestionTransport) {
      throw new Error("Production requires the dedicated web-to-ingestion service identity");
    }
    if (ingestionTransport.clientId !== "svc-akb-web-ingestion") {
      throw new Error("AKL_WEB_INGESTION_CLIENT_ID must be svc-akb-web-ingestion in production");
    }
    if (!ingestionTransport.tokenUrl.startsWith("https://")) {
      throw new Error("AKL_WEB_INGESTION_TOKEN_URL must use HTTPS in production");
    }
    if (!ingestionTransport.clientSecret && !ingestionTransport.clientSecretFile) {
      throw new Error("Production web-to-ingestion service identity requires a client secret");
    }
  }

  const governanceTransport = env.AKL_GOVERNANCE_SERVICE_TOKEN
    ? { serviceToken: env.AKL_GOVERNANCE_SERVICE_TOKEN }
    : undefined;
  if (environment === "production" && webProfile === "platform" && !governanceTransport) {
    throw new Error("Production platform requires AKL_GOVERNANCE_SERVICE_TOKEN");
  }

  const directorCopilotEnabled = strictBoolean(
    env.AKL_DIRECTOR_COPILOT_ENABLED,
    false,
    "AKL_DIRECTOR_COPILOT_ENABLED",
  );
  const directorCopilot: DirectorCopilotConfig = {
    enabled: directorCopilotEnabled,
    v2ManifestCacheTtlMs: positiveNumber(
      env.AKL_DIRECTOR_COPILOT_V2_MANIFEST_CACHE_TTL_MS,
      300_000,
      "AKL_DIRECTOR_COPILOT_V2_MANIFEST_CACHE_TTL_MS",
    ),
    tokenUrl: env.AKL_DIRECTOR_COPILOT_TOKEN_URL?.replace(/\/+$/, "") || undefined,
    clientId: env.AKL_DIRECTOR_COPILOT_CLIENT_ID || "svc-akb-director-copilot",
    clientSecret: env.AKL_DIRECTOR_COPILOT_CLIENT_SECRET || undefined,
    clientSecretFile: env.AKL_DIRECTOR_COPILOT_CLIENT_SECRET_FILE || undefined,
    budgetBaseUrl: env.AKL_DIRECTOR_COPILOT_BUDGET_BASE_URL?.replace(/\/+$/, "") || undefined,
    projectflowBaseUrl: env.AKL_DIRECTOR_COPILOT_PROJECTFLOW_BASE_URL?.replace(/\/+$/, "") || undefined,
    archflowBaseUrl: env.AKL_DIRECTOR_COPILOT_ARCHFLOW_BASE_URL?.replace(/\/+$/, "") || undefined,
    timeoutMs: positiveNumber(
      env.AKL_DIRECTOR_COPILOT_TIMEOUT_MS,
      8_000,
      "AKL_DIRECTOR_COPILOT_TIMEOUT_MS",
    ),
    maxResponseBytes: positiveNumber(
      env.AKL_DIRECTOR_COPILOT_MAX_RESPONSE_BYTES,
      262_144,
      "AKL_DIRECTOR_COPILOT_MAX_RESPONSE_BYTES",
    ),
  };
  if (identityMode === "managed") {
    // Legacy transport credentials must never follow a new issuer.
    directorCopilot.tokenUrl = undefined;
    directorCopilot.clientSecret = undefined;
    directorCopilot.clientSecretFile = undefined;
    directorCopilot.managedIssuer = oidc?.managedIssuer;
    directorCopilot.managedClients = Object.fromEntries(
      ["budget", "projectflow", "archflow"].map((domain) => {
        const prefix = `AKL_DIRECTOR_COPILOT_${domain.toUpperCase()}`;
        const client = {
          clientId: env[`${prefix}_CLIENT_ID`] || `svc-akb-director-copilot-${domain}`,
          clientSecret: env[`${prefix}_CLIENT_SECRET`] || undefined,
          clientSecretFile: env[`${prefix}_CLIENT_SECRET_FILE`] || undefined,
        };
        if (directorCopilot.enabled && ((!client.clientSecret && !client.clientSecretFile) || (client.clientSecret && client.clientSecretFile))) {
          throw new Error(`${prefix} requires exactly one dedicated credential source`);
        }
        if (directorCopilot.enabled && environment === "production" && !client.clientSecretFile) {
          throw new Error(`${prefix} requires a file-backed production credential`);
        }
        return [`${domain}-api`, client];
      }),
    ) as DirectorCopilotConfig["managedClients"];
    if (new Set(Object.values(directorCopilot.managedClients!).map((client) => client.clientId)).size !== 3) {
      throw new Error("Managed Director Copilot requires three distinct service clients");
    }
  }
  if (directorCopilot.clientSecret && directorCopilot.clientSecretFile) {
    throw new Error(
      "Configure only one of AKL_DIRECTOR_COPILOT_CLIENT_SECRET or AKL_DIRECTOR_COPILOT_CLIENT_SECRET_FILE",
    );
  }
  if (directorCopilot.enabled && environment === "production" && directorCopilot.clientSecret) {
    throw new Error("Production Director Copilot credential must use AKL_DIRECTOR_COPILOT_CLIENT_SECRET_FILE");
  }
  if (directorCopilot.enabled && authMode === "oidc" && identityMode !== "managed") {
    if (directorCopilot.clientId !== "svc-akb-director-copilot") {
      throw new Error("AKL_DIRECTOR_COPILOT_CLIENT_ID must be svc-akb-director-copilot");
    }
    if (!directorCopilot.tokenUrl) {
      throw new Error("AKL_DIRECTOR_COPILOT_TOKEN_URL is required when Director Copilot is enabled");
    }
    if (environment === "production" && !directorCopilot.tokenUrl.startsWith("https://")) {
      throw new Error("AKL_DIRECTOR_COPILOT_TOKEN_URL must use HTTPS in production");
    }
    if (!directorCopilot.clientSecret && !directorCopilot.clientSecretFile) {
      throw new Error("Director Copilot requires a dedicated service credential");
    }
  }
  if (directorCopilot.enabled && (
    !directorCopilot.budgetBaseUrl
    || !directorCopilot.projectflowBaseUrl
    || !directorCopilot.archflowBaseUrl
  )) {
    throw new Error("Director Copilot requires Budget, ProjectFlow and ArchFlow base URLs");
  }

  return {
    environment,
    apiClientMode,
    authMode,
    webProfile,
    serviceBaseUrls,
    ragAssistantTimeoutMs: positiveNumber(
      env.AKL_WEB_RAG_ASSISTANT_TIMEOUT_MS,
      45_000,
      "AKL_WEB_RAG_ASSISTANT_TIMEOUT_MS",
    ),
    oidc,
    ingestionTransport,
    governanceTransport,
    directorCopilot,
    devAccessToken: env.AKL_DEV_ACCESS_TOKEN || undefined
  };
}

export function assertManagedIssuer(issuer: string, approvedIssuer: string | undefined): void {
  if (!approvedIssuer || issuer !== approvedIssuer || !isApprovedHttpsUrl(issuer) || issuer.endsWith("/")) {
    throw new Error("Managed issuer must exactly match AKL_MANAGED_IDENTITY_ISSUER and use HTTPS without a trailing slash");
  }
}

function isApprovedHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}
