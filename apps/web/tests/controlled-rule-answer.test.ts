import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildControlledRuleAssistantResponse,
  currentControlledRuleDate,
} from "../src/lib/assistant/controlled-rule-answer";
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

  it("answers a general VZMR question with both statutory thresholds before internal rules", () => {
    const data = fixture();
    data.rules = [
      controlledRule({
        ruleId: "rule_supplies_services",
        normativeKey: "public_procurement.vzmr.supplies_services.threshold",
        title: "Statutory supplies and services threshold",
        value: 3000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_works",
        normativeKey: "public_procurement.vzmr.works.threshold",
        title: "Statutory works threshold",
        value: 9000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_market_research",
        normativeKey: "public_procurement.market_research.threshold",
        title: "Internal market research threshold",
        value: 20000,
        unit: "currency",
        currency: "CZK",
      }),
    ];

    const response = buildControlledRuleAssistantResponse({
      message: "Jaké jsou limity pro VZMR?",
      conversationId: "conv_vzmr",
      context: {},
      language: "cs",
      result: data,
    });

    assert.equal(response.response_type, "answer");
    assert.deepEqual(response.current_context.controlled_rule_ids, [
      "rule_supplies_services",
      "rule_works",
      "rule_market_research",
    ]);
    assert.match(response.answer ?? "", /Zákonné limity účinné/);
    assert.match(response.answer ?? "", /dodávky a služby.*3\s000\s000 Kč/s);
    assert.match(response.answer ?? "", /stavební práce.*9\s000\s000 Kč/s);
    assert.match(response.answer ?? "", /Doplňující interní pravidla/);
    assert.match(response.answer ?? "", /průzkumu trhu.*20\s000 Kč/s);
    assert.equal(response.citations.length, 3);
  });

  it("keeps an explicit statutory VZMR overview separate from internal procedures", () => {
    const data = fixture();
    data.rules = [
      controlledRule({
        ruleId: "rule_supplies_services",
        normativeKey: "public_procurement.vzmr.supplies_services.threshold",
        title: "Statutory supplies and services threshold",
        value: 3000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_market_research",
        normativeKey: "public_procurement.market_research.threshold",
        title: "Internal market research threshold",
        value: 20000,
        unit: "currency",
        currency: "CZK",
      }),
    ];

    const response = buildControlledRuleAssistantResponse({
      message: "Jaké jsou zákonné limity pro VZMR?",
      conversationId: "conv_vzmr_law",
      context: {},
      language: "cs",
      result: data,
    });

    assert.deepEqual(response.current_context.controlled_rule_ids, [
      "rule_supplies_services",
    ]);
    assert.doesNotMatch(response.answer ?? "", /průzkumu trhu/i);
  });

  it("keeps an explicit internal-directive overview separate from statutory limits", () => {
    const data = fixture();
    data.rules = [
      controlledRule({
        ruleId: "rule_supplies_services",
        normativeKey: "public_procurement.vzmr.supplies_services.threshold",
        title: "Statutory supplies and services threshold",
        value: 3000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_works",
        normativeKey: "public_procurement.vzmr.works.threshold",
        title: "Statutory works threshold",
        value: 9000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_market_research",
        normativeKey: "public_procurement.market_research.threshold",
        title: "Internal market research threshold",
        value: 20000,
        unit: "currency",
        currency: "CZK",
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_marketplace",
        normativeKey: "public_procurement.marketplace.threshold",
        title: "Internal marketplace threshold",
        value: 50000,
        unit: "currency",
        currency: "CZK",
      }),
    ];

    const response = buildControlledRuleAssistantResponse({
      message: "Jaké jsou limity pro veřejné zakázky dle interních směrnic?",
      conversationId: "conv_internal_directive",
      context: {},
      language: "cs",
      result: data,
    });

    assert.equal(response.response_type, "answer");
    assert.deepEqual(response.current_context.controlled_rule_ids, [
      "rule_market_research",
      "rule_marketplace",
    ]);
    assert.deepEqual(response.current_context.controlled_rule_source_types, [
      "internal_directive",
    ]);
    assert.equal(response.current_context.controlled_rule_source_scope, "internal");
    assert.match(response.answer ?? "", /Interní pravidla účinná/);
    assert.match(response.answer ?? "", /průzkumu trhu.*20\s000 Kč/s);
    assert.match(response.answer ?? "", /elektronického tržiště.*50\s000 Kč/s);
    assert.doesNotMatch(response.answer ?? "", /Zákonné limity|3\s000\s000|9\s000\s000/);
  });

  it("returns statutory and internal sections when both sources are requested", () => {
    const data = fixture();
    data.rules = [
      controlledRule({
        ruleId: "rule_supplies_services",
        normativeKey: "public_procurement.vzmr.supplies_services.threshold",
        title: "Statutory supplies and services threshold",
        value: 3000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_market_research",
        normativeKey: "public_procurement.market_research.threshold",
        title: "Internal market research threshold",
        value: 20000,
        unit: "currency",
        currency: "CZK",
      }),
    ];

    const response = buildControlledRuleAssistantResponse({
      message: "Jaké limity VZMR stanoví zákon a interní směrnice?",
      conversationId: "conv_combined_sources",
      context: {},
      language: "cs",
      result: data,
    });

    assert.equal(response.current_context.controlled_rule_source_scope, "combined");
    assert.deepEqual(response.current_context.controlled_rule_ids, [
      "rule_supplies_services",
      "rule_market_research",
    ]);
    assert.match(response.answer ?? "", /Zákonné limity účinné/);
    assert.match(response.answer ?? "", /Doplňující interní pravidla/);
  });

  it("returns both source sections for a general combined limit question", () => {
    const data = fixture();
    data.rules = [
      controlledRule({
        ruleId: "rule_supplies_services",
        normativeKey: "public_procurement.vzmr.supplies_services.threshold",
        title: "Statutory supplies and services threshold",
        value: 3000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_market_research",
        normativeKey: "public_procurement.market_research.threshold",
        title: "Internal market research threshold",
        value: 20000,
        unit: "currency",
        currency: "CZK",
      }),
      ...Array.from({ length: 10 }, (_, index) => controlledRule({
        ruleId: `rule_supplies_services_duplicate_${index}`,
        normativeKey: "public_procurement.vzmr.supplies_services.threshold",
        title: `Statutory supplies and services threshold duplicate ${index}`,
        value: 3000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 99 - index,
        precedenceStatus: "authoritative",
      })),
      controlledRule({
        ruleId: "rule_marketplace",
        normativeKey: "public_procurement.marketplace.threshold",
        title: "Internal marketplace threshold",
        value: 50000,
        unit: "currency",
        currency: "CZK",
      }),
      controlledRule({
        ruleId: "rule_central_evidence",
        normativeKey: "public_procurement.central_evidence.threshold",
        title: "Internal central evidence threshold",
        value: 200000,
        unit: "currency",
        currency: "CZK",
      }),
    ];

    const response = buildControlledRuleAssistantResponse({
      message: "Jaké jsou limity podle zákona a interní směrnice?",
      conversationId: "conv_general_combined_sources",
      context: {},
      language: "cs",
      result: data,
    });

    assert.equal(response.current_context.controlled_rule_source_scope, "combined");
    assert.deepEqual(response.current_context.controlled_rule_ids, [
      "rule_supplies_services",
      "rule_market_research",
      "rule_marketplace",
      "rule_central_evidence",
    ]);
    assert.match(response.answer ?? "", /Zákonné limity účinné/);
    assert.match(response.answer ?? "", /Doplňující interní pravidla/);
  });

  it("keeps both source sections for the production combined wording", () => {
    const data = fixture();
    data.rules = [
      controlledRule({
        ruleId: "rule_supplies_services",
        normativeKey: "public_procurement.vzmr.supplies_services.threshold",
        title: "Statutory supplies and services threshold",
        value: 3000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_works",
        normativeKey: "public_procurement.vzmr.works.threshold",
        title: "Statutory works threshold",
        value: 9000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_market_research",
        normativeKey: "public_procurement.market_research.threshold",
        title: "Internal market research threshold",
        value: 20000,
        unit: "currency",
        currency: "CZK",
      }),
      controlledRule({
        ruleId: "rule_marketplace",
        normativeKey: "public_procurement.marketplace.threshold",
        title: "Internal marketplace threshold",
        value: 50000,
        unit: "currency",
        currency: "CZK",
      }),
    ];

    const response = buildControlledRuleAssistantResponse({
      message: "Jaké jsou zákonné a interní limity pro veřejné zakázky?",
      conversationId: "conv_production_combined_sources",
      context: {},
      language: "cs",
      result: data,
    });

    assert.equal(response.current_context.controlled_rule_source_scope, "combined");
    assert.deepEqual(response.current_context.controlled_rule_ids, [
      "rule_supplies_services",
      "rule_works",
      "rule_market_research",
      "rule_marketplace",
    ]);
    assert.match(response.answer ?? "", /Zákonné limity účinné/);
    assert.match(response.answer ?? "", /Doplňující interní pravidla/);
  });

  it("uses the Prague calendar date when UTC is still on the previous day", () => {
    assert.equal(
      currentControlledRuleDate(new Date("2026-08-09T22:30:00.000Z")),
      "2026-08-10",
    );
  });

  it("answers an explicit combined historical VZMR question with both statutory thresholds", () => {
    const data = fixture();
    data.valid_on = "2023-06-30";
    data.rules = [
      controlledRule({
        ruleId: "rule_supplies_services_2023",
        normativeKey: "public_procurement.vzmr.supplies_services.threshold",
        title: "Statutory supplies and services threshold",
        value: 2000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_works_2023",
        normativeKey: "public_procurement.vzmr.works.threshold",
        title: "Statutory works threshold",
        value: 6000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
    ];

    const response = buildControlledRuleAssistantResponse({
      message: "Jaké byly zákonné limity veřejné zakázky malého rozsahu k 30. 6. 2023 pro dodávky a služby a pro stavební práce?",
      conversationId: "conv_vzmr_2023",
      context: {},
      language: "cs",
      result: data,
    });

    assert.equal(response.response_type, "answer");
    assert.deepEqual(response.current_context.controlled_rule_ids, [
      "rule_supplies_services_2023",
      "rule_works_2023",
    ]);
    assert.match(response.answer ?? "", /dodávky a služby.*2\s000\s000 Kč/s);
    assert.match(response.answer ?? "", /stavební práce.*6\s000\s000 Kč/s);
    assert.equal(response.citations.length, 2);
  });

  it("keeps a single explicit VZMR category narrow", () => {
    const data = fixture();
    data.rules = [
      controlledRule({
        ruleId: "rule_supplies_services",
        normativeKey: "public_procurement.vzmr.supplies_services.threshold",
        title: "Statutory supplies and services threshold",
        value: 3000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_works",
        normativeKey: "public_procurement.vzmr.works.threshold",
        title: "Statutory works threshold",
        value: 9000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
    ];

    const response = buildControlledRuleAssistantResponse({
      message: "Jaký je zákonný limit VZMR pro stavební práce?",
      conversationId: "conv_vzmr_works",
      context: {},
      language: "cs",
      result: data,
    });

    assert.deepEqual(response.current_context.controlled_rule_ids, ["rule_works"]);
    assert.doesNotMatch(response.answer ?? "", /dodávky a služby/i);
  });

  it("answers a statutory follow-up from the governed catalog instead of document RAG", () => {
    const data = fixture();
    data.rules = [
      controlledRule({
        ruleId: "rule_supplies_services",
        normativeKey: "public_procurement.vzmr.supplies_services.threshold",
        title: "Statutory supplies and services threshold",
        value: 3000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
      controlledRule({
        ruleId: "rule_works",
        normativeKey: "public_procurement.vzmr.works.threshold",
        title: "Statutory works threshold",
        value: 9000000,
        unit: "currency",
        currency: "CZK",
        sourceType: "law",
        authorityRank: 100,
        precedenceStatus: "authoritative",
      }),
    ];

    const response = buildControlledRuleAssistantResponse({
      message: "A co zákon?",
      conversationId: "conv_vzmr",
      context: {
        answer_source: "controlled_rules",
        controlled_rule_domain: "public_procurement",
        controlled_rule_valid_on: "2026-08-03",
      },
      language: "cs",
      result: data,
    });

    assert.equal(response.response_type, "answer");
    assert.deepEqual(response.current_context.controlled_rule_source_types, ["law"]);
    assert.match(response.answer ?? "", /Zákonné limity účinné/);
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
  sourceType?: ControlledRuleList["rules"][number]["source_type"];
  authorityRank?: number;
  precedenceStatus?: ControlledRuleList["rules"][number]["precedence_status"];
}): ControlledRuleList["rules"][number] {
  return {
    extraction_id: "extract_current",
    package_id: "package_1",
    source_type: input.sourceType ?? "internal_directive",
    authority_rank: input.authorityRank ?? 60,
    verification_status: "accepted",
    verified_by: "gestor",
    verified_at: "2026-08-01T10:00:00Z",
    verification_note: null,
    precedence_status: input.precedenceStatus ?? "supplemental",
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
