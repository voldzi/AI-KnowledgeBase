import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAklConfig } from "../src/lib/api/config";
import { ISSUER, managedEnv } from "./helpers/managed-identity";

describe("managed identity configuration", () => {
  it("keeps the external provider by default and discards old secrets only in managed mode", () => {
    const legacy = getAklConfig({ ...managedEnv(), AKL_IDENTITY_MODE: undefined, AKL_WEB_OIDC_CLIENT_SECRET: "synthetic-legacy" });
    assert.equal(legacy.oidc?.identityMode, "external_oidc");
    assert.equal(legacy.oidc?.clientSecret, "synthetic-legacy");
    const managed = getAklConfig({ ...managedEnv(), AKL_WEB_OIDC_CLIENT_SECRET: "synthetic-legacy", AKL_DIRECTOR_COPILOT_CLIENT_SECRET: "synthetic-director", AKL_DIRECTOR_COPILOT_TOKEN_URL: "https://legacy.example/token" });
    assert.equal(managed.oidc?.clientSecret, undefined);
    assert.equal(managed.directorCopilot?.tokenUrl, undefined);
    assert.equal(managed.directorCopilot?.clientSecret, undefined);
  });

  it("requires explicit trust, HTTPS, public browser scopes and contract session limits", () => {
    for (const override of [
      { AKL_IDENTITY_MODE: "other" }, { AKL_AUTH_MODE: "mock" },
      { AKL_MANAGED_IDENTITY_ISSUER: "" }, { AKL_MANAGED_IDENTITY_ISSUER: "https://other.example/identity" },
      { AKL_WEB_OIDC_ISSUER: `${ISSUER}/` },
      { AKL_WEB_OIDC_ISSUER: "http://identity.example/identity", AKL_MANAGED_IDENTITY_ISSUER: "http://identity.example/identity" },
      { AKL_WEB_OIDC_CLIENT_ID: "" }, { AKL_WEB_OIDC_SCOPES: "openid profile email admin" },
      { AKL_WEB_STRATOS_AUTH_ME_URL: "http://identity.example/auth/me" },
      { AKL_WEB_PUBLIC_BASE_URL: "https://user:password@akb.example" },
      { AKL_WEB_OIDC_LOGOUT_REDIRECT_URI: "https://akb.example/?redirect=other" },
      { AKL_WEB_STRATOS_ACCESS_CACHE_TTL_MS: "1" }, { AKL_WEB_IDENTITY_VALIDATION_INTERVAL_MINUTES: "16" },
      { AKL_WEB_SESSION_ABSOLUTE_TTL_DAYS: "91" }, { AKL_WEB_SESSION_IDLE_TTL_DAYS: "31" },
    ]) assert.throws(() => getAklConfig({ ...managedEnv(), ...override }));
  });

  it("uses a separate public browser client and callback for Chat", () => {
    const web = getAklConfig(managedEnv());
    const chat = getAklConfig({ ...managedEnv(), AKL_WEB_PROFILE: "chat", AKL_WEB_OIDC_CLIENT_ID: "akb-chat-web", AKL_WEB_PUBLIC_BASE_URL: "https://chat.example" });
    assert.notEqual(web.oidc?.clientId, chat.oidc?.clientId);
    assert.equal(chat.oidc?.redirectUri, "https://chat.example/api/auth/callback");
    assert.equal(web.oidc?.redirectUri, "https://akb.example/akb/api/auth/callback");
  });

  it("requires three distinct Director credentials and does not borrow a legacy credential", () => {
    const env = {
      ...managedEnv(), AKL_DIRECTOR_COPILOT_ENABLED: "true",
      AKL_DIRECTOR_COPILOT_BUDGET_BASE_URL: "https://budget.example",
      AKL_DIRECTOR_COPILOT_PROJECTFLOW_BASE_URL: "https://project.example",
      AKL_DIRECTOR_COPILOT_ARCHFLOW_BASE_URL: "https://arch.example",
      AKL_DIRECTOR_COPILOT_CLIENT_SECRET: "synthetic-legacy",
    };
    assert.throws(() => getAklConfig(env));
    const configured = {
      ...env, AKL_DIRECTOR_COPILOT_BUDGET_CLIENT_SECRET_FILE: "/run/secrets/budget",
      AKL_DIRECTOR_COPILOT_PROJECTFLOW_CLIENT_SECRET_FILE: "/run/secrets/projectflow",
      AKL_DIRECTOR_COPILOT_ARCHFLOW_CLIENT_SECRET_FILE: "/run/secrets/archflow",
    };
    assert.equal(Object.keys(getAklConfig(configured).directorCopilot!.managedClients!).length, 3);
    assert.throws(() => getAklConfig({ ...configured, AKL_DIRECTOR_COPILOT_BUDGET_CLIENT_ID: "same", AKL_DIRECTOR_COPILOT_PROJECTFLOW_CLIENT_ID: "same" }));
  });
});
