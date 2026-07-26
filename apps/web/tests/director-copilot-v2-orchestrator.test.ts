import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ApiRequestContext } from "../src/lib/types";
import type { DirectorCopilotV2Request } from "../src/lib/director-copilot-v2/contracts";
import { pinnedDirectorCopilotV2CatalogForTests } from "../src/lib/director-copilot-v2/manifest-catalog";
import { orchestrateDirectorCopilotV2 } from "../src/lib/director-copilot-v2/orchestrator";
import { resolveConversationQuery } from "../src/lib/director-copilot/query-state";
import { DirectorCopilotTransportError } from "../src/lib/director-copilot/transport-error";

const budgetOrganization = fixture("budget-organization-financial-summary.json");
const budgetProject = fixture("budget-project-financial-snapshot.json");
const projectflow = fixture("projectflow-portfolio-delivery-overview.json");
const archflow = fixture("archflow-need-portfolio-overview.json");

describe("Director Copilot V2 orchestration", () => {
  it("uses the source-owned organization aggregate instead of summing projects in AKB", async () => {
    const state = resolveConversationQuery({
      message: "Jaký je celkový rozpočet organizace na rok 2025?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const requests: DirectorCopilotV2Request[] = [];
    const result = await orchestrateDirectorCopilotV2({
      message: "Jaký je celkový rozpočet organizace na rok 2025?",
      language: "cs",
      context: projectedContext(),
      intent: "budget_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async (_application, request) => {
          requests.push(request);
          return {
            ...structuredClone(budgetOrganization.responses.complete),
            tool_call_id: request.tool_call_id,
          };
        },
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.equal(result.status, "complete");
    assert.equal(requests[0]?.tool_id, "budget.organization_financial_summary.v1");
    assert.deepEqual(requests[0]?.parameters.period, {
      type: "fiscal_year",
      fiscal_year: 2025,
    });
    assert.equal(requests[0]?.parameters.granularity, "organization");
  });

  it("routes the S1 IT budget question to the organization tool without a stale project filter", async () => {
    const previous = resolveConversationQuery({
      message: "Jaké má projekt QNAP náklady?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    previous.granularity = "project";
    previous.entity_filters.project_ids = ["project-qnap"];
    const state = resolveConversationQuery({
      message: "Jaký má IT rozpočet na rok 2025?",
      context: { stratos_query_state: previous },
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const requests: DirectorCopilotV2Request[] = [];

    await orchestrateDirectorCopilotV2({
      message: "Jaký má IT rozpočet na rok 2025?",
      language: "cs",
      context: projectedContext("budget-contract"),
      intent: "budget_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async (_application, request) => {
          requests.push(request);
          return {
            ...structuredClone(budgetOrganization.responses.complete),
            tool_call_id: request.tool_call_id,
          };
        },
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.equal(requests[0]?.tool_id, "budget.organization_financial_summary.v1");
    assert.equal(requests[0]?.parameters.granularity, "organization_unit");
    assert.deepEqual(requests[0]?.parameters.period, {
      type: "fiscal_year",
      fiscal_year: 2025,
    });
    assert.deepEqual(requests[0]?.parameters.entity_filters.project_ids, []);
  });

  it("uses the project snapshot for an explicitly selected project", async () => {
    const state = resolveConversationQuery({
      message: "Jaký je rozpočet projektu v roce 2025?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    state.granularity = "project";
    state.entity_filters.project_ids = ["project-001"];
    const requests: DirectorCopilotV2Request[] = [];
    await orchestrateDirectorCopilotV2({
      message: "Jaký je rozpočet projektu v roce 2025?",
      language: "cs",
      context: projectedContext(),
      intent: "budget_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async (_application, candidate) => {
          requests.push(candidate);
          return {
            ...structuredClone(budgetProject.responses.complete),
            tool_call_id: candidate.tool_call_id,
          };
        },
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.equal(requests[0]?.tool_id, "budget.project_financial_snapshot.v1");
    assert.deepEqual(requests[0]?.parameters.entity_filters.project_ids, ["project-001"]);
  });

  it("maps the persisted V2 interval and entity filters into the closed request", async () => {
    const state = resolveConversationQuery({
      message: "Jaký je rozpočet od 2025-01-01 do 2025-06-30?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    state.entity_filters = {
      project_ids: [],
      portfolio_ids: ["portfolio-001"],
      organization_unit_ids: ["unit-it"],
      budget_scope_ids: ["budget-it"],
      need_ids: [],
      idea_ids: [],
    };
    const requests: DirectorCopilotV2Request[] = [];
    await orchestrateDirectorCopilotV2({
      message: "A jaký je výhled?",
      language: "cs",
      context: projectedContext(),
      intent: "budget_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async (_application, request) => {
          requests.push(request);
          return {
            ...structuredClone(budgetOrganization.responses.complete),
            tool_call_id: request.tool_call_id,
          };
        },
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.deepEqual(requests[0]?.parameters.period, {
      type: "interval",
      start: "2025-01-01",
      end: "2025-06-30",
    });
    assert.deepEqual(requests[0]?.parameters.entity_filters, state.entity_filters);
  });

  it("never exposes a ProjectFlow document link without independent AKB authorization", async () => {
    const state = resolveConversationQuery({
      message: "Jaký je stav projektů?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const denied = await orchestrateDirectorCopilotV2({
      message: "Jaký je stav projektů?",
      language: "cs",
      context: projectedContext(),
      intent: "project_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async (_application, request) => ({
          ...structuredClone(projectflow.responses.complete),
          tool_call_id: request.tool_call_id,
        }),
      },
      authorizeDocument: async () => false,
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.deepEqual(denied.snapshot.authorized_document_ids, []);
    assert.deepEqual(denied.snapshot.internal_warnings, [
      "DIRECTOR_COPILOT_V2_DOCUMENT_LINK_DENIED",
    ]);
  });

  it("fails closed when the access projection changes before synthesis", async () => {
    const state = resolveConversationQuery({
      message: "Jaký je stav projektů?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    await assert.rejects(
      () => orchestrateDirectorCopilotV2({
        message: "Jaký je stav projektů?",
        language: "cs",
        context: projectedContext(),
        intent: "project_portfolio_status",
        queryState: state,
        catalog: pinnedDirectorCopilotV2CatalogForTests(),
        client: {
          execute: async (_application, request) => ({
            ...structuredClone(projectflow.responses.complete),
            tool_call_id: request.tool_call_id,
          }),
        },
        refreshActorContext: async () => ({
          ...projectedContext(),
          applicationAccess: projectedContext().applicationAccess?.filter(
            (access) => access.application !== "projectflow",
          ),
        }),
        now: new Date("2026-07-25T10:00:00.000Z"),
      }),
      (error: unknown) => error instanceof DirectorCopilotTransportError
        && error.code === "DIRECTOR_COPILOT_V2_ACCESS_CHANGED",
    );
  });

  it("keeps no-data distinct from authorization and upstream failures", async () => {
    const state = resolveConversationQuery({
      message: "Jaký je stav projektů?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const result = await orchestrateDirectorCopilotV2({
      message: "Jaký je stav projektů?",
      language: "cs",
      context: projectedContext(),
      intent: "project_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async (_application, request) => ({
          ...structuredClone(projectflow.responses.no_data),
          tool_call_id: request.tool_call_id,
        }),
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.equal(result.status, "no_data");
    assert.equal(result.snapshot.outcomes[0]?.status, "no_data");
  });

  it("never mints the fixed organization from a projection for another organization", async () => {
    const state = resolveConversationQuery({
      message: "Jaký je stav projektů?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    let calls = 0;
    const result = await orchestrateDirectorCopilotV2({
      message: "Jaký je stav projektů?",
      language: "cs",
      context: {
        ...projectedContext(),
        organizationId: "org_other",
      },
      intent: "project_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async () => {
          calls += 1;
          throw new Error("must not call a source");
        },
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.equal(result.status, "not_authorized");
    assert.equal(calls, 0);
    assert.deepEqual(result.snapshot.outcomes[0]?.reason_codes, [
      "DIRECTOR_COPILOT_V2_ORGANIZATION_MISMATCH",
    ]);
  });

  it("uses a distinct idempotency key for every cursor page", async () => {
    const state = resolveConversationQuery({
      message: "Jaký je stav projektů?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    const calls: DirectorCopilotV2Request[] = [];
    const result = await orchestrateDirectorCopilotV2({
      message: "Jaký je stav projektů?",
      language: "cs",
      context: projectedContext(),
      intent: "project_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async (_application, request) => {
          calls.push(request);
          const response = structuredClone(projectflow.responses.complete);
          response.tool_call_id = request.tool_call_id;
          response.next_cursor = calls.length === 1 ? "cursor-page-2" : null;
          if (calls.length === 2) {
            response.items = [];
            response.completeness.candidate_count = 1;
          }
          return response;
        },
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.equal(result.status, "complete");
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0]?.tool_call_id, calls[1]?.tool_call_id);
    assert.equal(calls[1]?.parameters.cursor, "cursor-page-2");
  });

  it("stores canonical project identities from authorized source results for a follow-up", async () => {
    const state = resolveConversationQuery({
      message: "Jaký je rozpočet projektu v roce 2025?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    state.granularity = "project";
    state.entity_filters.project_ids = ["project-001"];

    const result = await orchestrateDirectorCopilotV2({
      message: "Jaký je rozpočet projektu v roce 2025?",
      language: "cs",
      context: projectedContext(),
      intent: "budget_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async (_application, request) => ({
          ...structuredClone(budgetProject.responses.complete),
          tool_call_id: request.tool_call_id,
        }),
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.deepEqual(
      result.continuation_query_state.entity_filters.project_ids,
      ["project-001"],
    );
    assert.equal(result.continuation_query_state.period.fiscal_year, 2025);
  });

  it("does not call ProjectFlow with an unresolved unsupported entity filter", async () => {
    const state = resolveConversationQuery({
      message: "Které potřeby mají zpožděný projekt?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    state.sources = ["projectflow"];
    state.metrics = ["project.schedule_status"];
    state.granularity = "project";
    state.entity_filters.need_ids = ["need-001"];
    let calls = 0;

    const result = await orchestrateDirectorCopilotV2({
      message: "Které potřeby mají zpožděný projekt?",
      language: "cs",
      context: projectedContext(),
      intent: "project_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async () => {
          calls += 1;
          throw new Error("must not call ProjectFlow");
        },
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.equal(calls, 0);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.snapshot.outcomes[0]?.reason_codes, [
      "DIRECTOR_COPILOT_V2_ENTITY_FILTER_RESOLUTION_REQUIRED",
    ]);
    assert.equal(result.plan.nodes[0]?.request, null);
  });

  it("does not infer a ProjectFlow relationship from unrelated coexisting filters", async () => {
    const state = resolveConversationQuery({
      message: "Které z těchto potřeb mají zpožděný projekt?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    state.sources = ["projectflow"];
    state.metrics = ["project.schedule_status"];
    state.granularity = "project";
    state.entity_filters.need_ids = ["need-001"];
    state.entity_filters.project_ids = ["project-001"];
    let calls = 0;

    const result = await orchestrateDirectorCopilotV2({
      message: "Které z těchto potřeb mají zpožděný projekt?",
      language: "cs",
      context: projectedContext(),
      intent: "project_portfolio_status",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async () => {
          calls += 1;
          throw new Error("must not call ProjectFlow");
        },
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.equal(calls, 0);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.snapshot.outcomes[0]?.reason_codes, [
      "DIRECTOR_COPILOT_V2_ENTITY_FILTER_RESOLUTION_REQUIRED",
    ]);
  });

  it("converts a need to its canonical project only through a typed manifest link", async () => {
    const state = resolveConversationQuery({
      message: "Které potřeby byly předány do projektů?",
      now: new Date("2026-07-25T10:00:00.000Z"),
    }).state;
    state.sources = ["archflow"];
    state.metrics = ["archflow.need.status"];
    state.granularity = "project";

    const result = await orchestrateDirectorCopilotV2({
      message: "Které potřeby byly předány do projektů?",
      language: "cs",
      context: projectedContext(),
      intent: "archflow_demand_overview",
      queryState: state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      client: {
        execute: async (_application, request) => ({
          ...structuredClone(archflow.responses.complete),
          tool_call_id: request.tool_call_id,
        }),
      },
      now: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.deepEqual(
      result.continuation_query_state.entity_filters.project_ids,
      ["project-001"],
    );
    assert.deepEqual(
      result.continuation_query_state.entity_filters.need_ids,
      [],
    );
    assert.deepEqual(
      result.continuation_query_state.entity_filters.idea_ids,
      [],
    );
  });
});

function projectedContext(
  budgetApplication = "budget",
): ApiRequestContext {
  return {
    subjectId: "fixture-subject",
    organizationId: "org_stratos",
    identityActive: true,
    membershipActive: true,
    applicationAccessActive: true,
    authorizationSource: "stratos_projection",
    accessToken: "actor-token",
    requestId: "request-v2",
    correlationId: "correlation-v2",
    applicationAccess: [
      access(budgetApplication, ["budget:access", "budget:read"]),
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
