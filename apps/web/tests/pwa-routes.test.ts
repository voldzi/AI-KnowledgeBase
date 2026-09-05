import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { GET as getManifest } from "../src/app/manifest.webmanifest/route";
import { GET as getServiceWorker } from "../src/app/sw.js/route";

const originalProfile = process.env.AKL_WEB_PROFILE;
const originalVersion = process.env.AKL_SERVICE_VERSION;

afterEach(() => {
  restoreEnv("AKL_WEB_PROFILE", originalProfile);
  restoreEnv("AKL_SERVICE_VERSION", originalVersion);
});

describe("AKB Chat PWA routes", () => {
  it("serves a non-cacheable, installable manifest only in the chat profile", async () => {
    process.env.AKL_WEB_PROFILE = "chat";

    const response = getManifest();
    const manifest = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(
      response.headers.get("content-type"),
      "application/manifest+json; charset=utf-8",
    );
    assert.equal(manifest.name, "AKB Chat");
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.scope, "/");
    assert.equal(manifest.display, "standalone");
    assert.ok(manifest.theme_color);
    assert.ok(manifest.background_color);
    assert.deepEqual(
      manifest.icons.map((icon: { sizes: string; purpose: string }) => [
        icon.sizes,
        icon.purpose,
      ]),
      [
        ["192x192", "any"],
        ["512x512", "any"],
        ["512x512", "maskable"],
      ],
    );

    process.env.AKL_WEB_PROFILE = "platform";
    assert.equal(getManifest().status, 404);
  });

  it("serves a release-versioned, non-cacheable worker only in the chat profile", async () => {
    process.env.AKL_WEB_PROFILE = "chat";
    process.env.AKL_SERVICE_VERSION = "0123456789abcdef";

    const response = getServiceWorker();
    const worker = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.get("service-worker-allowed"), "/");
    assert.equal(
      response.headers.get("content-type"),
      "application/javascript; charset=utf-8",
    );
    assert.match(worker, /akb-chat-static-/);
    assert.match(worker, /0123456789abcdef/);
    assert.doesNotMatch(worker, /indexedDB|localStorage/);

    process.env.AKL_WEB_PROFILE = "platform";
    assert.equal(getServiceWorker().status, 404);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
