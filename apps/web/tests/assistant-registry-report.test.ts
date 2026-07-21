import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Document } from "../src/lib/types";
import {
  buildRegistryDocumentReportFromSummary,
  buildRegistryDocumentReport,
  extractRegistryDocumentTypeFilter,
  isRegistryDocumentReportQuestion,
  registryTopicsForDocumentListRequest,
  registryReportKindFromMessage,
  registryDocumentTypeFilterForReport,
  summarizeRegistryReportForAudit
} from "../src/lib/reporting/assistant-registry-report";

const now = "2026-06-22T08:00:00Z";

function documentFixture(input: Partial<Document> & Pick<Document, "document_id" | "title">): Document {
  return {
    document_id: input.document_id,
    title: input.title,
    document_type: input.document_type ?? "methodology",
    status: input.status ?? "valid",
    classification: input.classification ?? "internal",
    owner_id: input.owner_id ?? "owner_1",
    owner: input.owner ?? "Owner",
    gestor_unit: input.gestor_unit ?? "IT",
    tags: input.tags ?? [],
    metadata: input.metadata ?? {},
    assignments: input.assignments ?? [],
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now
  };
}

describe("assistant registry report", () => {
  it("builds a permission-scoped inventory table for Czech topic count requests", () => {
    const documents: Document[] = [
      documentFixture({
        document_id: "doc_digital_1",
        title: "Metodika digitalizace služeb",
        document_type: "methodology",
        tags: ["digitalizace", "ICT"]
      }),
      documentFixture({
        document_id: "doc_project_1",
        title: "Metodika řízení projektů",
        document_type: "project_documentation",
        tags: ["projectflow", "projektové řízení"]
      }),
      documentFixture({
        document_id: "doc_shared_1",
        title: "Digitalizace projektového řízení",
        document_type: "manual",
        status: "approved",
        tags: ["digital governance", "project management"]
      }),
      documentFixture({
        document_id: "doc_contract_1",
        title: "Smlouva o podpoře aplikace",
        document_type: "contract",
        tags: ["smlouvy"]
      })
    ];

    const message = "Kolik máš dokumentů na téma digitalizace, řízení projektů, vytvoř do tabulky";
    const response = buildRegistryDocumentReport({
      message,
      conversationId: "conv_test",
      context: { app: "akb-chat" },
      language: "cs",
      documents
    });

    assert.ok(isRegistryDocumentReportQuestion(message));
    assert.ok(response);
    assert.equal(response.conversation_id, "conv_test");
    assert.equal(response.report_artifacts.length, 1);
    assert.deepEqual(response.report_artifacts[0]?.export_formats, []);

    const rows = response.report_artifacts[0]?.rows ?? [];
    const digitalization = rows.find((row) => row.cells.topic === "digitalizace");
    const projectManagement = rows.find((row) => row.cells.topic === "řízení projektů");

    assert.equal(digitalization?.cells.document_count, 2);
    assert.equal(projectManagement?.cells.document_count, 2);
    assert.match(response.answer ?? "", /Zkontroloval jsem 4 dokumentů/);
    assert.equal(response.citations.length, 0);
    assert.equal(response.current_context.answer_source, "registry_metadata");

    const auditSummary = summarizeRegistryReportForAudit(response, message, documents.length);
    assert.equal(auditSummary?.documentCount, 3);
    assert.equal(auditSummary?.scannedDocumentCount, 4);
    assert.equal(auditSummary?.topicCount, 2);
    assert.match(auditSummary?.messageHash ?? "", /^[a-f0-9]{64}$/);
  });

  it("does not intercept content interpretation questions", () => {
    assert.equal(isRegistryDocumentReportQuestion("Jaký postup schvalování vyplývá ze smlouvy?"), false);
    assert.equal(isRegistryDocumentReportQuestion("Vytvoř sestavu z obsahu smlouvy o podpoře."), false);
    assert.equal(isRegistryDocumentReportQuestion("Vytvoř tabulku kde bude seznam povinností."), false);
    assert.equal(isRegistryDocumentReportQuestion("Vytvoř tabulku povinností podle citovaných zdrojů."), false);
    assert.equal(isRegistryDocumentReportQuestion("Seznam smluv vytvoř do tabulky."), true);
    assert.equal(isRegistryDocumentReportQuestion("Vytvoř tabulku smluv."), true);
    assert.equal(isRegistryDocumentReportQuestion("Jakého typu jsou dokumenty, které máš k dispozici?"), true);
    assert.equal(isRegistryDocumentReportQuestion("Ok vytvoř tedy sestavu, kde bude typ počet"), true);
    assert.equal(registryReportKindFromMessage("Seznam smluv vytvoř do tabulky."), "document_list");
    assert.equal(registryReportKindFromMessage("Vytvoř tabulku smluv."), "document_list");
    assert.equal(registryReportKindFromMessage("Jakého typu jsou dokumenty, které máš k dispozici?"), "document_type_count");
    assert.equal(registryReportKindFromMessage("Ok vytvoř tedy sestavu, kde bude typ počet"), "document_type_count");
    assert.equal(registryReportKindFromMessage("Kolik máme smluv?"), "document_inventory_summary");
    assert.equal(registryDocumentTypeFilterForReport("Kolik máme smluv?", "document_inventory_summary"), "contract");
    assert.equal(registryDocumentTypeFilterForReport("Kolik máme smluv?", "document_type_count"), null);
    assert.deepEqual(registryTopicsForDocumentListRequest("Kolik máme smluv?", ["smlouvy"], "cs"), []);
  });

  it("returns an exact and direct permission-scoped contract count", () => {
    const response = buildRegistryDocumentReportFromSummary({
      message: "Kolik máme smluv?",
      conversationId: "conv_contract_count",
      language: "cs",
      summary: {
        total_visible_documents: 142,
        total_matched_documents: 142,
        topics: [{
          topic: "všechny dokumenty",
          document_count: 142,
          valid_or_approved_count: 142,
          document_types: [{ key: "contract", label: "contract", count: 142 }],
          classifications: [{ key: "internal", label: "internal", count: 142 }],
          statuses: [{ key: "valid", label: "valid", count: 142 }],
          owners: [{ key: "Sekce IT", label: "Sekce IT", count: 142 }],
          example_documents: ["Servisní smlouva"]
        }],
        by_document_type: [{ key: "contract", label: "contract", count: 142 }],
        by_classification: [],
        by_status: [],
        by_owner: [],
        warnings: ["REGISTRY_METADATA_SUMMARY"]
      }
    });

    assert.ok(response);
    assert.equal(response.answer, "V AKB máte v rozsahu svých oprávnění 142 smluv.");
    assert.equal(response.report_artifacts[0]?.rows[0]?.cells.topic, "smlouvy");
    assert.equal(response.report_artifacts[0]?.rows[0]?.cells.document_count, 142);
  });

  it("builds a document list artifact for natural language list requests", () => {
    const documents: Document[] = [
      documentFixture({
        document_id: "doc_contract_1",
        title: "Smlouva o podpoře aplikace",
        document_type: "contract",
        owner_id: "owner_budget",
        gestor_unit: "Budget",
        tags: ["smlouvy", "budget-contract:contract-1"],
        metadata: {
          external: {
            external_system: "STRATOS_BUDGET",
            entity_type: "contract",
            entity_id: "contract-1"
          }
        }
      }),
      documentFixture({
        document_id: "doc_policy_1",
        title: "Metodika digitalizace",
        document_type: "methodology",
        tags: ["digitalizace"]
      })
    ];

    const response = buildRegistryDocumentReport({
      message: "Seznam smluv vytvoř do tabulky",
      conversationId: "conv_list",
      context: { external_system: "STRATOS_BUDGET" },
      language: "cs",
      documents
    });

    assert.ok(response);
    assert.equal(response.current_context.report_kind, "document_list");
    assert.equal(response.current_context.registry_report_matched_document_count, 1);
    assert.equal(response.report_artifacts[0]?.title, "Seznam dokumentů");
    assert.equal(response.report_artifacts[0]?.columns[0]?.key, "document_id");
    assert.equal(response.report_artifacts[0]?.rows[0]?.cells.title, "Smlouva o podpoře aplikace");
    assert.equal(response.report_artifacts[0]?.rows[0]?.cells.external_system, "STRATOS_BUDGET");
    assert.equal(response.report_artifacts[0]?.rows[0]?.cells.entity, "contract: contract-1");
    assert.deepEqual(response.report_artifacts[0]?.export_formats, []);
  });

  it("builds follow-up contract lists from document type metadata, not topic text", () => {
    const documents: Document[] = [
      documentFixture({
        document_id: "doc_contract_1",
        title: "Servisní rámcový dokument A",
        document_type: "contract",
        tags: ["budget-contract:contract-1"],
        metadata: {
          description: "Rámcová smlouva pro servis a provoz aplikační podpory."
        }
      }),
      documentFixture({
        document_id: "doc_methodology_1",
        title: "Metodika nákupu služeb",
        document_type: "methodology",
        tags: ["budget"]
      })
    ];
    const message = "Udělej tabulku smluv vlevo název, vpravo stručný popis";

    const response = buildRegistryDocumentReport({
      message,
      conversationId: "conv_contract_followup",
      context: {
        answer_source: "registry_metadata",
        report_kind: "document_type_count"
      },
      language: "cs",
      documents
    });

    assert.equal(extractRegistryDocumentTypeFilter(message), "contract");
    assert.deepEqual(registryTopicsForDocumentListRequest(message, ["smlouvy"], "cs"), []);
    assert.ok(response);
    assert.equal(response.current_context.report_kind, "document_list");
    assert.equal(response.current_context.registry_report_matched_document_count, 1);
    assert.deepEqual(response.report_artifacts[0]?.columns.map((column) => column.key), ["title", "description"]);
    assert.equal(response.report_artifacts[0]?.rows[0]?.cells.title, "Servisní rámcový dokument A");
    assert.equal(
      response.report_artifacts[0]?.rows[0]?.cells.description,
      "Rámcová smlouva pro servis a provoz aplikační podpory."
    );
  });

  it("builds the same report artifact from registry metadata summary", () => {
    const response = buildRegistryDocumentReportFromSummary({
      message: "Kolik máme dokumentů na téma digitalizace?",
      conversationId: "conv_summary",
      language: "cs",
      summary: {
        total_visible_documents: 12,
        total_matched_documents: 3,
        topics: [
          {
            topic: "digitalizace",
            document_count: 3,
            valid_or_approved_count: 2,
            document_types: [{ key: "methodology", label: "methodology", count: 2 }],
            classifications: [{ key: "internal", label: "internal", count: 3 }],
            statuses: [{ key: "valid", label: "valid", count: 2 }],
            owners: [{ key: "IT", label: "IT", count: 3 }],
            example_documents: ["Metodika digitalizace"]
          }
        ],
        by_document_type: [],
        by_classification: [],
        by_status: [],
        by_owner: [],
        warnings: ["REGISTRY_METADATA_SUMMARY"]
      }
    });

    assert.ok(response);
    assert.equal(response.current_context.answer_source, "registry_metadata_summary");
    assert.equal(response.current_context.registry_report_scanned_document_count, 12);
    assert.equal(response.current_context.registry_report_matched_document_count, 3);
    assert.equal(response.report_artifacts[0]?.rows[0]?.cells.document_count, 3);
    assert.equal(response.report_artifacts[0]?.warnings.includes("REGISTRY_METADATA_SUMMARY"), true);
  });

  it("builds a document type count report from registry metadata summary", () => {
    const response = buildRegistryDocumentReportFromSummary({
      message: "Jakého typu jsou dokumenty, které máš k dispozici?",
      conversationId: "conv_type_summary",
      language: "cs",
      summary: {
        total_visible_documents: 6,
        total_matched_documents: 6,
        topics: [
          {
            topic: "všechny dokumenty",
            document_count: 6,
            valid_or_approved_count: 5,
            document_types: [
              { key: "methodology", label: "methodology", count: 3 },
              { key: "contract", label: "contract", count: 2 },
              { key: "policy", label: "policy", count: 1 }
            ],
            classifications: [{ key: "internal", label: "internal", count: 6 }],
            statuses: [{ key: "valid", label: "valid", count: 5 }],
            owners: [{ key: "IT", label: "IT", count: 6 }],
            example_documents: ["Metodika digitalizace"]
          }
        ],
        by_document_type: [],
        by_classification: [],
        by_status: [],
        by_owner: [],
        warnings: ["REGISTRY_METADATA_SUMMARY"]
      }
    });

    assert.ok(response);
    assert.equal(response.current_context.report_kind, "document_type_count");
    assert.equal(response.current_context.registry_report_matched_document_count, 6);
    assert.equal(response.report_artifacts[0]?.title, "Dokumenty podle typu");
    assert.equal(response.report_artifacts[0]?.columns[0]?.key, "document_type");
    assert.equal(response.report_artifacts[0]?.rows.length, 3);
    assert.equal(response.report_artifacts[0]?.rows[0]?.cells.document_type, "metodika");
    assert.equal(response.report_artifacts[0]?.rows[0]?.cells.document_count, 3);
    assert.equal(response.report_artifacts[0]?.rows[0]?.cells.share, "50 %");
    assert.match(response.answer ?? "", /typů dokumentů/);
  });
});
