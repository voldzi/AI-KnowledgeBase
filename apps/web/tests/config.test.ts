import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAklConfig } from "../src/lib/api/config";

describe("AKL web config", () => {
  it("defaults to safe development mock mode", () => {
    const config = getAklConfig({});

    assert.equal(config.environment, "development");
    assert.equal(config.apiClientMode, "mock");
    assert.equal(config.authMode, "mock");
    assert.equal(config.webProfile, "platform");
    assert.equal(config.directorCopilot?.enabled, false);
    assert.equal(config.directorCopilot?.clientId, "svc-akb-director-copilot");
  });

  it("rejects mock API clients in production", () => {
    assert.throws(() =>
      getAklConfig({
        AKL_ENV: "production",
        AKL_API_CLIENT_MODE: "mock",
        AKL_AUTH_MODE: "oidc"
      }),
    /Refusing to start production with AKL_API_CLIENT_MODE=mock/);
  });

  it("rejects mock auth in production", () => {
    assert.throws(() =>
      getAklConfig({
        AKL_ENV: "production",
        AKL_API_CLIENT_MODE: "production",
        AKL_AUTH_MODE: "mock",
        AKL_REGISTRY_API_BASE_URL: "https://registry.local/api/v1",
        AKL_INGESTION_API_BASE_URL: "https://ingestion.local/api/v1",
        AKL_RAG_API_BASE_URL: "https://rag.local/api/v1",
        AKL_GOVERNANCE_API_BASE_URL: "https://governance.local/api/v1",
        AKL_EVALUATION_API_BASE_URL: "https://evaluation.local/api/v1"
      }),
    /Refusing to start production with AKL_AUTH_MODE=mock/);
  });

  it("normalizes production base URLs", () => {
    const config = getAklConfig({
      AKL_ENV: "staging",
      AKL_API_CLIENT_MODE: "production",
      AKL_AUTH_MODE: "oidc",
      AKL_REGISTRY_API_BASE_URL: "https://registry.local/api/v1/",
      AKL_INGESTION_API_BASE_URL: "https://ingestion.local/api/v1/",
      AKL_RAG_API_BASE_URL: "https://rag.local/api/v1/",
      AKL_GOVERNANCE_API_BASE_URL: "https://governance.local/api/v1/",
      AKL_EVALUATION_API_BASE_URL: "https://evaluation.local/api/v1/",
      AKL_WEB_OIDC_ISSUER: "https://login.local/realms/stratos/",
      AKL_WEB_PUBLIC_BASE_URL: "https://akl.local/",
      AKL_WEB_SESSION_SECRET: "test-session-secret",
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.local/api/v1/auth/me"
    });

    assert.equal(config.serviceBaseUrls.registry, "https://registry.local/api/v1");
    assert.equal(config.serviceBaseUrls.ingestion, "https://ingestion.local/api/v1");
    assert.equal(config.serviceBaseUrls.rag, "https://rag.local/api/v1");
    assert.equal(config.serviceBaseUrls.governance, "https://governance.local/api/v1");
    assert.equal(config.serviceBaseUrls.evaluation, "https://evaluation.local/api/v1");
    assert.equal(config.oidc?.issuer, "https://login.local/realms/stratos");
    assert.equal(config.oidc?.clientId, "akl-web");
    assert.equal(config.oidc?.redirectUri, "https://akl.local/api/auth/callback");
  });

  it("normalizes quoted OIDC scope values from env files", () => {
    const config = getAklConfig({
      AKL_ENV: "staging",
      AKL_API_CLIENT_MODE: "production",
      AKL_AUTH_MODE: "oidc",
      AKL_REGISTRY_API_BASE_URL: "https://registry.local/api/v1/",
      AKL_INGESTION_API_BASE_URL: "https://ingestion.local/api/v1/",
      AKL_RAG_API_BASE_URL: "https://rag.local/api/v1/",
      AKL_GOVERNANCE_API_BASE_URL: "https://governance.local/api/v1/",
      AKL_EVALUATION_API_BASE_URL: "https://evaluation.local/api/v1/",
      AKL_WEB_OIDC_ISSUER: "https://login.local/realms/stratos/",
      AKL_WEB_PUBLIC_BASE_URL: "https://akl.local/",
      AKL_WEB_OIDC_SCOPES: '"openid   profile email"',
      AKL_WEB_SESSION_SECRET: "test-session-secret",
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.local/api/v1/auth/me"
    });

    assert.equal(config.oidc?.scopes, "openid profile email");
  });

  it("requires web OIDC settings when OIDC auth is enabled", () => {
    assert.throws(() =>
      getAklConfig({
        AKL_ENV: "staging",
        AKL_API_CLIENT_MODE: "mock",
        AKL_AUTH_MODE: "oidc"
      }),
    /AKL_WEB_OIDC_ISSUER is required when AKL_AUTH_MODE=oidc/);
  });

  it("supports a production chat profile without an ingestion service identity", () => {
    const config = getAklConfig({
      AKL_ENV: "production",
      AKL_API_CLIENT_MODE: "production",
      AKL_AUTH_MODE: "oidc",
      AKL_WEB_PROFILE: "chat",
      AKL_REGISTRY_API_BASE_URL: "http://registry-api:8000/api/v1",
      AKL_INGESTION_API_BASE_URL: "http://ingestion-service:8090/api/v1",
      AKL_RAG_API_BASE_URL: "http://rag-retrieval-service:8080/api/v1",
      AKL_GOVERNANCE_API_BASE_URL: "http://governance-service:8080/api/v1",
      AKL_EVALUATION_API_BASE_URL: "http://evaluation-service:8080/api/v1",
      AKL_WEB_OIDC_ISSUER: "https://login.local/realms/stratos",
      AKL_WEB_OIDC_CLIENT_ID: "akb-chat-web",
      AKL_WEB_PUBLIC_BASE_URL: "https://chat.local",
      AKL_WEB_SESSION_SECRET: "separate-chat-session-secret",
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.local/api/v1/auth/me",
    });

    assert.equal(config.webProfile, "chat");
    assert.equal(config.oidc?.clientId, "akb-chat-web");
    assert.equal(config.oidc?.redirectUri, "https://chat.local/api/auth/callback");
    assert.equal(config.ingestionTransport, undefined);
  });

  it("rejects unknown web profiles", () => {
    assert.throws(
      () => getAklConfig({ AKL_WEB_PROFILE: "legacy-chat" }),
      /Unsupported AKL_WEB_PROFILE value/,
    );
  });

  it("requires the dedicated Director Copilot transport when enabled with OIDC", () => {
    assert.throws(
      () => getAklConfig({
        AKL_ENV: "staging",
        AKL_API_CLIENT_MODE: "mock",
        AKL_AUTH_MODE: "oidc",
        AKL_WEB_OIDC_ISSUER: "https://login.local/realms/stratos",
        AKL_WEB_PUBLIC_BASE_URL: "https://chat.local",
        AKL_WEB_SESSION_SECRET: "test-session-secret",
        AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.local/api/v1/auth/me",
        AKL_DIRECTOR_COPILOT_ENABLED: "true",
      }),
      /AKL_DIRECTOR_COPILOT_TOKEN_URL is required/,
    );
  });

  it("accepts complete Director Copilot configuration", () => {
    const config = getAklConfig({
      AKL_ENV: "staging",
      AKL_API_CLIENT_MODE: "mock",
      AKL_AUTH_MODE: "oidc",
      AKL_WEB_OIDC_ISSUER: "https://login.local/realms/stratos",
      AKL_WEB_PUBLIC_BASE_URL: "https://chat.local",
      AKL_WEB_SESSION_SECRET: "test-session-secret",
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.local/api/v1/auth/me",
      AKL_DIRECTOR_COPILOT_ENABLED: "true",
      AKL_DIRECTOR_COPILOT_TOKEN_URL: "https://login.local/realms/stratos/protocol/openid-connect/token",
      AKL_DIRECTOR_COPILOT_CLIENT_SECRET: "test-only-secret",
      AKL_DIRECTOR_COPILOT_BUDGET_BASE_URL: "http://budget-api:4000",
      AKL_DIRECTOR_COPILOT_PROJECTFLOW_BASE_URL: "http://projectflow-api:3000",
    });

    assert.equal(config.directorCopilot?.enabled, true);
    assert.equal(config.directorCopilot?.budgetBaseUrl, "http://budget-api:4000");
    assert.equal(config.directorCopilot?.projectflowBaseUrl, "http://projectflow-api:3000");
  });

  it("requires a file-backed Director Copilot credential in production", () => {
    assert.throws(() => getAklConfig({
      AKL_ENV: "production",
      AKL_API_CLIENT_MODE: "production",
      AKL_AUTH_MODE: "oidc",
      AKL_WEB_PROFILE: "chat",
      AKL_WEB_OIDC_ISSUER: "https://login.local/realms/stratos",
      AKL_WEB_OIDC_CLIENT_ID: "akb-chat-web",
      AKL_WEB_PUBLIC_BASE_URL: "https://chat.local",
      AKL_WEB_SESSION_SECRET: "test-session-secret",
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.local/api/v1/auth/me",
      AKL_REGISTRY_API_BASE_URL: "http://registry-api:8000/api/v1",
      AKL_INGESTION_API_BASE_URL: "http://ingestion-service:8090/api/v1",
      AKL_RAG_API_BASE_URL: "http://rag-retrieval-service:8080/api/v1",
      AKL_GOVERNANCE_API_BASE_URL: "http://governance-service:8080/api/v1",
      AKL_EVALUATION_API_BASE_URL: "http://evaluation-service:8080/api/v1",
      AKL_DIRECTOR_COPILOT_ENABLED: "true",
      AKL_DIRECTOR_COPILOT_TOKEN_URL: "https://login.local/realms/stratos/protocol/openid-connect/token",
      AKL_DIRECTOR_COPILOT_CLIENT_SECRET: "inline-secret-is-not-production-safe",
      AKL_DIRECTOR_COPILOT_BUDGET_BASE_URL: "http://budget-api:4000",
      AKL_DIRECTOR_COPILOT_PROJECTFLOW_BASE_URL: "http://projectflow-api:3000",
    }), /must use AKL_DIRECTOR_COPILOT_CLIENT_SECRET_FILE/);
  });
});
