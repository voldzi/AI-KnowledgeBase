import type { AssistantReportArtifact, AssistantReportColumn, AssistantReportRow, Citation } from "@/lib/types";

import { assertAssistantReportQuality } from "./assistant-report-quality";
import { AssistantReportValidationError } from "./assistant-report-validation-error";

type CellValue = string | number | boolean | null;

export interface NormalizedReport {
  artifact_id: string;
  title: string;
  description: string | null;
  columns: AssistantReportColumn[];
  rows: AssistantReportRow[];
  source_citation_count: number;
  warnings: string[];
}

interface SheetModel {
  name: string;
  rows: CellValue[][];
  headerRowIndex: number;
}

const MAX_COLUMNS = 20;
const MAX_ROWS = 500;
const MAX_CELL_TEXT_LENGTH = 2000;
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function assistantReportXlsxMimeType() {
  return XLSX_MIME_TYPE;
}

export function safeAssistantReportFilename(report: Pick<AssistantReportArtifact, "title">) {
  const base = report.title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "akb-report";
  return `${base}.xlsx`;
}

export function normalizeAssistantReportArtifact(value: unknown): NormalizedReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AssistantReportValidationError("report must be an object.");
  }
  const input = value as Record<string, unknown>;
  const columns = normalizeColumns(input.columns);
  const rows = normalizeRows(input.rows, columns);
  const report = {
    artifact_id: boundedString(input.artifact_id, "artifact_id", 96),
    title: boundedString(input.title, "title", 180),
    description: optionalBoundedString(input.description, "description", 600),
    columns,
    rows,
    source_citation_count: normalizeNonNegativeInteger(input.source_citation_count, rows.reduce((count, row) => count + row.citations.length, 0)),
    warnings: normalizeStringList(input.warnings, 20, 160),
  };
  assertAssistantReportQuality(report);
  return report;
}

export function buildAssistantReportXlsx(report: NormalizedReport): Buffer {
  const sheets = [
    buildReportSheet(report),
    buildCitationSheet(report.rows.flatMap((row) => row.citations.map((citation) => ({ rowId: row.row_id, citation })))),
  ];
  const files = new Map<string, string | Buffer>();
  files.set("[Content_Types].xml", contentTypesXml(sheets.length));
  files.set("_rels/.rels", rootRelsXml());
  files.set("docProps/app.xml", appPropertiesXml());
  files.set("docProps/core.xml", corePropertiesXml(report.title));
  files.set("xl/workbook.xml", workbookXml(sheets));
  files.set("xl/_rels/workbook.xml.rels", workbookRelsXml(sheets.length));
  files.set("xl/styles.xml", stylesXml());
  sheets.forEach((sheet, index) => {
    files.set(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet));
  });
  return zipStore([...files.entries()].map(([path, content]) => ({
    path,
    data: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8"),
  })));
}

function normalizeColumns(value: unknown): AssistantReportColumn[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLUMNS) {
    throw new AssistantReportValidationError(`report.columns must contain 1-${MAX_COLUMNS} items.`);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AssistantReportValidationError(`report.columns[${index}] must be an object.`);
    }
    const column = item as Record<string, unknown>;
    const key = boundedString(column.key, `columns[${index}].key`, 64);
    if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
      throw new AssistantReportValidationError(`columns[${index}].key contains unsupported characters.`);
    }
    if (seen.has(key)) {
      throw new AssistantReportValidationError(`Duplicate report column key: ${key}.`);
    }
    seen.add(key);
    const type = typeof column.type === "string" && ["text", "number", "date", "url", "currency", "percent"].includes(column.type)
      ? column.type
      : "text";
    return {
      key,
      label: boundedString(column.label, `columns[${index}].label`, 120),
      type: type as AssistantReportColumn["type"],
    };
  });
}

function normalizeRows(value: unknown, columns: AssistantReportColumn[]): AssistantReportRow[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) {
    throw new AssistantReportValidationError(`report.rows must contain at most ${MAX_ROWS} items.`);
  }
  const columnKeys = new Set(columns.map((column) => column.key));
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AssistantReportValidationError(`report.rows[${index}] must be an object.`);
    }
    const row = item as Record<string, unknown>;
    const rawCells = row.cells && typeof row.cells === "object" && !Array.isArray(row.cells)
      ? row.cells as Record<string, unknown>
      : {};
    const cells: Record<string, CellValue> = {};
    for (const key of columnKeys) {
      cells[key] = normalizeCellValue(rawCells[key]);
    }
    return {
      row_id: boundedString(row.row_id, `rows[${index}].row_id`, 96),
      cells,
      citations: normalizeCitations(row.citations),
    };
  });
}

function normalizeCellValue(value: unknown): CellValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return String(value).slice(0, MAX_CELL_TEXT_LENGTH);
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function normalizeCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const citation = item as Record<string, unknown>;
    const chunkId = optionalBoundedString(citation.chunk_id, "citation.chunk_id", 96);
    const documentId = optionalBoundedString(citation.document_id, "citation.document_id", 96);
    const documentVersionId = optionalBoundedString(citation.document_version_id, "citation.document_version_id", 96);
    const documentTitle = optionalBoundedString(citation.document_title, "citation.document_title", 240);
    const versionLabel = optionalBoundedString(citation.version_label, "citation.version_label", 80);
    if (!chunkId || !documentId || !documentVersionId || !documentTitle || !versionLabel) {
      return [];
    }
    const pageNumber = typeof citation.page_number === "number" && Number.isInteger(citation.page_number)
      ? citation.page_number
      : null;
    const sectionPath = normalizeStringList(citation.section_path, 12, 120);
    return [{
      chunk_id: chunkId,
      document_id: documentId,
      document_version_id: documentVersionId,
      document_title: documentTitle,
      version_label: versionLabel,
      document_version: optionalBoundedString(citation.document_version, "citation.document_version", 80) ?? versionLabel,
      page_number: pageNumber && pageNumber > 0 ? pageNumber : null,
      section_path: sectionPath,
    }];
  });
}

