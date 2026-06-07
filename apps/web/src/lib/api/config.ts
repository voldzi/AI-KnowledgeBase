export type AklEnvironment = "development" | "test" | "staging" | "production";
export type ApiClientMode = "mock" | "production";
export type AuthMode = "mock" | "oidc";

export interface AklConfig {
  environment: AklEnvironment;
  apiClientMode: ApiClientMode;
  authMode: AuthMode;
  serviceBaseUrls: {
    registry: string;
    ingestion: string;
    rag: string;
    governance: string;
  };
  oidc?: {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    scopes: string;
    sessionSecret: string;
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

export function getAklConfig(env: EnvSource = process.env): AklConfig {
  const environment = parseEnvironment(env.AKL_ENV);
  const apiClientMode = parseClientMode(env.AKL_API_CLIENT_MODE);
  const authMode = parseAuthMode(env.AKL_AUTH_MODE);

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
          governance: normalizeBaseUrl(env.AKL_GOVERNANCE_API_BASE_URL, "AKL_GOVERNANCE_API_BASE_URL")
        }
      : {
          registry: "mock://registry",
          ingestion: "mock://ingestion",
          rag: "mock://rag",
          governance: "mock://governance"
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
          scopes: env.AKL_WEB_OIDC_SCOPES ?? "openid profile email",
          sessionSecret: requireEnv(env.AKL_WEB_SESSION_SECRET, "AKL_WEB_SESSION_SECRET")
        }
      : undefined;

  return {
    environment,
    apiClientMode,
    authMode,
    serviceBaseUrls,
    oidc,
    devAccessToken: env.AKL_DEV_ACCESS_TOKEN || undefined
  };
}
