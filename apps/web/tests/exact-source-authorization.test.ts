import assert from "node:assert/strict";
import { test } from "node:test";

import { exactSourceAuthorizationFailure } from "../src/lib/stratos/exact-source-authorization";

const expected = {
  documentId: "doc_1",
  documentVersionId: "ver_1",
  policyBindingId: "pol_12345678",
  policyVersion: "information-policy-2.0.0",
  policyHash: `sha256:${"a".repeat(64)}`
};

test("exact source authorization accepts only the requested immutable coordinates", () => {
  assert.equal(
    exactSourceAuthorizationFailure(
      {
        allowed: true,
        reason: "allowed",
        reason_codes: ["VERSION_AUTHORITY_ALLOW"],
        constraints: {
          document_id: expected.documentId,
          document_version_id: expected.documentVersionId,
          policy_binding_id: expected.policyBindingId,
          policy_version: expected.policyVersion,
          policy_hash: expected.policyHash
        }
      },
      expected
    ),
    null
  );
});

test("exact source authorization preserves permission revocation", () => {
  assert.deepEqual(
    exactSourceAuthorizationFailure(
      { allowed: false, reason: "revoked", reason_codes: ["ACCESS_REVOKED"], constraints: {} },
      expected
    ),
    {
      code: "EXACT_SOURCE_ACCESS_DENIED",
      status: 403,
      message: "Current authority denies access to the exact document version."
    }
  );
});

for (const field of [
  "document_id",
  "document_version_id",
  "policy_binding_id",
  "policy_version",
  "policy_hash"
] as const) {
  test(`exact source authorization rejects stale ${field}`, () => {
    const constraints: Record<string, unknown> = {
      document_id: expected.documentId,
      document_version_id: expected.documentVersionId,
      policy_binding_id: expected.policyBindingId,
      policy_version: expected.policyVersion,
      policy_hash: expected.policyHash
    };
    constraints[field] = "stale";
    assert.equal(
      exactSourceAuthorizationFailure(
        { allowed: true, reason: "allowed", reason_codes: [], constraints },
        expected
      )?.code,
      "EXACT_SOURCE_AUTHORITY_STALE"
    );
  });
}
