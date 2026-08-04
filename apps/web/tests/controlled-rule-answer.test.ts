import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildControlledRuleAssistantResponse } from "../src/lib/assistant/controlled-rule-answer";
import type { ControlledRuleList } from "../src/lib/types";

describe("controlled rule assistant answer", () => {
  it("returns only verified consumer-eligible rules with source citations", () => {
    const response = buildControlledRuleAssistantResponse({
      message: "Jaký je limit pro veřejnou zakázku malého rozsahu?",
      conversationId: "conv_1",
      context: {},
      language: "cs",
      result: fixture(),
    });

    assert.equal(response.response_type, "answer");
    assert.equal(response.confidence, "high");
    assert.match(response.answer ?? "", /100\s000 Kč/);
    assert.doesNotMatch(response.answer ?? "", /neschválené/i);
    assert.equal(response.citations.length, 1);
    assert.equal(response.citations[0]?.document_id, "doc_directive");
    assert.deepEqual(response.current_context.controlled_rule_ids, ["rule_limit"]);
  });

  it("fails closed when a matching conflict exists", () => {
    const data = fixture();
    data.rules.push({
      ...data.rules[0]!,
      extraction_id: "extract_conflict",
      precedence_status: "conflict",
      consumer_eligible: false,
    });
    const response = buildControlledRuleAssistantResponse({
      message: "Jaký je limit pro veřejnou zakázku?",
      conversationId: "conv_1",
      context: {},
      language: "cs",
      result: data,
    });

    assert.equal(response.response_type, "no_answer");
    assert.equal(response.confidence, "conflicting_sources");
    assert.deepEqual(response.citations, []);
    assert.ok(response.warnings.includes("CONTROLLED_RULE_CONFLICT"));
  });

  it("answers a market-research question with only the relevant human-readable rules", () => {
    const data = fixture();
    data.rules = [
      controlledRule({
        ruleId: "rule_market_research",
        normativeKey: "public_procurement.market_research.threshold",
        title: "Finanční limit: dlouhý technický název",
        value: 20000,
        unit: "currency",
        currency: "CZK",
        vatBasis: "including_vat",
      }),
      controlledRule({
        ruleId: "rule_quotes",
        normativeKey: "public_procurement.supplier_quotes.minimum_count",
        title: "Pravidlo: několik dodavatelů",
        value: 3,
        unit: "count",
        currency: null,
      }),
      controlledRule({
        ruleId: "rule_marketplace",
        normativeKey: "public_procurement.marketplace.threshold",
        title: "Elektronické tržiště",
        value: 50000,
        unit: "currency",
        currency: "CZK",
      }),
    ];

    const response = buildControlledRuleAssistantResponse({
      message: "Jaký limit platí pro průzkum trhu a kolik nabídek je potřeba?",
      conversationId: "conv_market_research",
      context: {},
      language: "cs",
      result: data,
    });

    assert.equal(response.response_type, "answer");
    assert.deepEqual(response.current_context.controlled_rule_ids, [
      "rule_market_research",
      "rule_quotes",
    ]);
    assert.match(response.answer ?? "", /Limit průzkumu trhu.*20\s000 Kč včetně DPH/s);
    assert.match(response.answer ?? "", /Minimální počet nabídek.*nejméně 3 nabídky/s);
    assert.doesNotMatch(response.answer ?? "", /elektronického tržiště/i);
    assert.doesNotMatch(response.answer ?? "", /CZK currency|count/i);
    assert.equal(response.citations.length, 2);
  });

  it("fails closed when the Registry consumer projection is not decision-ready", () => {
    const data = fixture();
    data.warnings = ["CONTROLLED_RULE_NORMATIVE_KEY_UNKNOWN"];

    const response = buildControlledRuleAssistantResponse({
      message: "Jaký je limit pro veřejnou zakázku?",
      conversationId: "conv_blocked",
      context: {},
      language: "cs",
      result: data,
    });

    assert.equal(response.response_type, "no_answer");
    assert.equal(response.confidence, "conflicting_sources");
    assert.deepEqual(response.citations, []);
    assert.ok(response.warnings.includes("CONTROLLED_RULE_CONFLICT"));
  });
});

