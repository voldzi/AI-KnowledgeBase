import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { accessProjectionHash, domainAccessFor } from "../src/lib/director-copilot/access";
import type { ApiRequestContext } from "../src/lib/types";

describe("Director Copilot projected access", () => {
  it("uses only effective per-application capabilities and scopes", () => {
    const context = projectedContext();
    const access = domainAccessFor(context, "budget", Date.parse("2026-07-21T10:00:00Z"));

    assert.equal(access.authorized, true);
    assert.deepEqual(access.scopes, [{ type: "project", id: "project-001" }]);
  });

  it("fails closed for mock projection, missing capability and expired access", () => {
    assert.equal(domainAccessFor({ ...projectedContext(), authorizationSource: "mock" }, "budget").authorized, false);
    assert.equal(domainAccessFor({
      ...projectedContext(),
      applicationAccess: [{ application: "budget", capabilities: [], scopes: ["project:project-001"] }],
    }, "budget").reason, "capability_missing");
    assert.equal(domainAccessFor({
      ...projectedContext(),
      applicationAccess: [{
        application: "budget",
        capabilities: ["budget:read"],
        scopes: ["project:project-001"],
        validUntil: "2026-07-20T00:00:00Z",
      }],
    }, "budget", Date.parse("2026-07-21T10:00:00Z")).reason, "application_inactive");
  });

  it("fails closed outside the single STRATOS organization or after identity revocation", () => {
    const outsideOrganization = projectedContext();
    outsideOrganization.organizationId = "org_other";
    assert.equal(domainAccessFor(outsideOrganization, "budget").reason, "organization_invalid");

    const revoked = projectedContext();
    revoked.identityActive = false;
    assert.equal(domainAccessFor(revoked, "budget").reason, "application_inactive");
  });

  it("hashes the projection without depending on the bearer token", () => {
    const first = accessProjectionHash({ ...projectedContext(), accessToken: "secret-one" });
    const second = accessProjectionHash({ ...projectedContext(), accessToken: "secret-two" });

    assert.equal(first, second);
    assert.equal(first.includes("secret"), false);
  });
});

function projectedContext(): ApiRequestContext {
  return {
    subjectId: "user-001",
    organizationId: "org_stratos",
    authorizationSource: "stratos_projection",
    identityActive: true,
    membershipActive: true,
    applicationAccessActive: true,
    applicationAccess: [{
      application: "budget",
      capabilities: ["budget:read"],
      scopes: ["project:project-001"],
      validUntil: "2026-07-22T00:00:00Z",
    }],
  };
}
