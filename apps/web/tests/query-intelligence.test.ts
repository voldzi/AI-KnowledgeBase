import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildQueryRecoveryCandidates,
  buildQueryIntelligenceResponse,
  validateQueryText,
} from "../src/lib/intelligence/query-intelligence";
import type {
  AnalystCase,
  Document,
  EntityFacetReport,
  QueryComposerTokenInput,
} from "../src/lib/types";

const now = "2026-07-09T12:00:00Z";

const documents: Document[] = [
  {
    document_id: "doc_109",
    title: "Směrnice RMO 12/2024 pro řízení AI",
    document_type: "directive",
    status: "valid",
    classification: "internal",
    owner_id: "owner_1",
    owner: "Knowledge Ops",
    gestor_unit: "Sekce řízení",
    tags: ["ai", "rmo"],
    metadata: { stratos: { external_system: "STRATOS_ARCHFLOW" } },
    created_at: now,
    updated_at: now,
  },
];

const entityFacets: EntityFacetReport = {
  status: "ready",
  index_name: "akl_document_chunks",
  total_chunks: 12,
  chunks_with_entities: 4,
  entity_types: [{ key: "document_number", label: "Document number", count: 4 }],
  entity_groups: [
    {
      entity_type: "document_number",
      label: "Document number",
      count: 4,
      values: [{ key: "RMO12/2024", label: "RMO12/2024", count: 3 }],
    },
  ],
  generated_at: now,
  warnings: [],
};

const analystCases: AnalystCase[] = [
  {
    case_id: "case_1",
    title: "RMO evidence",
    description: null,
    status: "open",
    owner_id: "analyst_1",
    classification: "internal",
    tags: ["rmo"],
    metadata: {},
    saved_queries: [
      {
        saved_query_id: "qry_1",
        case_id: "case_1",
        title: "RMO fielded",
        query_text: "title:RMO AND entity:RMO12/2024",
        query_mode: "fielded",
        search_fields: ["title", "entity"],
        filters: {},
        created_by: "analyst_1",
        created_at: now,
      },
    ],
    evidence_items: [],
    created_at: now,
    updated_at: now,
  },
];

describe("query intelligence", () => {
  it("builds permission-scoped suggestions from documents, entities, and cases", () => {
    const response = buildQueryIntelligenceResponse({
      input: "RMO",
      tokens: [],
      documents,
      entityFacets,
      cases: analystCases,
      activeCaseId: "case_1",
      language: "cs",
      limit: 20,
    });

    assert.equal(response.status, "ready");
    assert.ok(response.suggestions.some((suggestion) => suggestion.query_fragment === "title:RMO"));
    assert.ok(response.suggestions.some((suggestion) => suggestion.query_fragment === 'entity:"RMO12/2024"'));
    assert.ok(response.suggestions.some((suggestion) => suggestion.query_fragment === "title:RMO AND entity:RMO12/2024"));
    assert.ok(!response.suggestions.some((suggestion) => suggestion.label.includes("Secret")));
  });

  it("infers fielded plans from composed visual tokens", () => {
    const tokens: QueryComposerTokenInput[] = [
      {
        id: "token_1",
        type: "field",
        label: "Název: RMO",
        value: "RMO",
        query_fragment: "title:RMO",
        field: "title",
        mode: "fielded",
      },
      {
        id: "token_2",
        type: "operator",
        label: "AND",
        value: "AND",
        query_fragment: "AND",
        mode: "boolean",
      },
      {
        id: "token_3",
        type: "entity",
        label: "RMO12/2024",
        value: "RMO12/2024",
        query_fragment: "entity:RMO12/2024",
        field: "entity",
        mode: "fielded",
      },
    ];

    const response = buildQueryIntelligenceResponse({
      input: "",
      tokens,
      documents,
      entityFacets,
      cases: [],
      language: "cs",
    });

    assert.equal(response.plan.query_text, "title:RMO AND entity:RMO12/2024");
    assert.equal(response.plan.query_mode, "fielded");
    assert.deepEqual(response.plan.search_fields, ["title", "entity"]);
    assert.equal(response.plan.can_run, true);
    assert.equal(response.preview.status, "idle");
  });

  it("blocks unsafe or malformed query syntax before search execution", () => {
    const issues = validateQueryText('title:"RMO AND *správce', [], "cs");

    assert.ok(issues.some((issue) => issue.code === "UNBALANCED_QUOTES" && issue.severity === "error"));
    assert.ok(issues.some((issue) => issue.code === "LEADING_WILDCARD" && issue.severity === "error"));
  });

  it("builds safe broadening actions for a zero-result fielded query", () => {
    const response = buildQueryIntelligenceResponse({
      input: 'title:"technický správce" AND entity:RMO12/2024',
      tokens: [],
      documents,
      entityFacets,
      cases: [],
      language: "cs",
    });

    const candidates = buildQueryRecoveryCandidates(response.plan, "cs");

    assert.equal(candidates[0]?.query_mode, "smart");
    assert.equal(candidates[0]?.query_text, "technický správce RMO12/2024");
    assert.ok(candidates.some((candidate) => candidate.query_mode === "boolean"));
    assert.ok(candidates.every((candidate) => candidate.search_fields[0] === "all"));
  });
});
