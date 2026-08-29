import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AKB_SHADOW_SURFACES, evaluateShadowProjectionV2, type ShadowResourceDecisionInput } from "../src/lib/auth/access-projection-v2-shadow";

const NOW = Date.parse("2026-08-29T10:05:00Z");

describe("STRATOS access projection V2 shadow consumer", () => {
  for (const surface of AKB_SHADOW_SURFACES) {
    it(`uses one capability-bound entitlement for ${surface}`, () => {
      assert.deepEqual(evaluateShadowProjectionV2(projection(), resource(surface), NOW), {
        allowed: true, reason: "single-entitlement-match", entitlementId: "ent_read",
      });
    });
  }

  it("rejects cartesian capability/scope union across entitlements", () => {
    const body = projection();
    body.applicationAccess[0]!.entitlements = [
      { ...body.applicationAccess[0]!.entitlements[0]!, entitlementId: "cap_only", effectiveScopes: [{ type: "document", id: "other" }] },
      { ...body.applicationAccess[0]!.entitlements[0]!, entitlementId: "scope_only", capabilities: ["akb:chat"] },
    ];
    assert.equal(evaluateShadowProjectionV2(body, resource("download"), NOW).allowed, false);
  });

  const negatives: Array<[string, (body: ReturnType<typeof projection>, input: ShadowResourceDecisionInput) => void]> = [
    ["schema drift", (body) => { body.schemaVersion = "stratos-access-projection-1"; }],
    ["catalog drift", (body) => { body.catalogVersion = "capabilities-1.11.0"; }],
    ["unknown field", (body) => { Object.assign(body, { unexpected: true }); }],
    ["expired projection", (body) => { body.expiresAt = "2026-08-29T10:00:00Z"; }],
    ["inactive identity", (body) => { body.identity.active = false; }],
    ["inactive membership", (body) => { body.membership.active = false; }],
    ["expired entitlement", (body) => { (body.applicationAccess[0]!.entitlements[0]! as { validUntil: string | null }).validUntil = "2026-08-29T10:00:00Z"; }],
    ["draft", (_body, input) => { input.draft = true; }],
    ["unpublished", (_body, input) => { input.published = false; }],
    ["foreign organization", (_body, input) => { input.organizationId = "org_other"; }],
    ["narrow audience", (_body, input) => { input.audienceAllowed = false; }],
    ["explicit denial", (_body, input) => { input.explicitlyDenied = true; }],
    ["restricted", (_body, input) => { input.classification = "restricted"; }],
    ["TLP", (_body, input) => { input.tlp = "AMBER"; }],
    ["PAP", (_body, input) => { input.pap = "RED"; }],
    ["policy denial", (_body, input) => { input.informationPolicyAllowed = false; }],
  ];
  for (const [name, mutate] of negatives) {
    it(`fails closed for ${name}`, () => {
      const body = projection(); const input = resource("registry"); mutate(body, input);
      assert.equal(evaluateShadowProjectionV2(body, input, NOW).allowed, false);
    });
  }

  it("does not accept static claims or an unavailable projection", () => {
    assert.equal(evaluateShadowProjectionV2(undefined, resource("chat"), NOW).allowed, false);
    assert.equal(evaluateShadowProjectionV2({ roles: ["admin"], scopes: ["organization"] }, resource("chat"), NOW).allowed, false);
  });
});

function resource(surface: typeof AKB_SHADOW_SURFACES[number]): ShadowResourceDecisionInput {
  return { surface, capability: "akb:read_document", effectiveScope: { type: "document", id: "doc-1" }, organizationId: "org_stratos", published: true, draft: false, audienceAllowed: true, explicitlyDenied: false, classification: "internal", tlp: "GREEN", pap: "GREEN", informationPolicyAllowed: true };
}

function projection() {
  return {
    schemaVersion: "stratos-access-projection-2", contractRevision: "2.0.0", contractStatus: "shadow",
    contractDigest: "sha256:3b11860c9b79bfb82f7792b93815f49d786667a7dd4b74f5a8ad0cb5dd6620b7",
    catalogVersion: "capabilities-1.12.0", generatedAt: "2026-08-29T10:00:00Z", expiresAt: "2026-08-29T10:10:00Z", organizationId: "org_stratos",
    identity: { subjectId: "subject-1", kind: "person", active: true, employeeEligible: true }, membership: { active: true, validUntil: null },
    applicationAccess: [{ applicationId: "akb", entitlements: [{ entitlementId: "ent_read", definitionVersion: "1", profileId: null, source: "MANUAL", sourceRef: null, virtual: false, capabilities: ["akb:access", "akb:read_document"], scopes: [{ type: "document", id: "doc-1" }], effectiveScopes: [{ type: "document", id: "doc-1" }], validFrom: null, validUntil: null }] }],
  };
}
