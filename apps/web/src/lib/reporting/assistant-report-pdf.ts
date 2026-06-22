import type { AssistantReportArtifact, AssistantReportRow, Citation } from "@/lib/types";

import type { NormalizedReport } from "./assistant-report-xlsx";

type PdfObject = { id: number; body: string | Buffer };

const PDF_MIME_TYPE = "application/pdf";
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const FONT_SIZE = 9;
const TITLE_SIZE = 16;
const LINE_HEIGHT = 13;
const MAX_COLUMN_TEXT = 110;

export function assistantReportPdfMimeType() {
  return PDF_MIME_TYPE;
}

export function safeAssistantReportPdfFilename(report: Pick<AssistantReportArtifact, "title">) {
  const base = report.title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "akb-report";
  return `${base}.pdf`;
}

export function buildAssistantReportPdf(report: NormalizedReport): Buffer {
  const pages = paginateLines(reportLines(report));
  const objects: PdfObject[] = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontRegularId = 3;
  const fontBoldId = 4;
  const fontMonoId = 5;
  const pageIds = pages.map((_, index) => 6 + index * 2);
  const contentIds = pages.map((_, index) => 7 + index * 2);

  objects.push({ id: catalogId, body: `<< /Type /Catalog /Pages ${pagesId} 0 R >>` });
  objects.push({
    id: pagesId,
    body: `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  });
  objects.push({ id: fontRegularId, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" });
  objects.push({ id: fontBoldId, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>" });
  objects.push({ id: fontMonoId, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>" });

  pages.forEach((pageLines, index) => {
    objects.push({
      id: pageIds[index],
      body: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R /F3 ${fontMonoId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`,
    });
    const content = pageContentStream(pageLines, index + 1, pages.length);
    objects.push({
      id: contentIds[index],
      body: `<< /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`,
    });
  });

  return writePdf(objects, catalogId);
}

function reportLines(report: NormalizedReport): Array<{ text: string; kind?: "title" | "heading" | "muted" | "mono" }> {
  const lines: Array<{ text: string; kind?: "title" | "heading" | "muted" | "mono" }> = [];
  lines.push({ text: report.title, kind: "title" });
  if (report.description) {
    for (const line of wrapText(report.description, 92)) {
      lines.push({ text: line, kind: "muted" });
    }
  }
  lines.push({ text: "", kind: "muted" });
  lines.push({ text: "Sestava", kind: "heading" });
  const widths = columnCharWidths(report.columns.length);
  lines.push({
    text: tableLine(report.columns.map((column) => column.label), widths),
    kind: "mono",
  });
  for (const row of report.rows) {
    for (const line of rowTableLines(row, report, widths)) {
      lines.push({ text: line, kind: "mono" });
    }
  }
  lines.push({ text: "", kind: "muted" });
  lines.push({ text: "Citace", kind: "heading" });
  const citationLines = report.rows.flatMap((row) => row.citations.map((citation) => citationLine(row.row_id, citation)));
  if (citationLines.length === 0) {
    lines.push({ text: "Bez citaci.", kind: "muted" });
  } else {
    for (const line of citationLines) {
      for (const wrapped of wrapText(line, 110)) {
        lines.push({ text: wrapped, kind: "muted" });
      }
    }
  }
  return lines;
}

function rowTableLines(row: AssistantReportRow, report: NormalizedReport, widths: number[]) {
  const wrappedCells = report.columns.map((column, index) => {
    const value = formatCell(row.cells[column.key]);
    return wrapText(value, widths[index]).slice(0, 6);
  });
  const rowHeight = Math.max(1, ...wrappedCells.map((cell) => cell.length));
  return Array.from({ length: rowHeight }, (_, lineIndex) => (
    tableLine(wrappedCells.map((cell) => cell[lineIndex] ?? ""), widths)
  ));
}

function tableLine(values: string[], widths: number[]) {
  return values.map((value, index) => fixedWidth(value, widths[index])).join(" | ");
}

function columnCharWidths(count: number) {
  if (count <= 3) {
    return Array.from({ length: count }, () => Math.floor(102 / Math.max(1, count)));
  }
  const width = Math.max(10, Math.floor((112 - (count - 1) * 3) / count));
  return Array.from({ length: count }, () => Math.min(MAX_COLUMN_TEXT, width));
}

function fixedWidth(value: string, width: number) {
  const cleaned = normalizePdfText(value).slice(0, width);
  return cleaned + " ".repeat(Math.max(0, width - cleaned.length));
}

function citationLine(rowId: string, citation: Citation) {
  const page = citation.page_number ? `, page ${citation.page_number}` : "";
  const section = citation.section_path.length ? `, section ${citation.section_path.join(" / ")}` : "";
  return `${rowId}: ${citation.document_title} (${citation.version_label}${page}${section}) - ${citation.chunk_id}`;
}

function formatCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "Ano" : "Ne";
  }
  return String(value);
}

function paginateLines(lines: Array<{ text: string; kind?: "title" | "heading" | "muted" | "mono" }>) {
  const maxLinesPerPage = 52;
  const pages: Array<typeof lines> = [];
  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pages.push(lines.slice(index, index + maxLinesPerPage));
  }
  return pages.length ? pages : [[{ text: "" }]];
}

function pageContentStream(lines: Array<{ text: string; kind?: "title" | "heading" | "muted" | "mono" }>, pageNumber: number, pageCount: number) {
  const commands: string[] = ["q", "1 1 1 rg", `0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} re f`, "0 0 0 rg"];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const font = line.kind === "mono" ? "F3" : line.kind === "title" || line.kind === "heading" ? "F2" : "F1";
    const size = line.kind === "title" ? TITLE_SIZE : FONT_SIZE;
    const x = MARGIN;
    commands.push("BT", `/${font} ${size} Tf`, `${x} ${y} Td`, `(${escapePdfString(normalizePdfText(line.text))}) Tj`, "ET");
    y -= line.kind === "title" ? 22 : LINE_HEIGHT;
  }
  commands.push(
    "BT",
    `/F1 8 Tf`,
    `${MARGIN} 24 Td`,
    `(${escapePdfString(`AKB report - page ${pageNumber}/${pageCount}`)}) Tj`,
    "ET",
    "Q"
  );
  return commands.join("\n");
}

function writePdf(objects: PdfObject[], catalogId: number) {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets: number[] = [0];
  for (const object of objects.sort((left, right) => left.id - right.id)) {
    offsets[object.id] = Buffer.concat(parts).length;
    parts.push(Buffer.from(`${object.id} 0 obj\n`, "binary"));
    parts.push(Buffer.isBuffer(object.body) ? object.body : Buffer.from(object.body, "binary"));
    parts.push(Buffer.from("\nendobj\n", "binary"));
  }
  const xrefOffset = Buffer.concat(parts).length;
  const maxObjectId = Math.max(...objects.map((object) => object.id));
  const xref = ["xref", `0 ${maxObjectId + 1}`, "0000000000 65535 f "];
  for (let id = 1; id <= maxObjectId; id += 1) {
    xref.push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n `);
  }
  parts.push(Buffer.from(`${xref.join("\n")}\n`, "binary"));
  parts.push(Buffer.from(`trailer\n<< /Size ${maxObjectId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "binary"));
  return Buffer.concat(parts);
}

function wrapText(value: string, width: number) {
  const words = normalizePdfText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

function normalizePdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function escapePdfString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
