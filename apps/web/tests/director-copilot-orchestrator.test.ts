import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { stableSha256, type DomainToolRequest, type DomainToolResponse } from "../src/lib/director-copilot/contracts";
import { directorCopilotPromptEvidence, finalizeDirectorSnapshot, orchestrateDirectorCopilot } from "../src/lib/director-copilot/orchestrator";
import { isDirectorCopilotRiskQuery } from "../src/lib/director-copilot/planner";
import type { ApiRequestContext } from "../src/lib/types";

const budgetFixture = fixture("budget-complete.json");
const projectFixture = fixture("projectflow-complete.json");

describe("Director Copilot orchestrator", () => {
  it("builds a reproducible snapshot from parallel Budget and ProjectFlow evidence", async () => {
    const calls: DomainToolRequest[] = [];
    const result = await orchestrateDirectorCopilot({
      message: "Které projekty mají rozpočtovou odchylku, zpožděný milník a smluvní riziko?",
      language: "cs",
      context: projectedContext(),
      now: new Date("2026-07-21T10:00:00Z"),
      client: {
        execute: async (application, request) => {
          calls.push(request);
          const source = structuredClone(application === "budget" ? budgetFixture : projectFixture);
          return { ...source, tool_call_id: request.tool_call_id };
        },
      },
    });

    assert.equal(result.status, "complete");
    assert.equal(calls.length, 2);
    assert.equal(result.plan.nodes.length, 3);
    assert.equal(result.snapshot?.evidence.length, 8);
    assert.deepEqual(result.snapshot?.document_context_tags, ["contract:contract-001", "project:project-001"]);
    assert.deepEqual(result.snapshot?.document_context_bindings, [{
      canonical_id: "stratos:project:project-001",
      tags: ["project:project-001", "contract:contract-001"],
    }]);
    assert.match(result.snapshot?.snapshot_hash ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.snapshot?.strictest_policy.audience_mode, "all_source_policies_required");
    assert.equal(JSON.stringify(result.snapshot).includes("actor-token"), false);
    assert.equal(directorCopilotPromptEvidence(result.snapshot!).evidence instanceof Array, true);
  });

  it("keeps every source audience requirement when labels differ", async () => {
    const budget = structuredClone(budgetFixture);
    const projectflow = structuredClone(projectFixture);
    budget.items[0]!.policy.audience = ["budget_scope:finance"];
    projectflow.items[0]!.policy.audience = ["project:project-001"];
    const result = await orchestrateDirectorCopilot({
      message: "Rozpočet, zpožděný projekt a smluvní riziko",
      language: "cs",
      context: projectedContext(),
      now: new Date("2026-07-21T10:00:00Z"),
      client: {
        execute: async (application, request) => ({
          ...(application === "budget" ? budget : projectflow),
          tool_call_id: request.tool_call_id,
        }),
      },
    });

    assert.equal(result.status, "complete");
    assert.deepEqual(result.snapshot?.strictest_policy.audience, [
      "budget_scope:finance",
      "project:project-001",
    ]);
  });

  it("rejects a governed document citation that is tagged for another project", async () => {
    const result = await orchestrateDirectorCopilot({
      message: "Rozpočet, zpožděný projekt a smluvní riziko",
      language: "cs",
      context: projectedContext(),
      now: new Date("2026-07-21T10:00:00Z"),
      client: {
        execute: async (application, request) => ({
          ...(application === "budget" ? budgetFixture : projectFixture),
          tool_call_id: request.tool_call_id,
        }),
      },
    });
    const policySummary = {
      policyBindingId: "pol_contract_document01",
      policyVersion: "information-policy-2.0.0" as const,
      handlingClass: "INTERNAL" as const,
      legalClassification: "NONE" as const,
      tlp: null,
      pap: null,
      obligations: ["AUDIT_ACCESS"],
      contentCategories: ["CONTRACTUAL"],
      audience: {
        organizationId: "org_stratos" as const,
        scopeType: "organization" as const,
        scopeIds: [],
        recipientSubjectIds: [],
      },
    };

    const finalized = finalizeDirectorSnapshot(result.snapshot!, [{
      document_id: "doc-contract-001",
      document_version_id: "ver-contract-001",
      document_title: "Smlouva projektu",
      version_label: "1.0",
      document_version: "1.0",
      section_path: ["Rizika"],
      page_number: 7,
      chunk_id: "chunk-contract-001",
      policy_binding_id: policySummary.policyBindingId,
      policy_version: policySummary.policyVersion,
      policy_hash: `sha256:${"b".repeat(64)}`,
      policy_summary: policySummary,
      policy_summary_hash: stableSha256(policySummary),
      document_context_tags: ["project:project-999"],
    }]);

    assert.equal(finalized.acceptedChunkIds.size, 0);
    assert.equal(finalized.snapshot.evidence.some((item) => item.type === "document_finding"), false);
    assert.deepEqual(finalized.warnings, ["DIRECTOR_COPILOT_DOCUMENT_SCOPE_MISMATCH"]);
  });

  it("rejects a citation whose summary hash does not match its policy summary", async () => {
    const result = await orchestrateDirectorCopilot({
      message: "Rozpočet, zpožděný projekt a smluvní riziko",
      language: "cs",
      context: projectedContext(),
      now: new Date("2026-07-21T10:00:00Z"),
      client: {
        execute: async (application, request) => ({
          ...(application === "budget" ? budgetFixture : projectFixture),
          tool_call_id: request.tool_call_id,
        }),
      },
    });
    const policySummary = {
      policyBindingId: "pol_contract_document01",
      policyVersion: "information-policy-2.0.0" as const,
      handlingClass: "INTERNAL" as const,
      legalClassification: "NONE" as const,
      tlp: null,
      pap: null,
      obligations: ["AUDIT_ACCESS"],
      contentCategories: ["CONTRACTUAL"],
      audience: {
        organizationId: "org_stratos" as const,
        scopeType: "organization" as const,
        scopeIds: [],
        recipientSubjectIds: [],
      },
    };

    const finalized = finalizeDirectorSnapshot(result.snapshot!, [{
      document_id: "doc-contract-001",
      document_version_id: "ver-contract-001",
      document_title: "Smlouva projektu",
      version_label: "1.0",
      document_version: "1.0",
      section_path: ["Rizika"],
      page_number: 7,
      chunk_id: "chunk-contract-001",
      policy_binding_id: policySummary.policyBindingId,
      policy_version: policySummary.policyVersion,
      policy_hash: `sha256:${"b".repeat(64)}`,
      policy_summary: policySummary,
      policy_summary_hash: `sha256:${"f".repeat(64)}`,
      document_context_tags: ["contract:contract-001"],
    }]);

    assert.equal(finalized.acceptedChunkIds.size, 0);
    assert.deepEqual(finalized.warnings, ["DIRECTOR_COPILOT_DOCUMENT_POLICY_MISSING"]);
  });

  it("does not call a source when projected capabilities or scopes are missing", async () => {
    let calls = 0;
    const result = await orchestrateDirectorCopilot({
      message: "Rozpočet, zpožděný projekt a smluvní riziko",
      language: "cs",
      context: { ...projectedContext(), applicationAccess: [] },
      client: {
        execute: async () => {
          calls += 1;
          throw new Error("must not execute");
        },
      },
    });

    assert.equal(calls, 0);
    assert.equal(result.status, "not_authorized");
    assert.equal(result.snapshot, null);
    assert.deepEqual(result.warnings, ["ACCESS_APPLICATION_INACTIVE"]);
  });

  it("recognizes only questions containing finance, delivery and contract signals", () => {
    assert.equal(isDirectorCopilotRiskQuery("Které projekty mají rozpočtovou odchylku, zpožděný milník a smluvní riziko?"), true);
    assert.equal(isDirectorCopilotRiskQuery("Kdo schvaluje tuto smlouvu?"), false);
  });
});

function fixture(name: string): DomainToolResponse {
  return JSON.parse(readFileSync(
    new URL(`../../../contracts/director-copilot/v1/fixtures/${name}`, import.meta.url),
    "utf8",
  )) as DomainToolResponse;
}

function projectedContext(): ApiRequestContext {
  return {
    subjectId: "user-001",
    organizationId: "org_stratos",
    authorizationSource: "stratos_projection",
    accessToken: "actor-token",
    requestId: "request-001",
    correlationId: "correlation-001",
    identityActive: true,
    membershipActive: true,
    applicationAccessActive: true,
    capabilities: ["akb:chat"],
    scopes: ["project:project-001"],
    applicationAccess: [{
      application: "akb",
      capabilities: ["akb:chat"],
      scopes: ["project:project-001"],
    }, {
      application: "budget",
      capabilities: ["budget:read"],
      scopes: ["project:project-001"],
    }, {
      application: "projectflow",
      capabilities: ["projectflow:read"],
      scopes: ["project:project-001"],
    }],
  };
}
