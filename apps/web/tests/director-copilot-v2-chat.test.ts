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
    assert.match(serializedHistory, /"live_sources":\[/);
    assert.match(serializedHistory, /"application":"budget"/);
    assert.match(serializedHistory, /"item_count":1/);
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

  it("routes AI idea wording to the current ArchFlow intake source", async () => {
    const message = "Které AI podněty v ArchFlow čekají na rozhodnutí?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-intake",
      responseLanguage: "cs",
      actorContext: context(),
      clients: {
        rag: {
          assistantChat: async () => {
            throw new Error("ArchFlow live intake must not use RAG");
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
      intent: "archflow_demand_overview",
      queryState,
      mode: "active",
      fetcher: fetcher(),
      refreshActorContext: async () => context(),
    });

    assert.equal(response.response_type, "answer");
    assert.match(response.answer ?? "", /ArchFlow/);
    assert.match(response.answer ?? "", /Potřeba Alfa/);
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
    const message = "Jaká je největší akce plánovaná v roce 2025?";
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
    assert.deepEqual(requests[0]?.parameters.group_by, ["procurement_action"]);
    assert.deepEqual(requests[0]?.parameters.scenario, ["plan"]);
    assert.match(response.answer ?? "", /Nejvyšší oprávněná akce/);
    assert.match(response.answer ?? "", /Servery/);
    assert.match(response.answer ?? "", /500[  ]000/);
    assert.match(response.answer ?? "", /\*\*Rozsah:\*\* oprávněné plánované akce/);
    assert.match(response.answer ?? "", /\*\*Výsledek:\*\* nejvyšší akce z 3/);
    assert.match(response.answer ?? "", /\*\*Stav dat:\*\* úplná/);
    assert.match(response.answer ?? "", /\[Servery\]\(https:\/\/stratos\.example\.test\/budget\/actions\/servery\)/);
    assert.equal((response.answer ?? "").includes("Licence"), false);
  });

  it("counts authorized Budget actions from item-level completeness metadata", async () => {
    const requests: DirectorCopilotV2Request[] = [];
    const message = "Kolik akcí má plán na rok 2025?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-budget-count",
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

    assert.equal(requests[0]?.parameters.granularity, "item");
    assert.deepEqual(requests[0]?.parameters.group_by, ["procurement_action"]);
    assert.match(response.answer ?? "", /eviduje \*\*3\*\* oprávněných plánovaných akcí/);
    assert.match(response.answer ?? "", /\*\*Výsledek:\*\* úplný počet \(3\)/);
    assert.match(response.answer ?? "", /\*\*Aktualizováno:\*\*/);
    assert.doesNotMatch(response.answer ?? "", /Sekce IT/);
  });

  it("returns the complete authorized Budget item list rather than an organization aggregate", async () => {
    const requests: DirectorCopilotV2Request[] = [];
    const message = "Jaké akce máme v plánu na rok 2025?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-budget-list",
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

    assert.equal(queryState.operation, "list");
    assert.equal(requests[0]?.parameters.granularity, "item");
    assert.match(response.answer ?? "", /Licence/);
    assert.match(response.answer ?? "", /Servery/);
    assert.match(response.answer ?? "", /Školení/);
    assert.match(response.answer ?? "", /\*\*Výsledek:\*\* zobrazeno 3 z 3 odpovídajících položek/);
  });

  it("renders only exact typed need-project-finance relationships across three live sources", async () => {
    const message = "Které potřeby mají navázané projekty, jaký mají plán a které jsou zpožděné?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-cross-source",
      responseLanguage: "cs",
      actorContext: context(),
      clients: {
        registry: {
          getDocument: async () => ({}) as never,
          createAuditEvent: async () => ({}),
        },
      } as unknown as ApiClients,
      config: config(),
      intent: "portfolio_performance_overview",
      queryState,
      mode: "active",
      fetcher: fetcher(),
      refreshActorContext: async () => context(),
    });

    const persistedQueryState = response.current_context.stratos_query_state as {
      sources?: string[];
    };
    assert.deepEqual(
      new Set(persistedQueryState.sources ?? []),
      new Set(["budget", "projectflow", "archflow"]),
    );
    assert.match(response.answer ?? "", /Ověřené souvislosti napříč STRATOS/);
    assert.match(response.answer ?? "", /Potřeba Alfa/);
    assert.match(response.answer ?? "", /Projekt Alfa/);
    assert.match(response.answer ?? "", /14 dní/);
    assert.equal((response.answer ?? "").includes("stratos:project:"), false);
  });

  it("rejects an incomplete count at the evidence gate", async () => {
    const requests: DirectorCopilotV2Request[] = [];
    const message = "Kolik akcí má plán na rok 2025?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-incomplete-count",
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
      fetcher: budgetItemFetcher(requests, { incomplete: true }),
      refreshActorContext: async () => context(),
    });

    assert.equal(response.response_type, "no_answer");
    assert.ok(
      response.warnings.includes("LIVE_DATA_EVIDENCE_COUNT_INCOMPLETE"),
      JSON.stringify(response.warnings),
    );
    assert.ok(response.warnings.includes("LIVE_DATA_EVIDENCE_GATE_FAILED"));
    assert.doesNotMatch(response.answer ?? "", /\*\*3\*\*/);
  });

  it("fails closed when an item query receives an organizational aggregate", async () => {
    const auditEvents: unknown[] = [];
    const message = "Jaká je největší akce plánovaná v roce 2025?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-budget-shape-mismatch",
      responseLanguage: "cs",
      actorContext: context(),
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
      fetcher: aggregateBudgetFetcher(),
      refreshActorContext: async () => context(),
    });

    assert.equal(response.response_type, "no_answer");
    assert.ok(response.warnings.includes("LIVE_DATA_ENTITY_TYPE_MISMATCH"));
    assert.match(response.answer ?? "", /nevrátil požadovanou podrobnost dat/i);
    assert.doesNotMatch(response.answer ?? "", /Sekce IT/);
    assert.match(JSON.stringify(auditEvents), /"semantic_shape_valid":false/);
  });

  it("labels a partial organization aggregate as incomplete instead of an organization-wide total", async () => {
    const message = "Jaký je celkový schválený rozpočet organizace na rok 2025?";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-08-06T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-partial-organization",
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
      fetcher: aggregateBudgetFetcher({ partial: true }),
      refreshActorContext: async () => context(),
    });

    assert.equal(response.response_type, "answer");
    assert.match(response.answer ?? "", /oprávněná část organizace/i);
    assert.match(response.answer ?? "", /výsledek není úplný za celou organizaci/i);
    assert.match(response.answer ?? "", /nemají pro zvolené období schválený plán/i);
    assert.match(response.answer ?? "", /nejsou zahrnuty do součtu ani nahrazeny nulou/i);
    assert.doesNotMatch(response.answer ?? "", /celá oprávněná organizace/i);
  });

  it("distinguishes a rejected live contract from a source outage", async () => {
    const message = "Vypiš mi největší položky výdajového plánu roku 2025";
    const queryState = resolveConversationQuery({
      message,
      now: new Date("2026-07-29T10:00:00.000Z"),
    }).state;
    const response = await runDirectorCopilotV2Chat({
      message,
      conversationId: "conversation-v2-invalid-budget-contract",
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
      fetcher: invalidBudgetItemFetcher(),
      refreshActorContext: async () => context(),
    });

    assert.equal(response.response_type, "no_answer");
    assert.match(response.answer ?? "", /zdroj STRATOS odpověděl/i);
    assert.match(response.answer ?? "", /závaznému kontraktu/i);
    assert.doesNotMatch(response.answer ?? "", /dočasně nedostupný/i);
    assert.ok(response.warnings.includes("LIVE_DATA_CONTRACT_REJECTED"));
    assert.ok(response.warnings.includes("LIVE_DATA_FALLBACK_BLOCKED"));
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
      : url.includes("archflow")
        ? structuredClone(archflow.responses.complete)
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

function invalidBudgetItemFetcher(): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (init?.method === "GET") {
      const audience = url.includes("projectflow")
        ? "projectflow-api"
        : url.includes("archflow")
          ? "archflow-api"
          : "budget-api";
      return Response.json({
        schema_version: "director-copilot-2",
        manifests: pinnedDirectorCopilotV2ManifestBundle().manifests.filter(
          (manifest) => manifest.audience === audience,
        ),
      });
    }
    const request = JSON.parse(String(init?.body)) as DirectorCopilotV2Request;
    const response = structuredClone(budgetOrganization.responses.complete);
    response.tool_call_id = request.tool_call_id;
    response.items[0].facts[0].quality = 2;
    return Response.json(response);
  };
}

