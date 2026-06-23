import type {
  AssistantChatResponse,
  AssistantReportArtifact,
  AssistantReportColumn,
  AssistantReportRow,
  Citation,
  RagConfidence,
  ResponseLanguage
} from "@/lib/types";
import {
  ASSISTANT_REPORT_ARTIFACT_CONTRACT_VERSION,
  type AssistantQueryPlan
} from "@/lib/assistant/assistant-query-planner";

import {
  filterUsableAssistantReportArtifacts,
  getAssistantReportQualityIssues,
  summarizeAssistantReportQuality
} from "./assistant-report-quality";

type CellValue = string | number | boolean | null;
type ArtifactGeneratedFrom = "rag_markdown_table" | "rag_structured_artifact" | "registry_metadata";

interface ParsedMarkdownTable {
  headers: string[];
  rows: string[][];
  startLine: number;
  endLine: number;
}

const STRUCTURED_OUTPUT_RE = /(sestav|report|tabulk|excel|xlsx|export|přehled|prehled|pdf)/i;
const SOURCE_COLUMN_RE = /(odkaz|zdroj|dokument|citac|citace|link|url|source|document)/i;

export function normalizeAssistantAnswerReports(
  response: AssistantChatResponse,
  message: string,
  language: ResponseLanguage = "cs",
  options: { queryPlan?: AssistantQueryPlan | null } = {}
): AssistantChatResponse {
  const answer = response.answer ?? response.message ?? "";
  const parsedTable = parseFirstMarkdownTable(answer);
  const usableExistingArtifacts = filterUsableAssistantReportArtifacts(response.report_artifacts, { message })
    .map((artifact) => finalizeAssistantReportArtifact(artifact, {
      generatedFrom: isRegistryMetadataArtifact(artifact) ? "registry_metadata" : "rag_structured_artifact",
      message,
      queryPlan: options.queryPlan ?? null,
      confidence: response.confidence
    }));
  const responseWithUsableArtifacts = {
    ...response,
    report_artifacts: usableExistingArtifacts
  };
  if (!parsedTable) {
    return responseWithUsableArtifacts;
  }

  const wantsStructuredOutput = Boolean(options.queryPlan?.structured_output) || STRUCTURED_OUTPUT_RE.test(message);
  if (!wantsStructuredOutput && usableExistingArtifacts.length === 0) {
    return responseWithUsableArtifacts;
  }
  if (usableExistingArtifacts.length > 0 && !shouldReplaceReportArtifacts(usableExistingArtifacts, message)) {
    return withDisplayAnswer(responseWithUsableArtifacts, stripFirstMarkdownTableFromAnswer(answer, parsedTable, language));
  }
  const shouldClearGenericReports = response.report_artifacts.length > 0;

  const artifact = buildReportArtifactFromMarkdownTable({
    table: parsedTable,
    answer,
    citations: response.citations,
    language,
    queryPlan: options.queryPlan ?? null,
    confidence: response.confidence,
    message
  });

  if (!artifact || getAssistantReportQualityIssues(artifact, { message }).length > 0) {
    return shouldClearGenericReports ? { ...response, report_artifacts: [] } : response;
  }

  return {
    ...response,
    ...displayAnswerPatch(response, stripFirstMarkdownTableFromAnswer(answer, parsedTable, language)),
    report_artifacts: [artifact]
  };
}

function shouldReplaceReportArtifacts(artifacts: AssistantReportArtifact[], message: string): boolean {
  if (artifacts.length === 0) {
    return true;
  }
  return artifacts.every((artifact) => isGenericAnswerReport(artifact, message));
}

function isGenericAnswerReport(artifact: AssistantReportArtifact, message: string): boolean {
  const titleLooksGeneric = /sestava z odpovědi akb|akb answer report|table from akb answer/i.test(artifact.title);
  const warningLooksGeneric = artifact.warnings.includes("REPORT_LIMITED_TO_CITED_SOURCES");
  const normalizedMessage = normalizeComparableText(message);
  const repeatsPrompt = normalizedMessage
    ? artifact.rows.some((row) => Object.values(row.cells).some((value) => normalizeComparableText(value) === normalizedMessage))
    : false;
  const containsRawMarkdownTable = artifact.rows.some((row) => (
    Object.values(row.cells).some((value) => typeof value === "string" && /\|\s*:?-{3}/.test(value))
  ));

  return titleLooksGeneric || warningLooksGeneric || repeatsPrompt || containsRawMarkdownTable;
}

function normalizeComparableText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : "";
}

