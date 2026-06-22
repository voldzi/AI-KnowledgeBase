import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeAssistantAnswerReports,
  parseFirstMarkdownTable
} from "../src/lib/reporting/assistant-answer-report";
import type { AssistantChatResponse, AssistantReportArtifact, Citation } from "../src/lib/types";

const citation: Citation = {
  document_id: "doc_1",
  document_version_id: "ver_1",
  document_title: "Metodika povinností",
  version_label: "v1",
  document_version: "v1",
  section_path: ["Povinnosti"],
  page_number: 4,
  chunk_id: "chunk_1"
};

function responseFixture(input: Partial<AssistantChatResponse> = {}): AssistantChatResponse {
  return {
    response_type: "answer",
    conversation_id: "conv_test",
    answer: null,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {},
    citations: [citation],
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "medium",
    warnings: [],
    missing_information: null,
    recommended_action: null,
    ...input
  };
}

function badRepeatedReport(): AssistantReportArtifact {
  return {
    artifact_id: "rpt_bad",
    title: "Sestava z odpovědi AKB",
    description: "Tabulková sestava je vytvořená z citované odpovědi.",
    columns: [
      { key: "topic", label: "Téma", type: "text" },
      { key: "summary", label: "Závěr", type: "text" },
      { key: "document", label: "Zdrojový dokument", type: "text" }
    ],
    rows: [
      {
        row_id: "row_1",
        cells: {
          topic: "vytvoř tabulku kde bude seznam povinností",
          summary: "V rámci kategorie povinností se v rámci dopadové tabulky posuzují následující oblasti: | Oblasti | ...",
          document: "Metodika povinností"
        },
        citations: [citation]
      }
    ],
    export_formats: ["xlsx", "pdf"],
    source_citation_count: 1,
    warnings: ["REPORT_LIMITED_TO_CITED_SOURCES"]
  };
}

describe("assistant answer report normalization", () => {
  it("parses a markdown table from an assistant answer", () => {
    const table = parseFirstMarkdownTable([
      "V citovaných zdrojích se objevují tyto oblasti:",
      "",
      "| Oblasti posuzované v rámci kategorie povinností | Odkaz na dokument |",
      "| :--- | :--- |",
      "| právní povinnosti | |",
      "| obchodní tajemství | |",
      "| trestně-právní řízení (nad rámec VKB) | |",
      "| jiné závazky | |"
    ].join("\n"));

    assert.ok(table);
    assert.deepEqual(table.headers, ["Oblasti posuzované v rámci kategorie povinností", "Odkaz na dokument"]);
    assert.equal(table.rows.length, 4);
    assert.equal(table.rows[0]?.[0], "právní povinnosti");
  });

  it("replaces a repeated citation report with rows extracted from the answer table", () => {
    const response = responseFixture({
      answer: [
        "V rámci kategorie povinností se posuzují následující oblasti:",
        "",
        "| Oblasti posuzované v rámci kategorie povinností | Odkaz na dokument |",
        "| :--- | :--- |",
        "| právní povinnosti | |",
        "| obchodní tajemství | |",
        "| trestně-právní řízení (nad rámec VKB) | |",
        "| jiné závazky | |"
      ].join("\n"),
      report_artifacts: [badRepeatedReport()]
    });

    const normalized = normalizeAssistantAnswerReports(
      response,
      "vytvoř tabulku kde bude seznam povinností",
      "cs"
    );

    assert.equal(normalized.report_artifacts.length, 1);
    const report = normalized.report_artifacts[0];
    assert.equal(report?.title, "Seznam povinností");
    assert.equal(report?.rows.length, 4);
    assert.equal(report?.columns.length, 1);
    assert.equal(report?.columns[0]?.label, "Oblasti posuzované v rámci kategorie povinností");
    assert.equal(report?.rows[0]?.cells.oblasti_posuzovane_v_ramci_kategorie_povinnosti, "právní povinnosti");
    assert.equal(report?.rows[1]?.cells.oblasti_posuzovane_v_ramci_kategorie_povinnosti, "obchodní tajemství");
    assert.equal(report?.source_citation_count, 1);
    assert.deepEqual(report?.export_formats, ["xlsx", "pdf"]);
    assert.equal(String(report?.rows[0]?.cells.oblasti_posuzovane_v_ramci_kategorie_povinnosti).includes("| :---"), false);
  });

  it("does not create a report for ordinary answers without report intent", () => {
    const response = responseFixture({
      answer: [
        "| Sloupec | Hodnota |",
        "| :--- | :--- |",
        "| A | B |"
      ].join("\n")
    });

    const normalized = normalizeAssistantAnswerReports(response, "co znamená sloupec A?", "cs");

    assert.equal(normalized.report_artifacts.length, 0);
  });

  it("keeps a non-generic report artifact from the retrieval service", () => {
    const goodReport: AssistantReportArtifact = {
      artifact_id: "rpt_good",
      title: "Dopadová tabulka povinností",
      description: "Report připravený retrieval službou.",
      columns: [
        { key: "obligation", label: "Povinnost", type: "text" },
        { key: "owner", label: "Odpovědnost", type: "text" }
      ],
      rows: [
        {
          row_id: "good_1",
          cells: {
            obligation: "Právní povinnosti",
            owner: "Gestor dokumentu"
          },
          citations: [citation]
        }
      ],
      export_formats: ["xlsx", "pdf"],
      source_citation_count: 1,
      warnings: []
    };
    const response = responseFixture({
      answer: [
        "| Oblast povinnosti | Praktický význam |",
        "| :--- | :--- |",
        "| Právní povinnosti | Ověřit zákonné povinnosti. |"
      ].join("\n"),
      report_artifacts: [goodReport]
    });

    const normalized = normalizeAssistantAnswerReports(
      response,
      "vytvoř tabulku kde bude seznam povinností",
      "cs"
    );

    assert.equal(normalized.report_artifacts[0], goodReport);
  });
});
