import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { AklConfig } from "../src/lib/api/config";
import {
  directorCopilotUnavailableResponse,
  runDirectorCopilotChat,
} from "../src/lib/director-copilot/chat";
import { stableSha256, type AnalysisSnapshot, type DomainToolRequest, type DomainToolResponse } from "../src/lib/director-copilot/contracts";
import type { ApiClients, ApiRequestContext } from "../src/lib/types";

const budgetFixture = fixture("budget-complete.json");
const projectFixture = fixture("projectflow-complete.json");

describe("Director Copilot chat policy enforcement", () => {
  it("answers a ProjectFlow-only portfolio question from live structured data without RAG", async () => {
    const originalFetch = globalThis.fetch;
    let ragCalls = 0;
    let auditCalls = 0;
    let auditContext: ApiRequestContext | undefined;
    let auditPayload: unknown;
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as DomainToolRequest;
      return Response.json({
        ...structuredClone(projectFixture),
        tool_call_id: request.tool_call_id,
      });
    };
    try {
      const response = await runDirectorCopilotChat({
        message: "Jaký je stav projektů?",
        conversationId: null,
        responseLanguage: "cs",
        intent: "project_portfolio_status",
        actorContext: context(),
        clients: {
          rag: {
            assistantChat: async () => {
              ragCalls += 1;
              throw new Error("ProjectFlow-only status must not use document RAG");
            },
          },
          registry: {
            createAuditEvent: async (payload: unknown, context: ApiRequestContext) => {
              auditCalls += 1;
              auditContext = context;
              auditPayload = payload;
              return {};
            },
          },
        } as unknown as ApiClients,
        config: config(),
      });

      assert.equal(ragCalls, 0);
      assert.equal(auditCalls, 1);
      assert.equal(auditContext?.subjectId, "svc-akb-director-copilot");
      assert.equal(auditContext?.serviceClientId, "svc-akb-director-copilot");
      assert.equal(auditContext?.accessToken, "mock-director-copilot-service-token");
      assert.deepEqual(auditContext?.capabilities, []);
      assert.deepEqual(auditContext?.scopes, []);
      assert.match(JSON.stringify(auditPayload), /"returned_item_count":1/);
      assert.match(JSON.stringify(auditPayload), /projectflow:read/);
      assert.match(JSON.stringify(auditPayload), /project/);
      assert.equal(response.response_type, "answer");
      assert.equal(response.current_context.answer_source, "director_copilot_projectflow");
      assert.match(response.answer ?? "", /ProjectFlow v aktuálně oprávněném rozsahu/);
      assert.match(response.answer ?? "", /project-001/);
      assert.match(response.answer ?? "", /28 dní/);
      assert.equal(response.citations.length, 0);
      assert.equal(response.warnings.includes("DIRECTOR_COPILOT_PROJECTFLOW_LIVE_DATA"), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not fall back to documents when ProjectFlow access is missing", async () => {
    let ragCalls = 0;
    const response = await runDirectorCopilotChat({
      message: "Jaký je stav projektů?",
      conversationId: null,
      responseLanguage: "cs",
      intent: "project_portfolio_status",
      actorContext: {
        ...context(),
        applicationAccess: context().applicationAccess?.filter(
          (access) => access.application !== "projectflow",
        ),
      },
      clients: {
        rag: {
          assistantChat: async () => {
            ragCalls += 1;
            throw new Error("Unauthorized live-data questions must not use RAG");
          },
        },
        registry: {
          createAuditEvent: async () => ({}),
        },
      } as unknown as ApiClients,
      config: {
        ...config(),
        directorCopilot: {
          ...config().directorCopilot!,
        },
      },
    });

    assert.equal(ragCalls, 0);
    assert.equal(response.response_type, "restricted");
    assert.match(response.answer ?? "", /Nemáte oprávnění pro vstup do ProjectFlow/);
    assert.equal(response.citations.length, 0);
  });

  it("does not invent a local-membership denial for an organization-wide grant", async () => {
    const originalFetch = globalThis.fetch;
    let ragCalls = 0;
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as DomainToolRequest;
      return Response.json({
        ...structuredClone(projectFixture),
        tool_call_id: request.tool_call_id,
        status: "not_authorized",
        items: [],
        warnings: [],
      });
    };
    try {
      const actorContext = context();
      actorContext.applicationAccess = actorContext.applicationAccess?.map((access) => (
        access.application === "projectflow"
          ? {
              ...access,
              scopes: ["organization:org_stratos"],
              effectiveScopes: ["organization:org_stratos", "project:project-001"],
            }
          : access
      ));

      const response = await runDirectorCopilotChat({
        message: "Jaký je stav projektů?",
        conversationId: null,
        responseLanguage: "cs",
        intent: "project_portfolio_status",
        actorContext,
        clients: {
          rag: {
            assistantChat: async () => {
              ragCalls += 1;
              throw new Error("Denied live-data questions must not use RAG");
            },
          },
          registry: {
            createAuditEvent: async () => ({}),
          },
        } as unknown as ApiClients,
        config: config(),
      });

      assert.equal(ragCalls, 0);
      assert.equal(response.response_type, "restricted");
      assert.match(response.answer ?? "", /neposkytl konkrétní důvod odmítnutí/);
      assert.equal((response.answer ?? "").includes("lokální projektové členství"), false);
      assert.equal(
        response.warnings.includes("PROJECTFLOW_BROAD_SCOPE_UPSTREAM_DENIED_WITHOUT_REASON"),
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns an explicit live-source state when the feature is disabled", () => {
    const response = directorCopilotUnavailableResponse({
      conversationId: null,
      language: "cs",
      intent: "project_portfolio_status",
    });

    assert.equal(response.response_type, "no_answer");
    assert.match(response.answer ?? "", /nenahradilo historickými dokumenty/);
    assert.equal(response.warnings.includes("LIVE_DATA_FALLBACK_BLOCKED"), true);
  });

  it("adds governed AKB citations to the final tamper-evident snapshot", async () => {
    const originalFetch = globalThis.fetch;
    let auditPayload: unknown;
    globalThis.fetch = async (input, init) => {
      const request = JSON.parse(String(init?.body)) as DomainToolRequest;
      const source = structuredClone(String(input).includes("budget") ? budgetFixture : projectFixture);
      source.tool_call_id = request.tool_call_id;
      return Response.json(source);
    };
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
    try {
      const response = await runDirectorCopilotChat({
        message: "Které projekty mají rozpočtovou odchylku, zpožděný milník a smluvní riziko?",
        conversationId: null,
        responseLanguage: "cs",
        actorContext: context(),
        clients: {
          rag: {
            assistantChat: async () => ({
              response_type: "answer",
              conversation_id: "conv-director",
              answer: "Smlouva uvádí riziko prodlení [1].",
              message: null,
              questions: [],
              why_needed: null,
              current_context: {},
              citations: [{
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
                policy_hash: `sha256:${"a".repeat(64)}`,
                policy_summary: policySummary,
                policy_summary_hash: stableSha256(policySummary),
                document_context_tags: ["contract:contract-001"],
              }],
              follow_up_questions: [],
              suggested_actions: [],
              report_artifacts: [],
              confidence: "high",
              warnings: [],
              missing_information: null,
              recommended_action: null,
            }),
          },
          registry: {
            createAuditEvent: async (payload: unknown) => {
              auditPayload = payload;
              return {};
            },
          },
        } as unknown as ApiClients,
        config: config(),
      });

      assert.equal(response.citations.length, 1);
      const snapshot = response.current_context.director_copilot_snapshot as AnalysisSnapshot;
      assert.equal(snapshot.evidence.some((item) => item.type === "document_finding"), true);
      assert.equal(snapshot.evidence.find((item) => item.type === "document_finding")?.canonical_id, "stratos:project:project-001");
      assert.equal(snapshot.strictest_policy.source_policies.some((item) => item.source_system === "STRATOS_AKB"), true);
      assert.equal(response.warnings.includes("DIRECTOR_COPILOT_DOCUMENT_POLICY_MISSING"), false);
      assert.match(JSON.stringify(auditPayload), /pol_contract_document01/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns structured facts without calling RAG when AI processing is prohibited", async () => {
    const originalFetch = globalThis.fetch;
    let ragCalls = 0;
    let auditCalls = 0;
    let auditPayload: unknown;
    globalThis.fetch = async (input, init) => {
      const request = JSON.parse(String(init?.body)) as DomainToolRequest;
      const source = structuredClone(String(input).includes("budget") ? budgetFixture : projectFixture);
      source.tool_call_id = request.tool_call_id;
      if (source.source_system === "STRATOS_BUDGET") {
        source.items[0]!.policy.obligations = ["NO_EXTERNAL_AI"];
      }
      return Response.json(source);
    };
    try {
      const response = await runDirectorCopilotChat({
        message: "Které projekty mají rozpočtovou odchylku, zpožděný milník a smluvní riziko?",
        conversationId: null,
        responseLanguage: "cs",
        actorContext: context(),
        clients: {
          rag: {
            assistantChat: async () => {
              ragCalls += 1;
              throw new Error("RAG must not receive policy-blocked evidence");
            },
          },
          registry: {
            createAuditEvent: async (payload: unknown) => {
              auditCalls += 1;
              auditPayload = payload;
              return {};
            },
          },
        } as unknown as ApiClients,
        config: config(),
      });

      assert.equal(ragCalls, 0);
      assert.equal(auditCalls, 1);
      assert.equal(response.warnings.includes("DIRECTOR_COPILOT_AI_POLICY_BLOCKED"), true);
      assert.equal(response.warnings.includes("DIRECTOR_COPILOT_DOCUMENT_EVIDENCE_MISSING"), false);
      assert.match(response.answer ?? "", /Rozpočtová odchylka/);
      assert.match(response.answer ?? "", /Dokumentová analýza nebyla spuštěna/);
      const serializedAudit = JSON.stringify(auditPayload);
      assert.equal(serializedAudit.includes("actor-token"), false);
      assert.equal(serializedAudit.includes("1250000"), false);
      assert.match(serializedAudit, /budget\.project_financial_snapshot\.v1/);
      assert.match(serializedAudit, /pb_budget_director_12345678/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed when the governed result cannot be audited", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const request = JSON.parse(String(init?.body)) as DomainToolRequest;
      const source = structuredClone(String(input).includes("budget") ? budgetFixture : projectFixture);
      source.tool_call_id = request.tool_call_id;
      source.items[0]!.policy.obligations = ["AUDIT_ACCESS", "NO_EXTERNAL_AI"];
      return Response.json(source);
    };
    try {
      await assert.rejects(() => runDirectorCopilotChat({
        message: "Které projekty mají rozpočtovou odchylku, zpožděný milník a smluvní riziko?",
        conversationId: null,
        responseLanguage: "cs",
        actorContext: context(),
        clients: {
          rag: {
            assistantChat: async () => {
              throw new Error("RAG must not receive policy-blocked evidence");
            },
          },
          registry: {
            createAuditEvent: async () => {
              throw new Error("audit unavailable");
            },
          },
        } as unknown as ApiClients,
        config: config(),
      }), /audit unavailable/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("revalidates the STRATOS projection and fails closed before synthesis", async () => {
    const originalFetch = globalThis.fetch;
    let ragCalls = 0;
    globalThis.fetch = async (input, init) => {
      const request = JSON.parse(String(init?.body)) as DomainToolRequest;
      const source = structuredClone(String(input).includes("budget") ? budgetFixture : projectFixture);
      source.tool_call_id = request.tool_call_id;
      return Response.json(source);
    };
    try {
      const response = await runDirectorCopilotChat({
        message: "Které projekty mají rozpočtovou odchylku, zpožděný milník a smluvní riziko?",
        conversationId: null,
        responseLanguage: "cs",
        actorContext: context(),
        refreshActorContext: async () => ({
          ...context(),
          applicationAccess: context().applicationAccess?.filter((access) => access.application !== "projectflow"),
        }),
        clients: {
          rag: {
            assistantChat: async () => {
              ragCalls += 1;
              throw new Error("RAG must not receive evidence after access revocation");
            },
          },
          registry: { createAuditEvent: async () => ({}) },
        } as unknown as ApiClients,
        config: config(),
      });

      assert.equal(ragCalls, 0);
      assert.equal(response.response_type, "restricted");
      assert.equal(response.warnings.includes("ACCESS_PROJECTION_CHANGED_BEFORE_SYNTHESIS"), true);
      assert.equal(JSON.stringify(response.current_context).includes("director_copilot_snapshot"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function fixture(name: string): DomainToolResponse {
  return JSON.parse(readFileSync(
    new URL(`../../../contracts/director-copilot/v1/fixtures/${name}`, import.meta.url),
    "utf8",
  )) as DomainToolResponse;
}

function config(): AklConfig {
  return {
    environment: "test",
    apiClientMode: "mock",
    authMode: "mock",
    serviceBaseUrls: {
      registry: "mock://registry",
      ingestion: "mock://ingestion",
      rag: "mock://rag",
      governance: "mock://governance",
      evaluation: "mock://evaluation",
    },
    directorCopilot: {
      enabled: true,
      clientId: "svc-akb-director-copilot",
      budgetBaseUrl: "https://budget.example",
      projectflowBaseUrl: "https://projectflow.example",
      timeoutMs: 1_000,
      maxResponseBytes: 262_144,
    },
  };
}

function context(): ApiRequestContext {
  return {
    subjectId: "user-001",
    organizationId: "org_stratos",
    authorizationSource: "stratos_projection",
    accessToken: "actor-token",
    requestId: "request-001",
    correlationId: "correlation-001",
    capabilities: ["akb:chat"],
    scopes: ["project:project-001"],
    applicationAccess: [{
      application: "budget",
      capabilities: ["budget:read"],
      scopes: ["project:project-001"],
      effectiveScopes: ["project:project-001"],
    }, {
      application: "projectflow",
      capabilities: ["projectflow:access", "projectflow:read"],
      scopes: ["project:project-001"],
      effectiveScopes: ["project:project-001"],
    }],
  };
}