export function parseFirstMarkdownTable(markdown: string): ParsedMarkdownTable | null {
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index]?.trim() ?? "";
    const separatorLine = lines[index + 1]?.trim() ?? "";
    if (!looksLikeTableLine(headerLine) || !looksLikeTableLine(separatorLine)) {
      continue;
    }

    const headers = splitMarkdownTableRow(headerLine).map(cleanMarkdownCell);
    const separator = splitMarkdownTableRow(separatorLine).map((cell) => cell.trim());
    if (headers.length < 1 || separator.length < headers.length || !isMarkdownSeparatorRow(separator)) {
      continue;
    }

    const rows: string[][] = [];
    let endLine = index + 1;
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex]?.trim() ?? "";
      if (!looksLikeTableLine(rowLine)) {
        break;
      }
      const cells = splitMarkdownTableRow(rowLine).map(cleanMarkdownCell);
      rows.push(normalizeRowWidth(cells, headers.length));
      endLine = rowIndex;
    }

    const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.length > 0));
    if (nonEmptyRows.length > 0) {
      return {
        headers: normalizeRowWidth(headers, Math.max(headers.length, ...nonEmptyRows.map((row) => row.length))),
        rows: nonEmptyRows,
        startLine: index,
        endLine
      };
    }
  }
  return null;
}

function stripFirstMarkdownTableFromAnswer(
  answer: string,
  table: ParsedMarkdownTable,
  language: ResponseLanguage
): string {
  const lines = answer.split(/\r?\n/);
  const before = lines.slice(0, table.startLine).join("\n").trim();
  const after = lines.slice(table.endLine + 1).join("\n").trim();
  const remaining = [before, after].filter(Boolean).join("\n\n").trim();
  if (remaining) {
    return remaining;
  }
  return language === "en" ? "I prepared the table below." : "Připravil jsem tabulku níže.";
}

function withDisplayAnswer(response: AssistantChatResponse, displayAnswer: string): AssistantChatResponse {
  return {
    ...response,
    ...displayAnswerPatch(response, displayAnswer)
  };
}

function displayAnswerPatch(response: AssistantChatResponse, displayAnswer: string): Pick<AssistantChatResponse, "answer" | "message"> {
  if (response.answer !== null) {
    return { answer: displayAnswer, message: response.message };
  }
  return { answer: response.answer, message: displayAnswer };
}

function buildReportArtifactFromMarkdownTable({
  table,
  answer,
  citations,
  language,
  queryPlan,
  confidence,
  message
}: {
  table: ParsedMarkdownTable;
  answer: string;
  citations: Citation[];
  language: ResponseLanguage;
  queryPlan: AssistantQueryPlan | null;
  confidence: RagConfidence | null;
  message: string;
}): AssistantReportArtifact | null {
  const normalizedTable = removeEmptySourceColumns(table);
  if (normalizedTable.headers.length < 2 || normalizedTable.rows.length === 0) {
    return null;
  }

  const columns = normalizedTable.headers.map((header, index) => ({
    key: uniqueColumnKey(header, index, normalizedTable.headers),
    label: header || defaultColumnLabel(language, index),
    type: "text" as const
  }));

  const rowCitations = citations.slice(0, 8);
  const rows: AssistantReportRow[] = normalizedTable.rows.slice(0, 500).map((row, rowIndex) => ({
    row_id: `answer_table_row_${rowIndex + 1}`,
    cells: cellsForRow(row, columns),
    citations: rowCitations,
    confidence
  }));

  return finalizeAssistantReportArtifact({
    artifact_id: `rpt_answer_table_${stableHash(`${answer}\n${normalizedTable.headers.join("|")}`)}`,
    title: reportTitleForTable(normalizedTable, language),
    description: language === "en"
      ? "The exportable table is built from the structured answer. Source documents remain available in the answer citations."
      : "Exportovatelná tabulka je vytvořená ze strukturované odpovědi. Zdrojové dokumenty zůstávají dostupné v citacích odpovědi.",
    columns,
    rows,
    export_formats: exportFormatsForQueryPlan(queryPlan, ["xlsx", "pdf"]),
    source_citation_count: citations.length,
    warnings: []
  }, {
    generatedFrom: "rag_markdown_table",
    message,
    queryPlan,
    confidence
  });
}

function looksLikeTableLine(line: string): boolean {
  return line.includes("|") && line.replace(/\|/g, "").trim().length > 0;
}

function splitMarkdownTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith("|")) {
    source = source.slice(1);
  }
  if (source.endsWith("|")) {
    source = source.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of source) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function cleanMarkdownCell(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMarkdownSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function normalizeRowWidth(row: string[], width: number): string[] {
  if (row.length >= width) {
    return row.slice(0, width);
  }
  return [...row, ...Array.from({ length: width - row.length }, () => "")];
}

function removeEmptySourceColumns(table: ParsedMarkdownTable): ParsedMarkdownTable {
  const keepIndexes = table.headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => {
      const isEmpty = table.rows.every((row) => !row[index]);
      return !(isEmpty && SOURCE_COLUMN_RE.test(header));
    })
    .map(({ index }) => index);

  if (keepIndexes.length === table.headers.length) {
    return table;
  }

  return {
    headers: keepIndexes.map((index) => table.headers[index] ?? ""),
    rows: table.rows.map((row) => keepIndexes.map((index) => row[index] ?? "")),
    startLine: table.startLine,
    endLine: table.endLine
  };
}

