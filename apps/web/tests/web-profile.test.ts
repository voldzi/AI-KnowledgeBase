import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chatProfileRedirectPath,
  isChatProfileApiPath,
  isChatProfilePathAllowed,
} from "../src/lib/web-profile";

describe("AKB chat-only route policy", () => {
  it("allows only the chat shell and its explicit server APIs", () => {
    for (const path of [
      "/",
      "/chat",
      "/chat?thread=abc",
      "/api/auth/login",
      "/api/auth/callback",
      "/api/auth/logout",
      "/api/auth/session",
      "/api/assistant/chat",
      "/api/assistant/conversations/conv-1",
      "/api/assistant/citations/chunk-1/open",
      "/api/assistant/reports/export",
      "/api/v1/profile/settings",
      "/api/health",
      "/api/ready",
      "/manifest.webmanifest",
      "/sw.js",
      "/offline.html",
      "/icons/akb-chat-192.png",
      "/_next/static/chunks/app.js",
    ]) {
      assert.equal(isChatProfilePathAllowed(path), true, path);
    }
  });

  it("rejects management pages and APIs even for a privileged identity", () => {
    for (const path of [
      "/dashboard",
      "/documents",
      "/upload",
      "/ingestion",
      "/tasks",
      "/sources",
      "/audit",
      "/admin",
      "/intelligence",
      "/api/documents",
      "/api/controlled-document/documents",
      "/api/public-sources/sync",
      "/api/auth/role-preview",
    ]) {
      assert.equal(isChatProfilePathAllowed(path), false, path);
    }
  });

  it("keeps legacy assistant links compatible without exposing another surface", () => {
    assert.equal(chatProfileRedirectPath("/chat"), "/");
    assert.equal(chatProfileRedirectPath("/chat/thread"), "/");
    assert.equal(chatProfileRedirectPath("/assistant"), "/");
    assert.equal(chatProfileRedirectPath("/assistant/thread"), "/");
    assert.equal(chatProfileRedirectPath("/admin"), null);
  });

  it("distinguishes API requests for fail-closed JSON responses", () => {
    assert.equal(isChatProfileApiPath("/api/documents"), true);
    assert.equal(isChatProfileApiPath("/documents"), false);
  });
});
