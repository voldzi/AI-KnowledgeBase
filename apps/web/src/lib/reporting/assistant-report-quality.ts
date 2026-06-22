import type { AssistantReportArtifact, AssistantReportColumn, AssistantReportRow } from "@/lib/types";

import { AssistantReportValidationError } from "./assistant-report-validation-error";

type ReportLike = Pick<AssistantReportArtifact, "artifact_id" | "title" | "description" | "columns" | "rows" | "warnings"> &
  Partial<Pick<AssistantReportArtifact, "source_citation_count" | "export_formats">>;

export interface AssistantReportQualityIssue {
  code: string;
  message: string;
}

const PLACEHOLDER_RE = /^(?:-|n\/a|na|neuvedeno|neni uvedeno|není uvedeno|not stated|unknown|bez udaje|bez údaje)$/i;
const GENERIC_REPORT_TITLE_RE = /^(?:sestava z odpovedi akb|sestava z odpovědi akb|akb answer report|table from akb answer)$/i;
const RAW_MARKDOWN_TABLE_RE = /\|\s*:?-{3}/;

export function filterUsableAssistantReportArtifacts(
  artifacts: AssistantReportArtifact[],
  options: { message?: string } = {}
): AssistantReportArtifact[] {
  return artifacts.filter((artifact) => getAssistantReportQualityIssues(artifact, options).length === 0);
}

export function assertAssistantReportQuality(report: ReportLike, options: { message?: string } = {}): void {
  const issues = getAssistantReportQualityIssues(report, options);
  if (issues.length > 0) {
    throw new AssistantReportValidationError(issues[0]?.message ?? "report artifact failed quality validation.");
  }
}

export function getAssistantReportQualityIssues(
  report: ReportLike,
  options: { message?: string } = {}
): AssistantReportQualityIssue[] {
  const issues: AssistantReportQualityIssue[] = [];
  const columns = Array.isArray(report.columns) ? report.columns : [];
  const rows = Array.isArray(report.rows) ? report.rows : [];

  if (columns.length < 2) {
    issues.push({
      code: "REPORT_INSUFFICIENT_COLUMNS",
      message: "report must contain at least two meaningful columns."
    });
  }

  if (rows.length === 0) {
    issues.push({
      code: "REPORT_EMPTY_ROWS",
      message: "report must contain at least one row."
    });
  }

  if (isGenericGeneratedReport(report)) {
    issues.push({
      code: "REPORT_GENERIC_RETRIEVAL_SUMMARY",
      message: "generic cited-answer summaries are not enterprise report artifacts."
    });
  }

  const duplicateColumn = firstDuplicateColumnKey(columns);
  if (duplicateColumn) {
    issues.push({
      code: "REPORT_DUPLICATE_COLUMN",
      message: `report contains duplicate column key '${duplicateColumn}'.`
    });
  }

  const message = normalizeComparableText(options.message);
  let informativeRows = 0;
  for (const row of rows) {
    if (rowHasEnoughInformation(row, columns)) {
      informativeRows += 1;
    }
    if (message && rowContainsPromptLeak(row, message)) {
      issues.push({
        code: "REPORT_PROMPT_LEAK",
        message: "report rows must not repeat the user prompt as a cell value."
      });
      break;
    }
    if (rowContainsRawMarkdownTable(row)) {
      issues.push({
        code: "REPORT_RAW_MARKDOWN_TABLE",
        message: "report cells must not contain raw markdown table syntax."
      });
      break;
    }
  }

  if (rows.length > 0 && informativeRows === 0) {
    issues.push({
      code: "REPORT_EMPTY_INFORMATION",
      message: "report rows must contain at least two non-empty, non-placeholder values."
    });
  }

  const rowCitationCount = rows.reduce((count, row) => count + row.citations.length, 0);
  const sourceCitationCount = report.source_citation_count ?? rowCitationCount;
  if (!isRegistryMetadataReport(report) && sourceCitationCount === 0) {
    issues.push({
      code: "REPORT_UNCITED_CONTENT",
      message: "content reports must keep citations on report rows."
    });
  }

  return issues;
}

function rowHasEnoughInformation(row: AssistantReportRow, columns: AssistantReportColumn[]): boolean {
  const informativeCellCount = columns.reduce((count, column) => (
    isInformativeCell(row.cells[column.key]) ? count + 1 : count
  ), 0);
  return informativeCellCount >= 2;
}

function isInformativeCell(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  return Boolean(text) && !PLACEHOLDER_RE.test(text);
}

function rowContainsPromptLeak(row: AssistantReportRow, normalizedMessage: string): boolean {
  return Object.values(row.cells).some((value) => normalizeComparableText(value) === normalizedMessage);
}

function rowContainsRawMarkdownTable(row: AssistantReportRow): boolean {
  return Object.values(row.cells).some((value) => typeof value === "string" && RAW_MARKDOWN_TABLE_RE.test(value));
}

function firstDuplicateColumnKey(columns: AssistantReportColumn[]): string | null {
  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.key)) {
      return column.key;
    }
    seen.add(column.key);
  }
  return null;
}

function isGenericGeneratedReport(report: ReportLike): boolean {
  return GENERIC_REPORT_TITLE_RE.test(normalizeComparableText(report.title)) &&
    report.warnings.includes("REPORT_LIMITED_TO_CITED_SOURCES") &&
    !isRegistryMetadataReport(report);
}

function isRegistryMetadataReport(report: ReportLike): boolean {
  return report.warnings.some((warning) => warning === "REGISTRY_METADATA_REPORT" || warning === "REGISTRY_METADATA_SUMMARY") ||
    report.artifact_id.startsWith("rpt_registry_");
}

function normalizeComparableText(value: unknown): string {
  return typeof value === "string"
    ? value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
    : "";
}
