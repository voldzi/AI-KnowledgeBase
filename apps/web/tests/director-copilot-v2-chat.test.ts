import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import type { AklConfig } from "../src/lib/api/config";
import { runDirectorCopilotV2Chat } from "../src/lib/director-copilot-v2/chat";
import {
  pinnedDirectorCopilotV2ManifestBundle,
  type DirectorCopilotV2Item,
  type DirectorCopilotV2Request,
} from "../src/lib/director-copilot-v2/contracts";
import { resetDirectorCopilotV2ManifestCacheForTests } from "../src/lib/director-copilot-v2/manifest-catalog";
import {
  authorizeDirectorCopilotV2History,
  directorCopilotV2PersistenceMetadata,
} from "../src/lib/director-copilot-v2/history";
import { resolveConversationQuery } from "../src/lib/director-copilot/query-state";
import type {
  ApiClients,
  ApiRequestContext,
  AssistantConversationMessage,
} from "../src/lib/types";

const budgetOrganization = fixture("budget-organization-financial-summary.json");
const budgetProject = fixture("budget-project-financial-snapshot.json");
const projectflow = fixture("projectflow-portfolio-delivery-overview.json");
const archflow = fixture("archflow-need-portfolio-overview.json");
const aiip = fixture("aiip-idea-portfolio-overview.json");

