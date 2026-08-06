import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyDirectorCopilotV2Intent } from "../src/lib/director-copilot-v2/intent-router";
import {
  conversationQueryState,
  resolveConversationQuery,
} from "../src/lib/director-copilot/query-state";

const NOW = new Date("2026-07-25T10:30:00Z");

describe("Director Copilot conversation query state", () => {
  it("extracts a fiscal year, organizational scope hint and financial metric", () => {
    const resolved = resolveConversationQuery({
      message: "Jaký má IT rozpočet na rok 2025?",
      now: NOW,
    });

    assert.equal(resolved.recognized, true);
    assert.deepEqual(resolved.state.sources, ["budget"]);
    assert.deepEqual(resolved.state.metrics, ["budget.plan_amount"]);
    assert.equal(resolved.state.period.type, "fiscal_year");
    assert.equal(resolved.state.period.fiscal_year, 2025);
    assert.match(resolved.state.period.as_of, /^2025-/);
    assert.equal(resolved.state.granularity, "organization_unit");
    assert.equal(resolved.state.operation, "summary");
    assert.equal(resolved.state.scope_label, "IT");
  });

  it("does not carry a selected project into a new organization-unit question", () => {
    const previous = resolveConversationQuery({
      message: "Jaké má tento projekt náklady?",
      now: NOW,
    }).state;
    previous.granularity = "project";
    previous.entity_filters.project_ids = ["project-qnap"];

    const resolved = resolveConversationQuery({
      message: "Jaký má IT rozpočet na rok 2025?",
      context: { stratos_query_state: previous },
      now: NOW,
    });

    assert.equal(resolved.state.granularity, "organization_unit");
    assert.equal(resolved.state.scope_label, "IT");
    assert.equal(resolved.state.period.fiscal_year, 2025);
    assert.deepEqual(resolved.state.metrics, ["budget.plan_amount"]);
    assert.deepEqual(resolved.state.entity_filters, {
      project_ids: [],
      portfolio_ids: [],
      organization_unit_ids: [],
      budget_scope_ids: [],
      need_ids: [],
      idea_ids: [],
    });
  });

  it("keeps the financial topic and year while an overall follow-up clears entity filters", () => {
    const previous = resolveConversationQuery({
      message: "Jaký má projekt rozpočet na rok 2025?",
      now: NOW,
    }).state;
    previous.entity_filters.project_ids = ["project-001"];

    const resolved = resolveConversationQuery({
      message: "Ne jen pro tento projekt, ale celkově.",
      context: { stratos_query_state: previous },
      now: NOW,
    });

    assert.equal(resolved.recognized, true);
    assert.equal(resolved.inherited, true);
    assert.deepEqual(resolved.state.sources, ["budget"]);
    assert.deepEqual(resolved.state.metrics, ["budget.plan_amount"]);
    assert.equal(resolved.state.period.fiscal_year, 2025);
    assert.equal(resolved.state.granularity, "organization");
    assert.deepEqual(resolved.state.entity_filters.project_ids, []);
    assert.equal(
      classifyDirectorCopilotV2Intent("Ne jen pro tento projekt, ale celkově.", {
        stratos_query_state: previous,
      }),
      "budget_portfolio_status",
    );
  });

  it("keeps the organization financial context when the next turn groups by portfolio", () => {
    const first = resolveConversationQuery({
      message: "Jaký má IT rozpočet na rok 2025?",
      now: NOW,
    });
    const second = resolveConversationQuery({
      message: "Ne jen pro tento projekt, ale celkově.",
      context: { stratos_query_state: first.state },
      now: NOW,
    });
    const third = resolveConversationQuery({
      message: "Rozděl ho podle portfolií.",
      context: { stratos_query_state: second.state },
      now: NOW,
    });

    assert.equal(third.recognized, true);
    assert.equal(third.inherited, true);
    assert.deepEqual(third.state.sources, ["budget"]);
    assert.deepEqual(third.state.metrics, ["budget.plan_amount"]);
    assert.equal(third.state.period.fiscal_year, 2025);
    assert.equal(third.state.granularity, "portfolio");
    assert.deepEqual(third.state.entity_filters.project_ids, []);
    assert.equal(
      classifyDirectorCopilotV2Intent("Rozděl ho podle portfolií.", {
        stratos_query_state: second.state,
      }),
      "budget_portfolio_status",
    );
  });

  it("keeps year, metric and authorized entity context across the reference dialogue", () => {
    const first = resolveConversationQuery({
      message: "Jaký má IT rozpočet na rok 2025?",
      now: NOW,
    }).state;
    const second = resolveConversationQuery({
      message: "Ne jen pro tento projekt, ale celkově.",
      context: { stratos_query_state: first },
      now: NOW,
    }).state;
    const third = resolveConversationQuery({
      message: "Rozděl ho podle portfolií.",
      context: { stratos_query_state: second },
      now: NOW,
    }).state;
    third.entity_filters.portfolio_ids = ["portfolio-001"];
    const fourth = resolveConversationQuery({
      message: "Které projekty překračují plán?",
      context: { stratos_query_state: third },
      now: NOW,
    }).state;
    fourth.entity_filters.project_ids = ["project-001"];
    const fifth = resolveConversationQuery({
      message: "Které z nich mají současně zpožděný milník?",
      context: { stratos_query_state: fourth },
      now: NOW,
    }).state;

    assert.equal(fourth.period.fiscal_year, 2025);
    assert.equal(fourth.granularity, "project");
    assert.deepEqual(
      fourth.metrics,
      ["budget.plan_amount", "budget.variance_amount"],
    );
    assert.deepEqual(fourth.entity_filters.portfolio_ids, ["portfolio-001"]);
    assert.equal(fifth.period.fiscal_year, 2025);
    assert.equal(fifth.granularity, "project");
    assert.deepEqual(fifth.sources, ["projectflow"]);
    assert.deepEqual(
      fifth.metrics,
      ["milestone.max_delay_days", "milestone.next_due_date"],
    );
    assert.equal(fifth.filters.schedule_status, "delayed");
    assert.deepEqual(fifth.entity_filters.project_ids, ["project-001"]);
  });

  it("preserves a bounded interval and every V2 entity filter across a follow-up", () => {
    const previous = resolveConversationQuery({
      message: "Porovnej projekty od 2025-01-01 do 2025-06-30.",
      now: NOW,
    }).state;
    previous.entity_filters = {
      project_ids: ["project-001"],
      portfolio_ids: ["portfolio-001"],
      organization_unit_ids: ["unit-it"],
      budget_scope_ids: ["budget-it"],
      need_ids: ["need-001"],
      idea_ids: ["idea-001"],
    };

    const resolved = resolveConversationQuery({
      message: "A které z nich mají nejvyšší odchylku?",
      context: { stratos_query_state: previous },
      now: NOW,
    });

    assert.deepEqual(resolved.state.period.interval, {
      start: "2025-01-01",
      end: "2025-06-30",
    });
    assert.deepEqual(resolved.state.entity_filters, previous.entity_filters);
    assert.deepEqual(resolved.state.metrics, ["budget.variance_amount"]);
  });

  it("recognizes a combined financial and delivery question without requiring a contract term", () => {
    assert.equal(
      classifyDirectorCopilotV2Intent(
        "Které projekty mají nejvyšší rozpočtovou odchylku a současně zpožděný harmonogram?",
      ),
      "portfolio_performance_overview",
    );
  });

  it("recognizes the highest plan item as a ranked Budget item query", () => {
    const previous = resolveConversationQuery({
      message: "Jaký je plán projektu?",
      now: NOW,
    }).state;
    previous.entity_filters.project_ids = ["project-001"];
    const resolved = resolveConversationQuery({
      message: "Jaká je nejvyšší položka plánu?",
      context: { stratos_query_state: previous },
      now: NOW,
    });

    assert.equal(resolved.recognized, true);
    assert.deepEqual(resolved.state.sources, ["budget"]);
    assert.deepEqual(resolved.state.metrics, ["budget.plan_amount"]);
    assert.equal(resolved.state.granularity, "item");
    assert.equal(resolved.state.operation, "rank");
    assert.deepEqual(resolved.state.sort, {
      metric: "budget.plan_amount",
      direction: "desc",
    });
    assert.deepEqual(resolved.state.group_by, []);
    assert.deepEqual(resolved.state.entity_filters.project_ids, []);
  });

  it("treats a planned action as a Budget item rather than an organizational aggregate", () => {
    const resolved = resolveConversationQuery({
      message: "Jaká je největší akce plánovaná v roce 2025?",
      now: NOW,
    });

    assert.equal(resolved.recognized, true);
    assert.deepEqual(resolved.state.sources, ["budget"]);
    assert.deepEqual(resolved.state.metrics, ["budget.plan_amount"]);
    assert.equal(resolved.state.period.fiscal_year, 2025);
    assert.equal(resolved.state.granularity, "item");
    assert.equal(resolved.state.operation, "rank");
    assert.deepEqual(resolved.state.sort, {
      metric: "budget.plan_amount",
      direction: "desc",
    });
    assert.deepEqual(resolved.state.group_by, ["procurement_action"]);
  });

  it("distinguishes counts and lists of Budget actions from a financial summary", () => {
    const count = resolveConversationQuery({
      message: "Kolik akcí má plán na rok 2025?",
      now: NOW,
    });
    const list = resolveConversationQuery({
      message: "Jaké akce máme v plánu?",
      now: NOW,
    });
    const summary = resolveConversationQuery({
      message: "Kolik máme v rozpočtu?",
      now: NOW,
    });

    assert.equal(count.state.granularity, "item");
    assert.equal(count.state.operation, "count");
    assert.deepEqual(count.state.group_by, ["procurement_action"]);
    assert.equal(list.state.granularity, "item");
    assert.equal(list.state.operation, "list");
    assert.deepEqual(list.state.group_by, ["procurement_action"]);
    assert.equal(summary.state.granularity, "authorized_scope");
    assert.equal(summary.state.operation, "summary");
  });

  it("resets a previous ranking when a follow-up asks for a different metric without a superlative", () => {
    const previous = resolveConversationQuery({
      message: "Která akce má nejvyšší plán?",
      now: NOW,
    }).state;
    const resolved = resolveConversationQuery({
      message: "A jaký má výhled?",
      context: { stratos_query_state: previous },
      now: NOW,
    });

    assert.equal(previous.operation, "rank");
    assert.equal(resolved.state.operation, "summary");
    assert.equal(resolved.state.sort, null);
    assert.deepEqual(resolved.state.metrics, ["budget.forecast_amount"]);
  });

  it("does not divert a document question to a live domain tool", () => {
    const resolved = resolveConversationQuery({
      message: "Co je uvedeno v projektové dokumentaci?",
      now: NOW,
    });

    assert.equal(resolved.recognized, false);
    assert.equal(
      classifyDirectorCopilotV2Intent("Co je uvedeno v projektové dokumentaci?"),
      null,
    );
  });

  it("routes AI intake concepts to ArchFlow", () => {
    const resolved = resolveConversationQuery({
      message: "V jakém stavu jsou AI podněty v ArchFlow?",
      now: NOW,
    });

    assert.equal(resolved.recognized, true);
    assert.deepEqual(resolved.pending_sources, []);
    assert.deepEqual(resolved.state.sources, ["archflow"]);
    assert.deepEqual(resolved.state.metrics, ["archflow.need.status"]);
    assert.equal(
      classifyDirectorCopilotV2Intent(
        "V jakém stavu jsou AI podněty v ArchFlow?",
        {},
      ),
      "archflow_demand_overview",
    );
  });

  it("does not preserve the retired AIIP application name as a live source", () => {
    const resolved = resolveConversationQuery({
      message: "Kolik podnětů eviduje AIIP?",
      now: NOW,
    });

    assert.equal(resolved.recognized, false);
    assert.deepEqual(resolved.state.sources, []);
    assert.equal(classifyDirectorCopilotV2Intent("Kolik podnětů eviduje AIIP?"), null);
  });

  it("sanitizes untrusted persisted context and never accepts authorization fields", () => {
    const parsed = conversationQueryState({
      schema_version: "stratos-conversation-query-state-2",
      catalog_version: "stratos-semantic-catalog-2",
      sources: ["budget", "unknown", "projectflow"],
      metrics: ["budget.forecast_amount", "admin:all"],
      period: { type: "fiscal_year", fiscal_year: 2025, as_of: "forged" },
      granularity: "organization",
      operation: "count",
      scope_label: "IT",
      entity_filters: {
        project_ids: ["project-001", "invalid id with spaces"],
        portfolio_ids: [],
        organization_unit_ids: ["unit-it"],
        budget_scope_ids: ["budget-it"],
        need_ids: ["need-001"],
        idea_ids: ["idea-001"],
      },
      filters: { schedule_status: "delayed" },
      sort: { metric: "budget.forecast_amount", direction: "desc" },
      document_evidence_requested: false,
      requested_scopes: ["organization:org_stratos"],
      capabilities: ["budget:admin"],
    }, NOW);

    assert.deepEqual(parsed?.sources, ["budget", "projectflow"]);
    assert.deepEqual(parsed?.metrics, ["budget.forecast_amount"]);
    assert.deepEqual(parsed?.entity_filters.project_ids, ["project-001"]);
    assert.deepEqual(parsed?.entity_filters.organization_unit_ids, ["unit-it"]);
    assert.equal(parsed?.operation, "count");
    assert.equal(JSON.stringify(parsed).includes("requested_scopes"), false);
    assert.equal(JSON.stringify(parsed).includes("capabilities"), false);
  });

  it("migrates the previous catalog version without trusting additional fields", () => {
    const parsed = conversationQueryState({
      schema_version: "stratos-conversation-query-state-1",
      catalog_version: "stratos-semantic-catalog-1",
      sources: ["budget"],
      metrics: ["budget.plan_amount"],
      period: { type: "fiscal_year", fiscal_year: 2025, as_of: "forged" },
      granularity: "organization",
      scope_label: null,
      entity_filters: { project_ids: [], portfolio_ids: [] },
      filters: { schedule_status: null },
      sort: null,
      document_evidence_requested: false,
    }, NOW);

    assert.equal(parsed?.catalog_version, "stratos-semantic-catalog-2");
    assert.equal(parsed?.schema_version, "stratos-conversation-query-state-4");
    assert.equal(parsed?.operation, "summary");
    assert.deepEqual(parsed?.sources, ["budget"]);
  });

  it("covers varied everyday phrasing through concepts rather than full-sentence commands", () => {
    const supportedCases = [
      ["Kolik máme v rozpočtu?", "budget_portfolio_status"],
      ["Jaký je finanční plán pro letošek?", "budget_portfolio_status"],
      ["Kolik jsme už vyčerpali?", "budget_portfolio_status"],
      ["Jaký očekáváme konečný výhled?", "budget_portfolio_status"],
      ["Kde překročíme schválený plán?", "budget_portfolio_status"],
      ["Co právě realizujeme za projekty?", "project_portfolio_status"],
      ["Které projekty jsou po termínu?", "project_portfolio_status"],
      ["Co nás čeká za milníky?", "project_portfolio_status"],
      ["Kde jsme v prodlení s projekty?", "project_portfolio_status"],
      ["Jak pokračuje projektové portfolio?", "project_portfolio_status"],
      ["Porovnej náklady a zpoždění projektů.", "portfolio_performance_overview"],
      ["Které projekty jsou finančně nad plánem a zároveň zpožděné?", "portfolio_performance_overview"],
      ["What is the project status?", "project_portfolio_status"],
      ["What is this year's budget forecast?", "budget_portfolio_status"],
    ] as const;

    for (const [message, expected] of supportedCases) {
      assert.equal(classifyDirectorCopilotV2Intent(message), expected, message);
    }

    const governedSourceCases = [
      "Kolik máme business požadavků v ArchFlow?",
      "Které potřeby v ArchFlow jsou připravené?",
      "Které AI nápady čekají v ArchFlow na posouzení?",
    ] as const;
    for (const message of governedSourceCases) {
      const resolved = resolveConversationQuery({ message, now: NOW });
      assert.equal(resolved.recognized, true, message);
      assert.deepEqual(resolved.pending_sources, [], message);
      assert.deepEqual(resolved.state.sources, ["archflow"], message);
    }
  });

  it("decomposes explicit grouping independently from the requested metric", () => {
    const resolved = resolveConversationQuery({
      message: "Rozděl schválený rozpočet na rok 2025 podle portfolií.",
      now: NOW,
    });

    assert.deepEqual(resolved.state.sources, ["budget"]);
    assert.deepEqual(resolved.state.metrics, ["budget.plan_amount"]);
    assert.deepEqual(resolved.state.group_by, ["portfolio"]);
    assert.equal(resolved.state.period.fiscal_year, 2025);
  });

  it("asks for clarification only when plan can mean finance or delivery", () => {
    const ambiguous = resolveConversationQuery({
      message: "Jaký je plán na rok 2026?",
      now: NOW,
    });
    const financial = resolveConversationQuery({
      message: "Jaký je finanční plán na rok 2026?",
      now: NOW,
    });
    const delivery = resolveConversationQuery({
      message: "Jaký je plán milníků na rok 2026?",
      now: NOW,
    });

    assert.deepEqual(ambiguous.clarification, { kind: "plan_meaning" });
    assert.equal(financial.clarification, null);
    assert.equal(delivery.clarification, null);
  });

  it("uses the single active conversation source to resolve a plan follow-up", () => {
    const previous = resolveConversationQuery({
      message: "Jaký je stav projektového portfolia?",
      now: NOW,
    }).state;
    const resolved = resolveConversationQuery({
      message: "A jaký je plán pro rok 2026?",
      context: { stratos_query_state: previous },
      now: NOW,
    });

    assert.equal(resolved.clarification, null);
    assert.deepEqual(resolved.state.sources, ["projectflow"]);
  });
});