function aggregateBudgetFetcher(options: { partial?: boolean } = {}): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (init?.method === "GET") {
      const audience = url.includes("projectflow")
        ? "projectflow-api"
        : url.includes("archflow")
          ? "archflow-api"
          : "budget-api";
      return Response.json({
        schema_version: "director-copilot-2",
        manifests: pinnedDirectorCopilotV2ManifestBundle().manifests.filter(
          (manifest) => manifest.audience === audience,
        ),
      });
    }
    const request = JSON.parse(String(init?.body)) as DirectorCopilotV2Request;
    const response = structuredClone(budgetOrganization.responses.complete);
    if (options.partial) {
      response.status = "partial";
      response.completeness.authorized_result_complete = false;
      response.completeness.source_coverage = "partial";
      response.completeness.missing_reasons = ["BUDGET_APPROVED_PLAN_MISSING"];
    }
    return Response.json({
      ...response,
      tool_id: request.tool_id,
      tool_call_id: request.tool_call_id,
    });
  };
}

function budgetItemFetcher(
  requests: DirectorCopilotV2Request[],
  options: { incomplete?: boolean } = {},
): typeof fetch {
  return async (input, init) => {
    if (init?.method === "GET") {
      const url = String(input);
      const audience = url.includes("projectflow")
        ? "projectflow-api"
        : url.includes("archflow")
          ? "archflow-api"
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
      procurementAction(base, "licence", "Licence", 120_000),
      procurementAction(base, "servery", "Servery", 500_000),
      procurementAction(base, "skoleni", "Školení", 80_000),
    ];
    response.completeness.candidate_count = response.items.length;
    if (options.incomplete) {
      response.status = "partial";
      response.completeness.authorized_result_complete = false;
      response.completeness.source_coverage = "partial";
      response.completeness.missing_reasons = [];
    }
    return Response.json({
      ...response,
      tool_id: request.tool_id,
      tool_call_id: request.tool_call_id,
    });
  };
}

function procurementAction(
  base: DirectorCopilotV2Item,
  id: string,
  displayName: string,
  planAmount: number,
): DirectorCopilotV2Item {
  const canonicalId = `stratos:procurement-action:${id}`;
  return {
    ...structuredClone(base),
    entity_type: "procurement_action",
    entity_id: id,
    canonical_id: canonicalId,
    deep_link: `https://stratos.example.test/budget/actions/${id}`,
    document_context_tags: [`procurement_action:${id}`],
    policy_lineage: base.policy_lineage.map((entry) => ({
      ...structuredClone(entry),
      resource_id: canonicalId,
    })),
    facts: [
      {
        ...structuredClone(base.facts[0]),
        key: "procurement_action.display_name",
        value: displayName,
      },
      {
        ...structuredClone(base.facts[1]),
        key: "procurement_action.planned_amount",
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
