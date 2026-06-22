import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Document } from "../src/lib/types";
import {
  buildRegistryDocumentReportFromSummary,
  buildRegistryDocumentReport,
  isRegistryDocumentReportQuestion,
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
    assert.equal(response.report_artifacts[0]?.export_formats.includes("xlsx"), true);
    assert.equal(response.report_artifacts[0]?.export_formats.includes("pdf"), true);

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
    assert.equal(isRegistryDocumentReportQuestion("Seznam smluv vytvoř do tabulky."), true);
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
});