function uniqueColumnKey(header: string, index: number, headers: string[]): string {
  const base = slugify(header) || `column_${index + 1}`;
  const usedBefore = headers.slice(0, index).filter((item) => (slugify(item) || `column_${index + 1}`) === base).length;
  return usedBefore > 0 ? `${base}_${usedBefore + 1}` : base;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function cellsForRow(row: string[], columns: AssistantReportColumn[]): Record<string, CellValue> {
  const cells: Record<string, CellValue> = {};
  columns.forEach((column, index) => {
    cells[column.key] = row[index] ?? "";
  });
  return cells;
}

function defaultColumnLabel(language: ResponseLanguage, index: number): string {
  return language === "en" ? `Column ${index + 1}` : `Sloupec ${index + 1}`;
}

function reportTitleForTable(table: ParsedMarkdownTable, language: ResponseLanguage): string {
  const haystack = `${table.headers.join(" ")} ${table.rows.slice(0, 3).flat().join(" ")}`;
  if (/povinnost/i.test(haystack)) {
    return language === "en" ? "Obligations list" : "Seznam povinností";
  }
  return language === "en" ? "Table from AKB answer" : "Tabulka z odpovědi AKB";
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function finalizeAssistantReportArtifact(
  artifact: AssistantReportArtifact,
  options: {
    generatedFrom: ArtifactGeneratedFrom;
    message: string;
    queryPlan: AssistantQueryPlan | null;
    confidence: RagConfidence | null;
  }
): AssistantReportArtifact {
  const registryMetadata = options.generatedFrom === "registry_metadata" || isRegistryMetadataArtifact(artifact);
  const rows = artifact.rows.map((row) => enrichReportRow(row, artifact.columns, registryMetadata, options.confidence));
  const enriched: AssistantReportArtifact = {
    ...artifact,
    artifact_contract_version: artifact.artifact_contract_version ?? ASSISTANT_REPORT_ARTIFACT_CONTRACT_VERSION,
    artifact_kind: artifact.artifact_kind ?? (registryMetadata ? "registry_metadata_table" : "content_table"),
    export_formats: exportFormatsForQueryPlan(options.queryPlan, artifact.export_formats),
    rows,
    provenance: artifact.provenance ?? {
      generated_from: options.generatedFrom,
      assistant_tool: options.queryPlan?.tool ?? (registryMetadata ? "registry_document_report" : "rag_document_answer"),
      query_plan_id: options.queryPlan?.plan_id ?? null,
      citations_required: options.queryPlan?.quality_gates.citations_required ?? !registryMetadata,
      row_citations_required: options.queryPlan?.quality_gates.row_citations_required ?? !registryMetadata
    }
  };
  return {
    ...enriched,
    quality: summarizeAssistantReportQuality(enriched, { message: options.message })
  };
}

function exportFormatsForQueryPlan(
  queryPlan: AssistantQueryPlan | null,
  fallback: AssistantReportArtifact["export_formats"]
): AssistantReportArtifact["export_formats"] {
  const preferred = queryPlan?.output.preferred_export_formats ?? [];
  if (preferred.length === 0) {
    return fallback;
  }
  const available = fallback.filter((format) => preferred.includes(format));
  return available.length > 0 ? available : fallback;
}

function enrichReportRow(
  row: AssistantReportRow,
  columns: AssistantReportColumn[],
  registryMetadata: boolean,
  confidence: RagConfidence | null
): AssistantReportRow {
  if (row.source_refs && row.source_refs.length > 0) {
    return {
      ...row,
      confidence: row.confidence ?? confidence
    };
  }
  return {
    ...row,
    confidence: row.confidence ?? confidence,
    source_refs: columns.map((column) => {
      const informative = isInformativeReportCell(row.cells[column.key]);
      const evidenceStatus = registryMetadata
        ? "metadata"
        : informative && row.citations.length > 0
          ? "cited"
          : informative
            ? "uncited"
            : "not_stated";
      return {
        column_key: column.key,
        evidence_status: evidenceStatus,
        citations: evidenceStatus === "cited" ? row.citations.slice(0, 8) : []
      };
    })
  };
}

function isRegistryMetadataArtifact(artifact: AssistantReportArtifact): boolean {
  return artifact.artifact_kind === "registry_metadata_table" ||
    artifact.artifact_id.startsWith("rpt_registry_") ||
    artifact.warnings.some((warning) => warning === "REGISTRY_METADATA_REPORT" || warning === "REGISTRY_METADATA_SUMMARY");
}

function isInformativeReportCell(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  return Boolean(text) && !/^(?:-|n\/a|na|neuvedeno|neni uvedeno|není uvedeno|not stated|unknown|bez udaje|bez údaje)$/i.test(text);
}
