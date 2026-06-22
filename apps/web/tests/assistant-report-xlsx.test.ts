import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assistantReportPdfMimeType,
  buildAssistantReportPdf,
  safeAssistantReportPdfFilename
} from "../src/lib/reporting/assistant-report-pdf";
import {
  buildAssistantReportXlsx,
  normalizeAssistantReportArtifact,
  safeAssistantReportFilename
} from "../src/lib/reporting/assistant-report-xlsx";

describe("assistant report xlsx export", () => {
  it("builds bounded xlsx and pdf files with report and citation content", () => {
    const report = normalizeAssistantReportArtifact({
      artifact_id: "rpt_test",
      title: "Seznam povinností",
      description: "Tabulková sestava s citacemi.",
      columns: [
        { key: "topic", label: "Téma", type: "text" },
        { key: "summary", label: "Závěr", type: "text" },
        { key: "page", label: "Strana", type: "number" }
      ],
      rows: [
        {
          row_id: "row_1",
          cells: {
            topic: "Výjimka ze směrnice",
            summary: "Schvaluje gestor dokumentu.",
            page: 7
          },
          citations: [
            {
              document_id: "doc_123",
              document_version_id: "ver_456",
              document_title: "Směrnice pro správu dokumentů",
              version_label: "1.0",
              document_version: "1.0",
              section_path: ["Čl. 4", "Odst. 2"],
              page_number: 7,
              chunk_id: "chunk_789"
            }
          ]
        }
      ],
      export_formats: ["xlsx", "pdf"],
      source_citation_count: 1,
      warnings: []
    });

    const workbook = buildAssistantReportXlsx(report);
    const workbookContent = workbook.toString("utf-8");
    const pdf = buildAssistantReportPdf(report);
    const pdfContent = pdf.toString("latin1");

    assert.equal(workbook.subarray(0, 2).toString("utf-8"), "PK");
    assert.ok(workbookContent.includes("xl/worksheets/sheet1.xml"));
    assert.ok(workbookContent.includes("xl/worksheets/sheet2.xml"));
    assert.ok(workbookContent.includes("Seznam povinností"));
    assert.ok(workbookContent.includes("chunk_789"));
    assert.equal(pdf.subarray(0, 5).toString("utf-8"), "%PDF-");
    assert.ok(pdfContent.includes("xref"));
    assert.ok(pdfContent.includes("trailer"));
    assert.ok(pdfContent.includes("chunk_789"));
    assert.equal(assistantReportPdfMimeType(), "application/pdf");
    assert.equal(safeAssistantReportFilename(report), "Seznam-povinnosti.xlsx");
    assert.equal(safeAssistantReportPdfFilename(report), "Seznam-povinnosti.pdf");
  });

  it("rejects unbounded report payloads", () => {
    assert.throws(
      () => normalizeAssistantReportArtifact({
        artifact_id: "rpt_test",
        title: "Invalid",
        columns: [],
        rows: []
      }),
      /columns/
    );
  });

  it("rejects one-column report artifacts before export", () => {
    assert.throws(
      () => normalizeAssistantReportArtifact({
        artifact_id: "rpt_one_column",
        title: "Seznam povinností",
        columns: [{ key: "obligation", label: "Povinnost", type: "text" }],
        rows: [
          {
            row_id: "row_1",
            cells: { obligation: "právní povinnosti" },
            citations: []
          }
        ],
        warnings: []
      }),
      /at least two/
    );
  });

  it("rejects generic cited-answer summary artifacts", () => {
    assert.throws(
      () => normalizeAssistantReportArtifact({
        artifact_id: "rpt_generic",
        title: "Sestava z odpovědi AKB",
        columns: [
          { key: "topic", label: "Téma", type: "text" },
          { key: "summary", label: "Závěr", type: "text" }
        ],
        rows: [
          {
            row_id: "row_1",
            cells: {
              topic: "vytvoř tabulku kde bude seznam povinností",
              summary: "Opakovaný text odpovědi."
            },
            citations: []
          }
        ],
        warnings: ["REPORT_LIMITED_TO_CITED_SOURCES"]
      }),
      /generic cited-answer/
    );
  });
});
