import assert from "node:assert/strict";
import test from "node:test";

import { deriveAssistantChartArtifacts } from "../src/lib/reporting/assistant-chart";
import type { AssistantReportArtifact } from "../src/lib/types";

function report(): AssistantReportArtifact {
  return {
    artifact_id: "rpt_types",
    title: "Dokumenty podle typu",
    description: null,
    columns: [
      { key: "type", label: "Typ", type: "text" },
      { key: "count", label: "Počet", type: "number" },
      { key: "valid", label: "Platné", type: "number" },
    ],
    rows: [
      { row_id: "1", cells: { type: "Zákon", count: 20, valid: 18 }, citations: [] },
      { row_id: "2", cells: { type: "Vyhláška", count: 8, valid: 7 }, citations: [] },
      { row_id: "3", cells: { type: "Metodika", count: 5, valid: 5 }, citations: [] },
    ],
    export_formats: [],
    source_citation_count: 0,
    warnings: [],
  };
}

test("derives a bounded chart.v1 mapping from a validated numeric report", () => {
  const charts = deriveAssistantChartArtifacts(
    report(),
    "Zobraz graf počtu dokumentů podle typu.",
  );

  assert.equal(charts.length, 1);
  assert.equal(charts[0]?.artifact_contract_version, "chart.v1");
  assert.equal(charts[0]?.chart_type, "bar");
  assert.equal(charts[0]?.dataset_artifact_id, "rpt_types");
  assert.equal(charts[0]?.category_column_key, "type");
  assert.deepEqual(charts[0]?.value_column_keys, ["count", "valid"]);
});

test("uses pie only for a small single-whole view and never embeds data or URLs", () => {
  const charts = deriveAssistantChartArtifacts(
    report(),
    "Vytvoř koláčový graf zastoupení dokumentů.",
  );

  assert.equal(charts[0]?.chart_type, "pie");
  assert.deepEqual(charts[0]?.value_column_keys, ["count"]);
  assert.equal("rows" in (charts[0] ?? {}), false);
  assert.equal("url" in (charts[0] ?? {}), false);
});

test("does not invent a chart without explicit intent or a meaningful measure", () => {
  assert.deepEqual(
    deriveAssistantChartArtifacts(report(), "Kolik dokumentů evidujeme?"),
    [],
  );
  const pageOnly = report();
  pageOnly.columns[1] = { key: "page", label: "Strana", type: "number" };
  pageOnly.columns = pageOnly.columns.slice(0, 2);
  assert.deepEqual(
    deriveAssistantChartArtifacts(pageOnly, "Vytvoř graf."),
    [],
  );
});
