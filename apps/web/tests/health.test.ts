import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET as health } from "../src/app/api/health/route";
import { GET as ready } from "../src/app/api/ready/route";
import { GET as rootHealth } from "../src/app/health/route";

describe("health endpoints", () => {
  it("returns web frontend health status", async () => {
    const response = health();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "web-frontend");
    assert.equal(body.status, "ok");
    assert.equal(body.version, "dev");
  });

  it("returns root health status for service baseline compatibility", async () => {
    const response = rootHealth();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "web-frontend");
    assert.equal(body.status, "ok");
    assert.equal(body.version, "dev");
  });

  it("returns readiness status from configuration", async () => {
    const response = ready();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "web-frontend");
    assert.equal(body.status, "ready");
  });
});
