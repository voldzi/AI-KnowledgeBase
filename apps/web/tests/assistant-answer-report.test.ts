import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeAssistantAnswerReports,
  parseFirstMarkdownTable
} from "../src/lib/reporting/assistant-answer-report";
import { buildAssistantQueryPlan } from "../src/lib/assistant/assistant-query-planner";
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
    assert.equal(table.startLine, 2);
    assert.equal(table.endLine, 7);
  });

  it("replaces a repeated citation report with rows extracted from a useful answer table", () => {
    const response = responseFixture({
      answer: [
        "V rámci kategorie povinností se posuzují následující oblasti:",
        "",
        "| Oblasti posuzované v rámci kategorie povinností | Odpovídající ustanovení | Poznámka |",
        "| :--- | :--- | :--- |",
        "| právní povinnosti | VKB § 4 písm. a), b) | trestně-právní řízení je nad rámec VKB |",
        "| obchodní tajemství | VKB § 4 písm. a), b) | - |",
        "| trestně-právní řízení | VKB § 4 písm. a), b) | nad rámec běžného posouzení |",
        "| jiné závazky | VKB § 4 písm. a), b) | - |"
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
    assert.equal(report?.columns.length, 3);
    assert.equal(report?.columns[0]?.label, "Oblasti posuzované v rámci kategorie povinností");
    assert.equal(report?.columns[1]?.label, "Odpovídající ustanovení");
    assert.equal(report?.rows[0]?.cells.oblasti_posuzovane_v_ramci_kategorie_povinnosti, "právní povinnosti");
    assert.equal(report?.rows[0]?.cells.odpovidajici_ustanoveni, "VKB § 4 písm. a), b)");
    assert.equal(report?.rows[1]?.cells.oblasti_posuzovane_v_ramci_kategorie_povinnosti, "obchodní tajemství");
    assert.equal(report?.artifact_contract_version, "report.v2");
    assert.equal(report?.artifact_kind, "content_table");
    assert.equal(report?.provenance?.generated_from, "rag_markdown_table");
    assert.equal(report?.provenance?.row_citations_required, true);
    assert.equal(report?.quality?.status, "validated");
    assert.equal(report?.quality?.informative_row_count, 4);
    assert.equal(report?.quality?.row_citation_coverage, 1);
    assert.equal(report?.rows[0]?.confidence, "medium");
    assert.equal(report?.rows[0]?.source_refs?.[0]?.evidence_status, "cited");
    assert.equal(report?.source_citation_count, 1);
    assert.deepEqual(report?.export_formats, ["xlsx", "pdf"]);
    assert.equal(String(report?.rows[0]?.cells.oblasti_posuzovane_v_ramci_kategorie_povinnosti).includes("| :---"), false);
    assert.match(normalized.answer ?? "", /V rámci kategorie povinností/);
    assert.equal((normalized.answer ?? "").includes("| :---"), false);
    assert.equal((normalized.answer ?? "").includes("| právní povinnosti |"), false);
  });

  it("does not turn a one-column list into an exportable report", () => {
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

    assert.equal(normalized.report_artifacts.length, 0);
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

  it("creates report artifacts from natural questions when report mode is planned", () => {
    const response = responseFixture({
      answer: [
        "Z citovaných zdrojů plyne následující:",
        "",
        "| Povinnost nebo oblast | Vlastník nebo role | Termín nebo periodicita |",
        "| :--- | :--- | :--- |",
        "| právní povinnosti | gestor dokumentu | neuvedeno |",
        "| obchodní tajemství | vlastník informace | průběžně |"
      ].join("\n")
    });
    const queryPlan = buildAssistantQueryPlan({
      message: "Jaké povinnosti z toho plynou?",
      language: "cs",
      tool: "rag_document_answer",
      reason: "rag_structured_output",
      structuredOutput: true,
      obligationOutput: true,
      registryReportKind: null,
      registryTopics: [],
      reportRequest: {
        enabled: true,
        output_kind: "table",
        template: "obligation_table",
        detail_level: "detailed",
        export_format: "pdf",
        columns: ["obligation_or_area", "owner_or_role", "deadline_or_frequency"],
        require_row_citations: true
      }
    });

    const normalized = normalizeAssistantAnswerReports(
      response,
      "Jaké povinnosti z toho plynou?",
      "cs",
      { queryPlan }
    );

    assert.equal(normalized.report_artifacts.length, 1);
    assert.equal(normalized.report_artifacts[0]?.title, "Seznam povinností");
    assert.deepEqual(normalized.report_artifacts[0]?.export_formats, ["pdf"]);
    assert.equal(normalized.report_artifacts[0]?.provenance?.query_plan_id, queryPlan.plan_id);
    assert.equal(normalized.report_artifacts[0]?.quality?.status, "validated");
  });

  it("removes invalid report artifacts even when the answer has no markdown table", () => {
    const response = responseFixture({
      answer: "V rámci kategorie povinností se posuzují právní povinnosti a obchodní tajemství.",
      report_artifacts: [
        {
          artifact_id: "rpt_one_column",
          title: "Seznam povinností",
          description: null,
          columns: [{ key: "obligation", label: "Povinnost", type: "text" }],
          rows: [
            {
              row_id: "row_1",
              cells: { obligation: "právní povinnosti" },
              citations: []
            }
          ],
          export_formats: ["xlsx", "pdf"],
          source_citation_count: 0,
          warnings: []
        }
      ]
    });

    const normalized = normalizeAssistantAnswerReports(
      response,
      "vytvoř tabulku kde bude seznam povinností",
      "cs"
    );

    assert.equal(normalized.report_artifacts.length, 0);
  });

  it("keeps registry metadata reports without chunk citations", () => {
    const metadataReport: AssistantReportArtifact = {
      artifact_id: "rpt_registry_documents",
      title: "Inventura dokumentů podle témat",
      description: "Metadatová sestava z registru.",
      columns: [
        { key: "topic", label: "Téma", type: "text" },
        { key: "document_count", label: "Dokumentů", type: "number" }
      ],
      rows: [
        {
          row_id: "topic_1",
          cells: {
            topic: "digitalizace",
            document_count: 12
          },
          citations: []
        }
      ],
      export_formats: ["xlsx", "pdf"],
      source_citation_count: 0,
      warnings: ["REGISTRY_METADATA_REPORT"]
    };
    const response = responseFixture({
      answer: "Na téma digitalizace máte 12 dokumentů.",
      report_artifacts: [metadataReport],
      citations: []
    });

    const normalized = normalizeAssistantAnswerReports(response, "kolik dokumentů máš na téma digitalizace", "cs");

    assert.equal(normalized.report_artifacts[0]?.artifact_id, metadataReport.artifact_id);
    assert.equal(normalized.report_artifacts[0]?.artifact_kind, "registry_metadata_table");
    assert.equal(normalized.report_artifacts[0]?.provenance?.generated_from, "registry_metadata");
    assert.equal(normalized.report_artifacts[0]?.quality?.issues.length, 0);
    assert.deepEqual(normalized.report_artifacts[0]?.export_formats, []);
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

    assert.equal(normalized.report_artifacts[0]?.artifact_id, goodReport.artifact_id);
    assert.equal(normalized.report_artifacts[0]?.artifact_contract_version, "report.v2");
    assert.equal(normalized.report_artifacts[0]?.provenance?.generated_from, "rag_structured_artifact");
    assert.equal(normalized.report_artifacts[0]?.quality?.row_citation_coverage, 1);
    assert.equal(normalized.answer, "Připravil jsem tabulku níže.");
  });

  it("rejects content reports with uncited rows even when source citation count is set", () => {
    const response = responseFixture({
      answer: "Připravil jsem tabulku níže.",
      report_artifacts: [
        {
          artifact_id: "rpt_uncited",
          title: "Dopadová tabulka povinností",
          description: null,
          columns: [
            { key: "obligation", label: "Povinnost", type: "text" },
            { key: "meaning", label: "Význam", type: "text" }
          ],
          rows: [
            {
              row_id: "row_1",
              cells: {
                obligation: "Právní povinnosti",
                meaning: "Ověřit zákonné povinnosti."
              },
              citations: []
            }
          ],
          export_formats: ["xlsx", "pdf"],
          source_citation_count: 1,
          warnings: []
        }
      ]
    });

    const normalized = normalizeAssistantAnswerReports(response, "vytvoř tabulku povinností", "cs");

    assert.equal(normalized.report_artifacts.length, 0);
  });
});
