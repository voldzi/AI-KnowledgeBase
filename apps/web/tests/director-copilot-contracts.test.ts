import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DOMAIN_TOOL_IDS,
  DirectorCopilotContractError,
  parseDomainToolResponse,
} from "../src/lib/director-copilot/contracts";

const budgetFixture = JSON.parse(readFileSync(
  new URL("../../../contracts/director-copilot/v1/fixtures/budget-complete.json", import.meta.url),
  "utf8",
)) as Record<string, unknown>;

describe("Director Copilot DomainTool contract", () => {
  it("accepts the governed Budget fixture", () => {
    const response = parseDomainToolResponse(budgetFixture, {
      toolId: DOMAIN_TOOL_IDS.budget,
      toolCallId: "call_1111111111111111",
      requestedScopes: [{ type: "project", id: "project-001" }],
      nowMs: Date.parse("2026-07-21T10:01:00Z"),
    });

    assert.equal(response.status, "complete");
    assert.equal(response.items[0]?.canonical_id, "stratos:project:project-001");
    assert.equal(response.items[0]?.policy.classification.handling_class, "INTERNAL");
    assert.deepEqual(response.items[0]?.policy.obligations, ["AUDIT_ACCESS"]);
  });

  it("rejects a response that expands the requested scope", () => {
    assert.throws(
      () => parseDomainToolResponse(budgetFixture, {
        toolId: DOMAIN_TOOL_IDS.budget,
        toolCallId: "call_1111111111111111",
        requestedScopes: [{ type: "project", id: "project-999" }],
        nowMs: Date.parse("2026-07-21T10:01:00Z"),
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "DOMAIN_TOOL_SCOPE_EXPANSION",
    );
  });

  it("rejects unknown fields and obligations", () => {
    const withUnknownField = structuredClone(budgetFixture);
    withUnknownField.debug = "must not cross the boundary";
    assert.throws(
      () => parseDomainToolResponse(withUnknownField, {
        toolId: DOMAIN_TOOL_IDS.budget,
        toolCallId: "call_1111111111111111",
        requestedScopes: [{ type: "project", id: "project-001" }],
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "DOMAIN_TOOL_RESPONSE_FIELD_UNKNOWN",
    );

    const withUnknownObligation = structuredClone(budgetFixture) as {
      items: Array<{ policy: { obligations: string[] } }>;
    };
    withUnknownObligation.items[0]!.policy.obligations = ["COPY_ANYWHERE"];
    assert.throws(
      () => parseDomainToolResponse(withUnknownObligation, {
        toolId: DOMAIN_TOOL_IDS.budget,
        toolCallId: "call_1111111111111111",
        requestedScopes: [{ type: "project", id: "project-001" }],
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "DOMAIN_TOOL_OBLIGATION_UNKNOWN",
    );
  });

  it("rejects an item without a bounded AKB document context", () => {
    const withoutTags = structuredClone(budgetFixture) as {
      items: Array<{ document_context_tags: string[] }>;
    };
    withoutTags.items[0]!.document_context_tags = [];
    assert.throws(
      () => parseDomainToolResponse(withoutTags, {
        toolId: DOMAIN_TOOL_IDS.budget,
        toolCallId: "call_1111111111111111",
        requestedScopes: [{ type: "project", id: "project-001" }],
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "DOMAIN_TOOL_LIST_EMPTY",
    );

    const wrongProjectTag = structuredClone(budgetFixture) as {
      items: Array<{ document_context_tags: string[] }>;
    };
    wrongProjectTag.items[0]!.document_context_tags = ["project:project-999"];
    assert.throws(
      () => parseDomainToolResponse(wrongProjectTag, {
        toolId: DOMAIN_TOOL_IDS.budget,
        toolCallId: "call_1111111111111111",
        requestedScopes: [{ type: "project", id: "project-001" }],
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "DOMAIN_TOOL_PROJECT_TAG_MISSING",
    );
  });

  it("rejects a fact whose scalar does not match its declared type", () => {
    const mismatched = structuredClone(budgetFixture) as {
      items: Array<{ facts: Array<{ key: string; value: unknown }> }>;
    };
    mismatched.items[0]!.facts.find((fact) => fact.key === "budget.variance_amount")!.value = "1250000";
    assert.throws(
      () => parseDomainToolResponse(mismatched, {
        toolId: DOMAIN_TOOL_IDS.budget,
        toolCallId: "call_1111111111111111",
        requestedScopes: [{ type: "project", id: "project-001" }],
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "DOMAIN_TOOL_FACT_VALUE_TYPE_MISMATCH",
    );
  });

  it("rejects a source-specific fact outside the closed tool catalog", () => {
    const unsupported = structuredClone(budgetFixture) as {
      items: Array<{ facts: Array<{ key: string }> }>;
    };
    unsupported.items[0]!.facts[0]!.key = "contract.risk_level";
    assert.throws(
      () => parseDomainToolResponse(unsupported, {
        toolId: DOMAIN_TOOL_IDS.budget,
        toolCallId: "call_1111111111111111",
        requestedScopes: [{ type: "project", id: "project-001" }],
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "DOMAIN_TOOL_FACT_KEY_UNSUPPORTED",
    );
  });

  it("binds each fact key to its exact value type and validates scalar metadata", () => {
    const wrongType = structuredClone(budgetFixture) as {
      items: Array<{ facts: Array<{ value_type: string }> }>;
    };
    wrongType.items[0]!.facts[0]!.value_type = "number";
    assert.throws(
      () => parseDomainToolResponse(wrongType, {
        toolId: DOMAIN_TOOL_IDS.budget,
        toolCallId: "call_1111111111111111",
        requestedScopes: [{ type: "project", id: "project-001" }],
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "DOMAIN_TOOL_FACT_TYPE_UNSUPPORTED",
    );

    const stringQuality = structuredClone(budgetFixture) as {
      items: Array<{ facts: Array<{ quality: unknown }> }>;
    };
    stringQuality.items[0]!.facts[0]!.quality = "1";
    assert.throws(
      () => parseDomainToolResponse(stringQuality, {
        toolId: DOMAIN_TOOL_IDS.budget,
        toolCallId: "call_1111111111111111",
        requestedScopes: [{ type: "project", id: "project-001" }],
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "DOMAIN_TOOL_FACT_QUALITY_INVALID",
    );

    const overRequestedLimit = structuredClone(budgetFixture) as {
      items: unknown[];
    };
    overRequestedLimit.items.push(structuredClone(overRequestedLimit.items[0]));
    assert.throws(
      () => parseDomainToolResponse(overRequestedLimit, {
        toolId: DOMAIN_TOOL_IDS.budget,
        toolCallId: "call_1111111111111111",
        requestedScopes: [{ type: "project", id: "project-001" }],
        maxItems: 1,
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "DOMAIN_TOOL_ITEMS_LIMIT",
    );
  });

  it("requires a complete single-currency Budget snapshot with actual xor forecast", () => {
    const missingName = structuredClone(budgetFixture) as {
      items: Array<{ facts: Array<{ key: string; currency?: string | null }> }>;
    };
    missingName.items[0]!.facts = missingName.items[0]!.facts.filter(
      (fact) => fact.key !== "project.display_name",
    );
    assert.throws(
      () => parseBudget(missingName),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "BUDGET_FINANCIAL_FACT_MISSING",
    );

    const actualAndForecast = structuredClone(budgetFixture) as {
      items: Array<{ facts: Array<Record<string, unknown>> }>;
    };
    actualAndForecast.items[0]!.facts.push({
      key: "budget.actual_amount",
      value: 10_500_000,
      value_type: "currency",
      unit: null,
      currency: "CZK",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      quality: 1,
    });
    assert.throws(
      () => parseBudget(actualAndForecast),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "BUDGET_ACTUAL_FORECAST_INVALID",
    );

    const mixedCurrencies = structuredClone(budgetFixture) as {
      items: Array<{ facts: Array<{ key: string; currency?: string | null }> }>;
    };
    mixedCurrencies.items[0]!.facts.find(
      (fact) => fact.key === "budget.forecast_amount",
    )!.currency = "EUR";
    assert.throws(
      () => parseBudget(mixedCurrencies),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "BUDGET_CURRENCY_CONFLICT",
    );

    const zeroPlan = structuredClone(budgetFixture) as {
      items: Array<{ facts: Array<{ key: string; value: unknown }> }>;
    };
    zeroPlan.items[0]!.facts = zeroPlan.items[0]!.facts.filter(
      (fact) => fact.key !== "budget.variance_percent",
    );
    zeroPlan.items[0]!.facts.find(
      (fact) => fact.key === "budget.plan_amount",
    )!.value = 0;
    assert.equal(parseBudget(zeroPlan).status, "complete");
  });

  it("keeps missing Budget data separate from scope and policy denials", () => {
    const missingPlan = emptyBudgetResponse(
      "complete",
      "BUDGET_APPROVED_PLAN_MISSING",
    );
    assert.equal(parseBudget(missingPlan).status, "complete");

    const scopeDenied = emptyBudgetResponse(
      "not_authorized",
      "BUDGET_SCOPE_NOT_COVERED",
    );
    assert.equal(parseBudget(scopeDenied).status, "not_authorized");

    assert.throws(
      () => parseBudget({
        ...missingPlan,
        status: "not_authorized",
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "BUDGET_DATA_WARNING_STATUS_INVALID",
    );
    assert.throws(
      () => parseBudget({
        ...scopeDenied,
        status: "complete",
      }),
      (error: unknown) => error instanceof DirectorCopilotContractError
        && error.code === "BUDGET_DENIAL_STATUS_INVALID",
    );
  });
});

function parseBudget(value: unknown) {
  return parseDomainToolResponse(value, {
    toolId: DOMAIN_TOOL_IDS.budget,
    toolCallId: "call_1111111111111111",
    requestedScopes: [{ type: "project", id: "project-001" }],
    nowMs: Date.parse("2026-07-21T10:01:00Z"),
  });
}

function emptyBudgetResponse(status: string, warning: string) {
  return {
    ...structuredClone(budgetFixture),
    status,
    items: [],
    warnings: [warning],
  };
}
