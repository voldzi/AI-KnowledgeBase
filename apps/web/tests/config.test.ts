import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAklConfig } from "../src/lib/api/config";

describe("AKL web config", () => {
  it("defaults to safe development mock mode", () => {
    const config = getAklConfig({});

    assert.equal(config.environment, "development");
    assert.equal(config.apiClientMode, "mock");
    assert.equal(config.authMode, "mock");
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
});