function controlledRule(input: {
  ruleId: string;
  normativeKey: string;
  title: string;
  value: unknown;
  unit: string | null;
  currency: string | null;
  vatBasis?: string;
}): ControlledRuleList["rules"][number] {
  return {
    extraction_id: "extract_current",
    package_id: "package_1",
    source_type: "internal_directive",
    authority_rank: 60,
    verification_status: "accepted",
    verified_by: "gestor",
    verified_at: "2026-08-01T10:00:00Z",
    verification_note: null,
    precedence_status: "supplemental",
    consumer_eligible: true,
    proposal: {
      rule_id: input.ruleId,
      normative_key: input.normativeKey,
      category: input.normativeKey.endsWith("minimum_count") ? "condition" : "financial_limit",
      title: input.title,
      value: input.value,
      unit: input.unit,
      currency: input.currency,
      vat_basis: input.vatBasis ?? "excluding_vat",
      conditions: [],
      exceptions: [],
      responsible_roles: [],
      required_evidence: [],
      confidence: 0.93,
      citation: {
        document_id: "doc_directive",
        document_version_id: "ver_directive",
        chunk_id: `chunk_${input.ruleId}`,
        section_path: ["Článek 6"],
        page_number: 8,
        article_number: "6",
        paragraph_number: null,
        quoted_text: input.title,
      },
    },
  };
}

function fixture(): ControlledRuleList {
  return {
    domain: "public_procurement",
    valid_on: "2026-08-03",
    warnings: [],
    packages: [{
      package_id: "package_1",
      organization_id: "org_stratos",
      package_key: "directive-2-2023",
      release_label: "1.1",
      title: "Směrnice č. 2/2023",
      domain: "public_procurement",
      source_type: "internal_directive",
      authority_rank: 60,
      status: "valid",
      effective_from: "2023-05-30",
      effective_to: null,
      primary_document_id: "doc_directive",
      primary_document_version_id: "ver_directive",
      replaces_package_id: null,
      owner_id: "gestor",
      approved_by: "approver",
      approved_at: "2026-08-01T10:00:00Z",
      metadata: {},
      members: [],
      created_at: "2026-08-01T09:00:00Z",
      updated_at: "2026-08-01T10:00:00Z",
    }],
    rules: [
      {
        extraction_id: "extract_1",
        package_id: "package_1",
        source_type: "internal_directive",
        authority_rank: 60,
        verification_status: "accepted",
        verified_by: "gestor",
        verified_at: "2026-08-01T10:00:00Z",
        verification_note: null,
        precedence_status: "supplemental",
        consumer_eligible: true,
        proposal: {
          rule_id: "rule_limit",
          normative_key: "public_procurement.vzmr.limit",
          category: "financial_limit",
          title: "Limit veřejné zakázky malého rozsahu",
          value: 100000,
          unit: null,
          currency: "Kč",
          vat_basis: "without_vat",
          conditions: ["Limit platí bez DPH."],
          exceptions: [],
          responsible_roles: ["příkazce operace"],
          required_evidence: [],
          confidence: 0.93,
          citation: {
            document_id: "doc_directive",
            document_version_id: "ver_directive",
            chunk_id: "chunk_limit",
            section_path: ["Článek 5"],
            page_number: 5,
            article_number: "5",
            paragraph_number: null,
            quoted_text: "Limit činí 100 000 Kč bez DPH.",
          },
        },
      },
      {
        extraction_id: "extract_unapproved",
        package_id: "package_1",
        source_type: "internal_directive",
        authority_rank: 60,
        verification_status: "proposed",
        verified_by: null,
        verified_at: null,
        verification_note: null,
        precedence_status: "supplemental",
        consumer_eligible: false,
        proposal: {
          rule_id: "rule_unapproved",
          normative_key: "public_procurement.unapproved",
          category: "financial_limit",
          title: "Neschválené pravidlo",
          value: 20000,
          unit: null,
          currency: "Kč",
          vat_basis: "without_vat",
          conditions: [],
          exceptions: [],
          responsible_roles: [],
          required_evidence: [],
          confidence: 0.99,
          citation: {
            document_id: "doc_directive",
            document_version_id: "ver_directive",
            chunk_id: "chunk_unapproved",
            section_path: [],
            page_number: 6,
            article_number: null,
            paragraph_number: null,
            quoted_text: "Neschválený návrh.",
          },
        },
      },
    ],
  };
}
