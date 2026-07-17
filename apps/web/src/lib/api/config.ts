export type AklEnvironment = "development" | "test" | "staging" | "production";
export type ApiClientMode = "mock" | "production";
export type AuthMode = "mock" | "oidc";
export type WebProfile = "platform" | "chat";

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
  oidc?: {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    scopes: string;
    sessionSecret: string;
    stratosAuthMeUrl: string;
    accessProjectionTimeoutMs: number;
    accessProjectionCacheTtlMs: number;
  };
  ingestionTransport?: {
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
    clientSecretFile?: string;
  };
  devAccessToken?: string;
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

export function getAklConfig(env: EnvSource = process.env): AklConfig {
  const environment = parseEnvironment(env.AKL_ENV);
  const apiClientMode = parseClientMode(env.AKL_API_CLIENT_MODE);
  const authMode = parseAuthMode(env.AKL_AUTH_MODE);
  const webProfile = parseWebProfile(env.AKL_WEB_PROFILE);

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
          issuer: requireEnv(env.AKL_WEB_OIDC_ISSUER ?? env.AKL_OIDC_ISSUER, "AKL_WEB_OIDC_ISSUER")
            .replace(/\/+$/, ""),
          clientId: requireEnv(env.AKL_WEB_OIDC_CLIENT_ID ?? "akl-web", "AKL_WEB_OIDC_CLIENT_ID"),
          clientSecret: env.AKL_WEB_OIDC_CLIENT_SECRET || undefined,
          redirectUri: `${requireEnv(publicBaseUrl, "AKL_WEB_PUBLIC_BASE_URL")}/api/auth/callback`,
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
          )
        }
      : undefined;
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

  return {
    environment,
    apiClientMode,
    authMode,
    webProfile,
    serviceBaseUrls,
    oidc,
    ingestionTransport,
    devAccessToken: env.AKL_DEV_ACCESS_TOKEN || undefined
  };
}