function buildReportSheet(report: NormalizedReport): SheetModel {
  const rows: CellValue[][] = [
    [report.title],
    [report.description ?? ""],
    report.columns.map((column) => column.label),
    ...report.rows.map((row) => report.columns.map((column) => row.cells[column.key] ?? "")),
  ];
  return { name: "Sestava", rows, headerRowIndex: 3 };
}

function buildCitationSheet(items: Array<{ rowId: string; citation: Citation }>): SheetModel {
  const rows: CellValue[][] = [
    ["Citace"],
    ["row_id", "document_id", "document_version_id", "document_title", "version", "page", "section", "chunk_id"],
    ...items.map(({ rowId, citation }) => [
      rowId,
      citation.document_id,
      citation.document_version_id,
      citation.document_title,
      citation.version_label,
      citation.page_number,
      citation.section_path.join(" / "),
      citation.chunk_id,
    ]),
  ];
  return { name: "Citace", rows, headerRowIndex: 2 };
}

function worksheetXml(sheet: SheetModel) {
  const rowXml = sheet.rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 1;
    const cells = row.map((value, cellIndex) => {
      const ref = `${columnName(cellIndex + 1)}${excelRow}`;
      const style = rowIndex === 0 ? 1 : rowIndex + 1 === sheet.headerRowIndex ? 2 : undefined;
      return cellXml(ref, value, style);
    }).join("");
    return `<row r="${excelRow}">${cells}</row>`;
  }).join("");
  const maxColumns = Math.max(1, ...sheet.rows.map((row) => row.length));
  const maxRows = Math.max(1, sheet.rows.length);
  const dimension = `A1:${columnName(maxColumns)}${maxRows}`;
  const autoFilter = maxRows > sheet.headerRowIndex
    ? `<autoFilter ref="A${sheet.headerRowIndex}:${columnName(maxColumns)}${maxRows}"/>`
    : "";
  return xmlDecl(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${columnWidths(sheet.rows)}</cols><sheetData>${rowXml}</sheetData>${autoFilter}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`);
}

function cellXml(ref: string, value: CellValue, style?: number) {
  const styleAttr = style ? ` s="${style}"` : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"${styleAttr}><v>${value ? 1 : 0}</v></c>`;
  }
  const text = value === null || value === undefined ? "" : String(value);
  return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t>${xmlEscape(text)}</t></is></c>`;
}

function columnWidths(rows: CellValue[][]) {
  const count = Math.max(1, ...rows.map((row) => row.length));
  const widths = Array.from({ length: count }, (_, index) => {
    const max = Math.max(
      10,
      ...rows.map((row) => String(row[index] ?? "").length)
    );
    return Math.min(48, Math.max(12, max + 2));
  });
  return widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
}

function contentTypesXml(sheetCount: number) {
  const sheets = Array.from({ length: sheetCount }, (_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join("");
  return xmlDecl(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets}</Types>`);
}

function rootRelsXml() {
  return xmlDecl(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
}

function workbookXml(sheets: SheetModel[]) {
  const sheetXml = sheets.map((sheet, index) => (
    `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join("");
  return xmlDecl(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetXml}</sheets></workbook>`);
}

function workbookRelsXml(sheetCount: number) {
  const sheetRels = Array.from({ length: sheetCount }, (_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join("");
  return xmlDecl(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
}

function stylesXml() {
  return xmlDecl(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><color rgb="FF10202A"/><name val="Arial"/></font><font><b/><sz val="14"/><color rgb="FF10202A"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF315F60"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD7E2E4"/></left><right style="thin"><color rgb="FFD7E2E4"/></right><top style="thin"><color rgb="FFD7E2E4"/></top><bottom style="thin"><color rgb="FFD7E2E4"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
}

function appPropertiesXml() {
  return xmlDecl(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>AKB</Application></Properties>`);
}

function corePropertiesXml(title: string) {
  const created = new Date().toISOString();
  return xmlDecl(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>AKB</dc:creator><cp:lastModifiedBy>AKB</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`);
}

function zipStore(files: Array<{ path: string; data: Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, "utf-8");
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function boundedString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AssistantReportValidationError(`${field} must be a non-empty string.`);
  }
  return value.trim().slice(0, maxLength);
}

function optionalBoundedString(value: unknown, field: string, maxLength: number) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new AssistantReportValidationError(`${field} must be a string.`);
  }
  return value.trim().slice(0, maxLength) || null;
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, maxItems)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean);
}

function columnName(index: number) {
  let value = "";
  let current = index;
  while (current > 0) {
    const modulo = (current - 1) % 26;
    value = String.fromCharCode(65 + modulo) + value;
    current = Math.floor((current - modulo) / 26);
  }
  return value;
}

function xmlDecl(xml: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`;
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
