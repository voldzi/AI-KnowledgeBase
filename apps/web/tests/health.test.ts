import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET as health } from "../src/app/api/health/route";
import { GET as ready } from "../src/app/api/ready/route";
import { GET as rootHealth } from "../src/app/health/route";
import { GET as rootReady } from "../src/app/ready/route";
import { evaluateWebReadiness } from "../src/lib/api/readiness";

describe("health endpoints", () => {
  it("returns web frontend health status", async () => {
    const response = health();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "web-frontend");
    assert.equal(body.status, "ok");
    assert.equal(body.version, "dev");
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  });

  it("returns root health status for service baseline compatibility", async () => {
    const response = rootHealth();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "web-frontend");
    assert.equal(body.status, "ok");
    assert.equal(body.version, "dev");
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  });

  it("returns readiness status from configuration", async () => {
    const response = await ready();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "web-frontend");
    assert.equal(body.status, "ready");
    assert.equal(body.dependencies.registry, "mock");
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  });

  it("returns root readiness status for service baseline compatibility", async () => {
    const response = await rootReady();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "web-frontend");
    assert.equal(body.status, "ready");
    assert.equal(body.dependencies.registry, "mock");
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  });

  it("keeps the web ready when an external Director Copilot source is degraded", () => {
    const result = evaluateWebReadiness({
      dependencies: {
        registry: "ready",
        ingestion: "ready",
        rag: "ready",
        governance: "ready",
        evaluation: "ready",
      },
      directorCopilotV2: "degraded",
      documentIntake: "ready",
    });

    assert.equal(result.ready, true);
    assert.deepEqual(result.degradedDependencies, ["director_copilot_v2"]);
  });

  it("fails readiness when a required internal dependency is unavailable", () => {
    const result = evaluateWebReadiness({
      dependencies: {
        registry: "ready",
        ingestion: "ready",
        rag: "not_ready",
        governance: "ready",
        evaluation: "ready",
      },
      directorCopilotV2: "ready",
      documentIntake: "ready",
    });

    assert.equal(result.ready, false);
    assert.deepEqual(result.degradedDependencies, []);
  });
});