describe("Director Copilot V2 active chat", () => {
  afterEach(() => resetDirectorCopilotV2ManifestCacheForTests());

  it("correlates financial and delivery facts by canonical project identity without RAG", async () => {
    const auditEvents: unknown[] = [];
    const auditContexts: ApiRequestContext[] = [];
    let registryDocumentChecks = 0;
    let ragCalls = 0;
    const message = "Které projekty překračují plán a mají zpožděný milník?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2",
      responseLanguage: "cs",
      actorContext: context(),
      clients: {
        rag: {
          assistantChat: async () => {
            ragCalls += 1;
            throw new Error("Director Copilot V2 live data must not use RAG");
          },
        },
        registry: {
          getDocument: async () => {
            registryDocumentChecks += 1;
            throw new Error("fixture document is not authorized");
          },
          createAuditEvent: async (event: unknown, auditContext: ApiRequestContext) => {
            auditEvents.push(event);
            auditContexts.push(auditContext);
            return {};
          },
        },
      } as unknown as ApiClients,
      config: config(),
      intent: "portfolio_performance_overview",
      queryState,
      mode: "active",
      fetcher: fetcher(),
      refreshActorContext: async () => context(),
    });

    assert.equal(response.response_type, "answer");
    assert.equal(response.current_context.answer_source, "director_copilot_v2");
    assert.deepEqual(
      (
        response.current_context.stratos_query_state as {
          entity_filters?: { project_ids?: string[] };
        }
      ).entity_filters?.project_ids,
      ["project-001"],
    );
    assert.match(response.answer ?? "", /Souvislost financí a realizace/);
    assert.match(response.answer ?? "", /Projekt Alfa/);
    assert.match(response.answer ?? "", /14 dní/);
    assert.equal((response.answer ?? "").includes("stratos:project:"), false);
    assert.equal((response.answer ?? "").includes("document-001"), false);
    assert.equal(ragCalls, 0);
    assert.equal(registryDocumentChecks, 1);
    assert.equal(auditEvents.length, 1);
    assert.equal(auditContexts.length, 1);
    assert.equal(
      auditContexts[0]?.accessToken,
      "mock-director-copilot-service-token-akl-api",
    );
    assert.equal(auditContexts[0]?.serviceClientId, "svc-akb-director-copilot");
    const serializedAudit = JSON.stringify(auditEvents[0]);
    assert.match(serializedAudit, /director-copilot-2/);
    assert.match(serializedAudit, /source_versions_json/);
    assert.match(serializedAudit, /latency_ms/);
    assert.equal(serializedAudit.includes("actor-token"), false);
    assert.equal(serializedAudit.includes("Disky pro QNAP"), false);
    const history = directorCopilotV2PersistenceMetadata(response, context());
    const serializedHistory = JSON.stringify(history);
    assert.match(serializedHistory, /"contract_version":"director-copilot-2"/);
    assert.match(
      serializedHistory,
      /"project_ids":\["project-001"\]/,
    );
    assert.equal(serializedHistory.includes("actor-token"), false);
    assert.equal(serializedHistory.includes("Projekt Alfa"), false);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher();
    try {
      assert.deepEqual(
        await authorizeDirectorCopilotV2History({
          message: assistantMessage(history),
          previousUserMessage: message,
          actorContext: context(),
          config: config(),
          clients: {
            registry: {
              getDocument: async () => {
                throw new Error("fixture document remains unauthorized");
              },
            },
          } as unknown as Pick<ApiClients, "registry">,
        }),
        { status: "allowed" },
      );
      assert.deepEqual(
        await authorizeDirectorCopilotV2History({
          message: assistantMessage(history),
          previousUserMessage: message,
          actorContext: {
            ...context(),
            applicationAccess: context().applicationAccess?.filter(
              (candidate) => candidate.application !== "budget",
            ),
          },
          config: config(),
        }),
        { status: "access_changed" },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("traverses only the typed AIIP to ArchFlow relationship", async () => {
    const message = "Které AI podněty mají navázanou potřebu v ArchFlow?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-innovation",
      responseLanguage: "cs",
      actorContext: context(),
      clients: {
        rag: {
          assistantChat: async () => {
            throw new Error("Typed live relationships must not use RAG");
          },
        },
        registry: {
          getDocument: async () => {
            throw new Error("no document traversal expected");
          },
          createAuditEvent: async () => ({}),
        },
      } as unknown as ApiClients,
      config: config(),
      intent: "innovation_delivery_trace",
      queryState,
      mode: "active",
      fetcher: innovationFetcher(),
      refreshActorContext: async () => context(),
    });

    assert.equal(response.response_type, "answer");
    assert.match(response.answer ?? "", /Cesta podnětu k realizaci/);
    assert.match(response.answer ?? "", /Podnět Alfa/);
    assert.match(response.answer ?? "", /Potřeba Alfa/);
    assert.equal((response.answer ?? "").includes("stratos:idea:"), false);
    assert.equal((response.answer ?? "").includes("stratos:need:"), false);
  });

  it("audits a bounded machine reason when a V2 source is not authorized", async () => {
    const auditEvents: unknown[] = [];
    const message = "Jaký má IT rozpočet na rok 2025?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const actorContext = {
      ...context(),
      applicationAccess: context().applicationAccess?.filter(
        (candidate) => candidate.application !== "budget",
      ),
    };

    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-denied",
      responseLanguage: "cs",
      actorContext,
      clients: {
        registry: {
          getDocument: async () => {
            throw new Error("no document authorization expected");
          },
          createAuditEvent: async (event: unknown) => {
            auditEvents.push(event);
            return {};
          },
        },
      } as unknown as ApiClients,
      config: config(),
      intent: "budget_portfolio_status",
      queryState,
      mode: "active",
      fetcher: fetcher(),
      refreshActorContext: async () => actorContext,
    });

    assert.equal(response.response_type, "restricted");
    assert.equal(auditEvents.length, 1);
    const serializedAudit = JSON.stringify(auditEvents[0]);
    assert.match(
      serializedAudit,
      /"failure_reason_code":"DIRECTOR_COPILOT_V2_[A-Z0-9_]+"/,
    );
    assert.equal(serializedAudit.includes("actor-token"), false);
  });

  it("requests Budget items and returns only the highest comparable plan item", async () => {
    const requests: DirectorCopilotV2Request[] = [];
    const message = "Jaká je nejvyšší položka plánu?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-budget-item",
      responseLanguage: "cs",
      actorContext: context(),
      clients: {
        registry: {
          getDocument: async () => {
            throw new Error("no document authorization expected");
          },
          createAuditEvent: async () => ({}),
        },
      } as unknown as ApiClients,
      config: config(),
      intent: "budget_portfolio_status",
      queryState,
      mode: "active",
      fetcher: budgetItemFetcher(requests),
      refreshActorContext: async () => context(),
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.tool_id, "budget.organization_financial_summary.v1");
    assert.equal(requests[0]?.parameters.granularity, "item");
    assert.deepEqual(requests[0]?.parameters.group_by, ["budget_item"]);
    assert.deepEqual(requests[0]?.parameters.scenario, ["plan"]);
    assert.match(response.answer ?? "", /Nejvyšší oprávněná položka/);
    assert.match(response.answer ?? "", /Servery/);
    assert.match(response.answer ?? "", /500[  ]000/);
    assert.equal((response.answer ?? "").includes("Licence"), false);
  });
});

function fetcher(): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (init?.method === "GET") {
      const audience = url.includes("projectflow")
        ? "projectflow-api"
        : url.includes("archflow")
          ? "archflow-api"
          : url.includes("aiip")
            ? "aiip-api"
            : "budget-api";
      return Response.json({
        schema_version: "director-copilot-2",
        manifests: pinnedDirectorCopilotV2ManifestBundle().manifests.filter(
          (manifest) => manifest.audience === audience,
        ),
      });
    }
    const request = JSON.parse(String(init?.body)) as DirectorCopilotV2Request;
    const source = url.includes("projectflow")
      ? structuredClone(projectflow.responses.complete)
      : budgetProjectShapedOrganizationResponse();
    return Response.json({
      ...source,
      tool_id: request.tool_id,
      tool_call_id: request.tool_call_id,
    });
  };
}

function budgetProjectShapedOrganizationResponse(): Record<string, unknown> {
  const response = structuredClone(budgetOrganization.responses.complete);
  response.items = structuredClone(budgetProject.responses.complete.items);
  response.completeness.candidate_count = response.items.length;
  return response;
}

