import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyDirectorCopilotIntent } from "../src/lib/director-copilot/planner";
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
    assert.equal(resolved.state.scope_label, "IT");
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
      classifyDirectorCopilotIntent("Ne jen pro tento projekt, ale celkově.", {
        stratos_query_state: previous,
      }),
      "budget_portfolio_status",
    );
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
      classifyDirectorCopilotIntent(
        "Které projekty mají nejvyšší rozpočtovou odchylku a současně zpožděný harmonogram?",
      ),
      "portfolio_performance_overview",
    );
  });

  it("does not divert a document question to a live domain tool", () => {
    const resolved = resolveConversationQuery({
      message: "Co je uvedeno v projektové dokumentaci?",
      now: NOW,
    });

    assert.equal(resolved.recognized, false);
    assert.equal(
      classifyDirectorCopilotIntent("Co je uvedeno v projektové dokumentaci?"),
      null,
    );
  });

  it("marks an explicit AIIP live-data question as pending instead of allowing a RAG fallback", () => {
    const resolved = resolveConversationQuery({
      message: "Kolik podnětů eviduje AIIP a v jakém jsou stavu?",
      now: NOW,
    });

    assert.equal(resolved.recognized, true);
    assert.deepEqual(resolved.pending_sources, ["aiip"]);
    assert.equal(
      classifyDirectorCopilotIntent(
        "Kolik podnětů eviduje AIIP a v jakém jsou stavu?",
        {},
        { includeContractReady: true },
      ),
      "aiip_idea_overview",
    );
  });

  it("sanitizes untrusted persisted context and never accepts authorization fields", () => {
    const parsed = conversationQueryState({
      schema_version: "stratos-conversation-query-state-2",
      catalog_version: "stratos-semantic-catalog-2",
      sources: ["budget", "unknown", "projectflow"],
      metrics: ["budget.forecast_amount", "admin:all"],
      period: { type: "fiscal_year", fiscal_year: 2025, as_of: "forged" },
      granularity: "organization",
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
      assert.equal(classifyDirectorCopilotIntent(message), expected, message);
    }

    const pendingCases = [
      ["Kolik máme business požadavků v ArchFlow?", "archflow"],
      ["Které potřeby v ArchFlow jsou připravené?", "archflow"],
      ["Kolik AI nápadů čeká v AIIP na posouzení?", "aiip"],
      ["Jaký přínos mají podněty v AI Innovation Portal?", "aiip"],
    ] as const;
    for (const [message, expectedSource] of pendingCases) {
      const resolved = resolveConversationQuery({ message, now: NOW });
      assert.equal(resolved.recognized, true, message);
      assert.deepEqual(resolved.pending_sources, [expectedSource], message);
    }
  });
});
