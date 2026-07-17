import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createChatServiceWorker } from "../src/lib/pwa/service-worker";

describe("AKB Chat PWA cache policy", () => {
  const worker = createChatServiceWorker({ version: "release/2026.07" });

  it("versions static caches and removes old releases", () => {
    assert.match(worker, /CACHE_PREFIX \+ "release-2026\.07"/);
    assert.match(worker, /caches\.delete/);
  });

  it("uses a safe offline page without caching successful navigations", () => {
    assert.match(worker, /const OFFLINE_URL = "\/offline\.html"/);
    assert.match(worker, /request\.mode === "navigate"/);
    const navigationBlock = worker.slice(
      worker.indexOf('request.mode === "navigate"'),
      worker.indexOf('url.pathname.startsWith("/_next/static/")'),
    );
    assert.doesNotMatch(navigationBlock, /cache\.put/);
  });

  it("keeps APIs, source content and exports network-only", () => {
    assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
    assert.match(worker, /url\.pathname\.includes\("\/source\/"\)/);
    assert.match(worker, /url\.pathname\.includes\("\/export"\)/);
    assert.match(worker, /event\.respondWith\(fetch\(request\)\)/);
    assert.doesNotMatch(worker, /indexedDB|localStorage/);
  });

  it("activates an update only after an explicit user action", () => {
    assert.match(worker, /SKIP_WAITING/);
    assert.doesNotMatch(worker, /install"[\s\S]{0,400}skipWaiting/);
  });
});