function innovationFetcher(): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (init?.method === "GET") {
      const audience = url.includes("projectflow")
        ? "projectflow-api"
        : url.includes("archflow")
          ? "archflow-api"
          : url.includes("aiip")
            ? "aiip-api"
            : "budget-api";
      return Response.json({
        schema_version: "director-copilot-2",
        manifests: pinnedDirectorCopilotV2ManifestBundle().manifests.filter(
          (manifest) => manifest.audience === audience,
        ),
      });
    }
    const request = JSON.parse(String(init?.body)) as DirectorCopilotV2Request;
    const source = url.includes("archflow")
      ? archflow.responses.complete
      : aiip.responses.complete;
    return Response.json({
      ...structuredClone(source),
      tool_call_id: request.tool_call_id,
    });
  };
}

function budgetItemFetcher(requests: DirectorCopilotV2Request[]): typeof fetch {
  return async (input, init) => {
    if (init?.method === "GET") {
      const url = String(input);
      const audience = url.includes("projectflow")
        ? "projectflow-api"
        : url.includes("archflow")
          ? "archflow-api"
          : url.includes("aiip")
            ? "aiip-api"
            : "budget-api";
      return Response.json({
        schema_version: "director-copilot-2",
        manifests: pinnedDirectorCopilotV2ManifestBundle().manifests.filter(
          (manifest) => manifest.audience === audience,
        ),
      });
    }
    const request = JSON.parse(String(init?.body)) as DirectorCopilotV2Request;
    requests.push(request);
    const response = structuredClone(budgetOrganization.responses.complete);
    const base = structuredClone(response.items[0]);
    response.items = [
      budgetItem(base, "licence", "Licence", 120_000),
      budgetItem(base, "servery", "Servery", 500_000),
      budgetItem(base, "skoleni", "Školení", 80_000),
    ];
    response.completeness.candidate_count = response.items.length;
    return Response.json({
      ...response,
      tool_id: request.tool_id,
      tool_call_id: request.tool_call_id,
    });
  };
}

function budgetItem(
  base: DirectorCopilotV2Item,
  id: string,
  displayName: string,
  planAmount: number,
): DirectorCopilotV2Item {
  const canonicalId = `stratos:budget-aggregate:budget_item:${id}`;
  return {
    ...structuredClone(base),
    entity_type: "budget_item",
    entity_id: id,
    canonical_id: canonicalId,
    deep_link: `https://stratos.example.test/budget/items/${id}`,
    document_context_tags: [`budget_item:${id}`],
    policy_lineage: base.policy_lineage.map((entry) => ({
      ...structuredClone(entry),
      resource_id: canonicalId,
    })),
    facts: [
      {
        ...structuredClone(base.facts[0]),
        key: "budget_item.display_name",
        value: displayName,
      },
      {
        ...structuredClone(base.facts[1]),
        key: "budget.plan_amount",
        value: planAmount,
      },
    ],
  };
}

function context(): ApiRequestContext {
  return {
    subjectId: "fixture-subject",
    organizationId: "org_stratos",
    identityActive: true,
    membershipActive: true,
    applicationAccessActive: true,
    authorizationSource: "stratos_projection",
    accessToken: "actor-token",
    requestId: "request-v2-chat",
    correlationId: "correlation-v2-chat",
    applicationAccess: [
      access("budget", ["budget:access", "budget:read"]),
      access("projectflow", ["projectflow:access", "projectflow:read"]),
      access("archflow", ["archflow:access", "archflow:read_organization"]),
      access("aiip", ["aiip:access", "aiip:read_organization"]),
    ],
  };
}

function access(application: string, capabilities: string[]) {
  return {
    application,
    capabilities,
    scopes: ["organization:org_stratos"],
    effectiveScopes: ["organization:org_stratos"],
    validUntil: null,
  };
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
      v2ManifestCacheTtlMs: 300_000,
      clientId: "svc-akb-director-copilot",
      budgetBaseUrl: "https://budget.example",
      projectflowBaseUrl: "https://projectflow.example",
      archflowBaseUrl: "https://archflow.example",
      aiipBaseUrl: "https://aiip.example",
      timeoutMs: 1_000,
      maxResponseBytes: 262_144,
    },
  };
}

function fixture(name: string): {
  responses: Record<string, any>;
} {
  return JSON.parse(readFileSync(
    new URL(`./fixtures/director-copilot-v2/${name}`, import.meta.url),
    "utf8",
  )) as {
    responses: Record<string, any>;
  };
}

function assistantMessage(
  metadata: Record<string, unknown>,
): AssistantConversationMessage {
  return {
    message_id: "message-v2",
    role: "assistant",
    author_subject_id: "akb-assistant",
    author_subject_type: "service",
    author_display_name: "AKB Assistant",
    content: "Bounded Director Copilot V2 response.",
    response_type: "answer",
    citations: [],
    metadata,
    availability: "available",
    viewer_feedback: null,
    created_at: "2026-07-25T10:00:00.000Z",
  };
}
