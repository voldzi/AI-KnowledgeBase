import type {
  AssistantChartArtifact,
  AssistantChartType,
  AssistantReportArtifact,
  AssistantReportColumn,
} from "@/lib/types";

const CHART_REQUEST_RE =
  /(graf|diagram|vizualiz|chart|plot|sloupcov|spojnicov|koláčov|kolacov|bodov|scatter|stacked|skládan)/i;
const PIE_REQUEST_RE = /(koláčov|kolacov|pie)/i;
const LINE_REQUEST_RE = /(spojnicov|časov|casov|trend|line)/i;
const SCATTER_REQUEST_RE = /(bodov|korelac|scatter)/i;
const STACKED_REQUEST_RE = /(skládan|skladan|stacked)/i;
const NON_MEASURE_KEY_RE = /(^|_)(page|strana|id|year|rok)($|_)/i;
const MAX_CHART_ROWS = 50;
const MAX_SERIES = 4;

export function deriveAssistantChartArtifacts(
  report: AssistantReportArtifact,
  message: string,
): AssistantChartArtifact[] {
  if (!CHART_REQUEST_RE.test(message) || report.rows.length < 2) {
    return [];
  }
  const category = selectCategoryColumn(report.columns);
  const measures = report.columns
    .filter((column) => isMeasureColumn(column) && !NON_MEASURE_KEY_RE.test(column.key))
    .filter((column) => hasUsableNumericValues(report, column.key))
    .slice(0, MAX_SERIES);
  if (!category || measures.length === 0) {
    return [];
  }
  const chartType = selectChartType(message, category, measures, report.rows.length);
  if (chartType === "scatter" && measures.length < 2) {
    return [];
  }
  const valueColumns = chartType === "pie" ? measures.slice(0, 1) : measures;
  return [
    {
      artifact_id: `cht_${stableHash([
        report.artifact_id,
        chartType,
        category.key,
        valueColumns.map((column) => column.key).join(","),
      ].join("|"))}`,
      artifact_contract_version: "chart.v1",
      chart_type: chartType,
      title: report.title,
      dataset_artifact_id: report.artifact_id,
      category_column_key: category.key,
      value_column_keys: valueColumns.map((column) => column.key),
      row_limit: Math.min(report.rows.length, MAX_CHART_ROWS),
      warnings: report.rows.length > MAX_CHART_ROWS ? ["CHART_ROWS_TRUNCATED"] : [],
    },
  ];
}

function selectCategoryColumn(
  columns: AssistantReportColumn[],
): AssistantReportColumn | null {
  return (
    columns.find((column) => column.type === "date") ??
    columns.find(
      (column) =>
        column.type === "text" &&
        !/(description|summary|poznám|poznam|note|url|source|zdroj)/i.test(
          `${column.key} ${column.label}`,
        ),
    ) ??
    null
  );
}

function isMeasureColumn(column: AssistantReportColumn): boolean {
  return ["number", "currency", "percent"].includes(column.type);
}

function hasUsableNumericValues(
  report: AssistantReportArtifact,
  key: string,
): boolean {
  return (
    report.rows
      .slice(0, MAX_CHART_ROWS)
      .filter((row) => finiteNumber(row.cells[key]) !== null).length >= 2
  );
}

function selectChartType(
  message: string,
  category: AssistantReportColumn,
  measures: AssistantReportColumn[],
  rowCount: number,
): AssistantChartType {
  if (SCATTER_REQUEST_RE.test(message) && measures.length >= 2) {
    return "scatter";
  }
  if (PIE_REQUEST_RE.test(message) && rowCount <= 8) {
    return "pie";
  }
  if (LINE_REQUEST_RE.test(message) || category.type === "date") {
    return "line";
  }
  if (STACKED_REQUEST_RE.test(message) && measures.length >= 2) {
    return "stacked_bar";
  }
  return "bar";
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/%$/, "")
    .replace(",", ".");
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
