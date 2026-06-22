import type {
  AssistantChatResponse,
  AssistantReportArtifact,
  AssistantReportColumn,
  AssistantReportRow,
  Citation,
  ResponseLanguage
} from "@/lib/types";

type CellValue = string | number | boolean | null;

interface ParsedMarkdownTable {
  headers: string[];
  rows: string[][];
}

const STRUCTURED_OUTPUT_RE = /(sestav|report|tabulk|excel|xlsx|export|přehled|prehled|pdf)/i;
const SOURCE_COLUMN_RE = /(odkaz|zdroj|dokument|citac|citace|link|url|source|document)/i;

export function normalizeAssistantAnswerReports(
  response: AssistantChatResponse,
  message: string,
  language: ResponseLanguage = "cs"
): AssistantChatResponse {
  const answer = response.answer ?? response.message ?? "";
  const parsedTable = parseFirstMarkdownTable(answer);
  if (!parsedTable) {
    return response;
  }

  const wantsStructuredOutput = STRUCTURED_OUTPUT_RE.test(message);
  if (!wantsStructuredOutput && response.report_artifacts.length === 0) {
    return response;
  }
  if (response.report_artifacts.length > 0 && !shouldReplaceReportArtifacts(response.report_artifacts, message)) {
    return response;
  }

  const artifact = buildReportArtifactFromMarkdownTable({
    table: parsedTable,
    answer,
    citations: response.citations,
    language
  });

  if (!artifact) {
    return response;
  }

  return {
    ...response,
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
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex]?.trim() ?? "";
      if (!looksLikeTableLine(rowLine)) {
        break;
      }
      const cells = splitMarkdownTableRow(rowLine).map(cleanMarkdownCell);
      rows.push(normalizeRowWidth(cells, headers.length));
    }

    const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.length > 0));
    if (nonEmptyRows.length > 0) {
      return {
        headers: normalizeRowWidth(headers, Math.max(headers.length, ...nonEmptyRows.map((row) => row.length))),
        rows: nonEmptyRows
      };
    }
  }
  return null;
}

function buildReportArtifactFromMarkdownTable({
  table,
  answer,
  citations,
  language
}: {
  table: ParsedMarkdownTable;
  answer: string;
  citations: Citation[];
  language: ResponseLanguage;
}): AssistantReportArtifact | null {
  const normalizedTable = removeEmptySourceColumns(table);
  if (normalizedTable.headers.length === 0 || normalizedTable.rows.length === 0) {
    return null;
  }

  const columns = normalizedTable.headers.map((header, index) => ({
    key: uniqueColumnKey(header, index, normalizedTable.headers),
    label: header || defaultColumnLabel(language, index),
    type: "text" as const
  }));

  const rows: AssistantReportRow[] = normalizedTable.rows.slice(0, 500).map((row, rowIndex) => ({
    row_id: `answer_table_row_${rowIndex + 1}`,
    cells: cellsForRow(row, columns),
    citations: citations.slice(0, 8)
  }));

  return {
    artifact_id: `rpt_answer_table_${stableHash(`${answer}\n${normalizedTable.headers.join("|")}`)}`,
    title: reportTitleForTable(normalizedTable, language),
    description: language === "en"
      ? "The exportable table is built from the structured answer. Source documents remain available in the answer citations."
      : "Exportovatelná tabulka je vytvořená ze strukturované odpovědi. Zdrojové dokumenty zůstávají dostupné v citacích odpovědi.",
    columns,
    rows,
    export_formats: ["xlsx", "pdf"],
    source_citation_count: citations.length,
    warnings: []
  };
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
    rows: table.rows.map((row) => keepIndexes.map((index) => row[index] ?? ""))
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
