import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  equalAiipGovernanceConfirmation,
  parseAiipGovernanceConfirmation,
} from "../src/lib/stratos/aiip-governance";
import { ApiClientError } from "../src/lib/types";

describe("AIIP governance confirmation", () => {
  it("compares the complete JSON lineage independent of object key order", () => {
    const confirmation = {
      parent_source_resource: {
        governed_resource_id: "source-1",
        scope: { type: "own", ownerSubjectId: "subject-1" }
      },
      governed_resource: {
        id: "version-1",
        effective_policy: { policy_hash: `sha256:${"a".repeat(64)}` }
      },
      actor_subject_id: "subject-1"
    };

    assert.equal(
      equalAiipGovernanceConfirmation(
        confirmation,
        {
          actor_subject_id: "subject-1",
          governed_resource: {
            effective_policy: { policy_hash: `sha256:${"a".repeat(64)}` },
            id: "version-1"
          },
          parent_source_resource: {
            scope: { ownerSubjectId: "subject-1", type: "own" },
            governed_resource_id: "source-1"
          }
        }
      ),
      true
    );
  });

  it("rejects any changed lineage coordinate or non-JSON value", () => {
    assert.equal(
      equalAiipGovernanceConfirmation(
        { governed_resource: { id: "version-1" }, actor_subject_id: "subject-1" },
        { governed_resource: { id: "version-2" }, actor_subject_id: "subject-1" }
      ),
      false
    );
    assert.equal(equalAiipGovernanceConfirmation({ value: undefined }, { value: null }), false);
  });

  it("parses only the exact Registry governance confirmation schema", () => {
    const confirmation = validConfirmation();
    assert.equal(
      parseAiipGovernanceConfirmation(confirmation).governed_resource.resource_id,
      "doc-1",
    );
    assert.throws(
      () => parseAiipGovernanceConfirmation({ ...confirmation, metadata: {} }),
      (error: unknown) =>
        error instanceof ApiClientError &&
        error.status === 502 &&
        error.code === "AIIP_GOVERNANCE_CONFIRMATION_INVALID",
    );
  });

  it("normalizes Registry scopes with null mutually exclusive coordinates", () => {
    const confirmation = validConfirmation();
    const registryScope = { type: "own", id: null, ownerSubjectId: "subject-1" };
    confirmation.parent_source_resource.scope = registryScope;
    confirmation.governed_resource.scope = registryScope;

    const parsed = parseAiipGovernanceConfirmation(confirmation);
    assert.deepEqual(parsed.parent_source_resource.scope, {
      type: "own",
      ownerSubjectId: "subject-1",
    });
    assert.deepEqual(parsed.governed_resource.scope, {
      type: "own",
      ownerSubjectId: "subject-1",
    });
    assert.throws(() => parseAiipGovernanceConfirmation({
      ...confirmation,
      governed_resource: {
        ...confirmation.governed_resource,
        scope: { ...registryScope, id: "scope-forbidden" },
      },
    }));
  });
});

function validConfirmation() {
  const scope = { type: "own", ownerSubjectId: "subject-1" };
  return {
    parent_source_resource: {
      governed_resource_id: "gres-source-1",
      application: "AIIP",
      resource_type: "idea",
      resource_id: "idea-1",
      source_version: "idea-version-1",
      scope,
    },
    governed_resource: {
      id: "gres-document-1",
      application: "AKB",
      resource_type: "document",
      resource_id: "doc-1",
      source_version: "idea-version-1",
      parent_id: "gres-source-1",
      scope,
      policy_assignment: "INHERITED",
      explicit_policy_binding_id: null,
      inherited_from_resource_id: "gres-source-1",
      effective_policy: {
        policy_binding_id: "pb_aiip_upload_12345678",
        policy_version: "information-policy-2.0.0",
        policy_hash: `sha256:${"a".repeat(64)}`,
        originator_id: "subject-1",
        issued_at: "2026-07-14T00:00:00.000Z",
        review_at: null,
      },
      registered_by_subject_id: "subject-1",
      confirmed_by_subject_id: "subject-1",
    },
    document_policy_binding_id: "pb_aiip_upload_12345678",
    document_policy_version: "information-policy-2.0.0",
    document_policy_hash: `sha256:${"a".repeat(64)}`,
    actor_subject_id: "subject-1",
    correlation_id: "corr-12345678",
    idempotency_key: "idem-12345678",
  };
}
