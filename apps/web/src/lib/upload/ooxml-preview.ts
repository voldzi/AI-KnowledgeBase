import { inflateRawSync } from "node:zlib";

export type NativeSourcePreview =
  | {
      kind: "docx";
      filename: string;
      paragraphs: Array<{ index: number; text: string; style: string | null }>;
      truncated: boolean;
      warnings: string[];
    }
  | {
      kind: "xlsx";
      filename: string;
      sheets: Array<{
        name: string;
        rows: string[][];
        truncated: boolean;
      }>;
      warnings: string[];
    }
  | {
      kind: "presentation";
      filename: string;
      slides: Array<{
        slide_number: number;
        title: string | null;
        text: string[];
      }>;
      truncated: boolean;
      warnings: string[];
    }
  | {
      kind: "unsupported";
      filename: string;
      warnings: string[];
    };

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

export function buildNativeSourcePreview({
  bytes,
  filename,
  mimeType
}: {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}): NativeSourcePreview {
  const normalizedFilename = filename.toLowerCase();
  if (normalizedFilename.endsWith(".docx")) {
    return buildDocxPreview(bytes, filename);
  }
  if (normalizedFilename.endsWith(".xlsx")) {
    return buildXlsxPreview(bytes, filename);
  }
  if (normalizedFilename.endsWith(".pptx") || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return buildPresentationPreview(bytes, filename);
  }
  return {
    kind: "unsupported",
    filename,
    warnings: ["UNSUPPORTED_NATIVE_PREVIEW_TYPE"]
  };
}

function buildDocxPreview(bytes: Uint8Array, filename: string): NativeSourcePreview {
  const archive = readZipEntries(bytes);
  const documentXml = archive.get("word/document.xml");
  if (!documentXml) {
    return { kind: "docx", filename, paragraphs: [], truncated: false, warnings: ["DOCX_DOCUMENT_XML_MISSING"] };
  }

  const paragraphs = [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match, index) => ({
      index: index + 1,
      style: docxParagraphStyle(match[0]),
      text: extractXmlText(match[0], "w:t")
    }))
    .filter((paragraph) => paragraph.text.trim().length > 0)
    .slice(0, 120);

  return {
    kind: "docx",
    filename,
    paragraphs,
    truncated: paragraphs.length >= 120,
    warnings: []
  };
}

function buildXlsxPreview(bytes: Uint8Array, filename: string): NativeSourcePreview {
  const archive = readZipEntries(bytes);
  const sharedStrings = parseSharedStrings(archive.get("xl/sharedStrings.xml") ?? "");
  const sheetNames = parseWorkbookSheetNames(archive);
  const worksheetEntries = [...archive.keys()]
    .filter((name) => name.match(/^xl\/worksheets\/sheet\d+\.xml$/))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const sheets = worksheetEntries.slice(0, 8).map((entryName, index) => ({
    name: sheetNames.get(entryName) ?? `Sheet ${index + 1}`,
    rows: parseWorksheetRows(archive.get(entryName) ?? "", sharedStrings).slice(0, 80),
    truncated: parseWorksheetRows(archive.get(entryName) ?? "", sharedStrings).length > 80
  }));

  return {
    kind: "xlsx",
    filename,
    sheets,
    warnings: worksheetEntries.length > 8 ? ["XLSX_SHEETS_TRUNCATED"] : []
  };
}

function buildPresentationPreview(bytes: Uint8Array, filename: string): NativeSourcePreview {
  const archive = readZipEntries(bytes);
  const slideEntries = [...archive.keys()]
    .filter((name) => name.match(/^ppt\/slides\/slide\d+\.xml$/))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const slides = slideEntries.slice(0, 40).map((entryName, index) => {
    const text = extractPresentationText(archive.get(entryName) ?? "");
    return {
      slide_number: index + 1,
      title: text[0] ?? null,
      text
    };
  });

  return {
    kind: "presentation",
    filename,
    slides,
    truncated: slideEntries.length > 40,
    warnings: []
  };
}

function readZipEntries(bytes: Uint8Array): Map<string, string> {
  const buffer = Buffer.from(bytes);
  const entries = readCentralDirectory(buffer);
  const result = new Map<string, string>();

  for (const entry of entries) {
    if (entry.name.includes("..") || entry.name.startsWith("/")) {
      continue;
    }
    const localHeaderOffset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
      continue;
    }
    const filenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + filenameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataStart < 0 || dataEnd > buffer.length || dataStart > dataEnd) {
      continue;
    }
    const compressed = buffer.subarray(dataStart, dataEnd);
    const content = entry.method === 0 ? compressed : entry.method === 8 ? inflateRawSync(compressed) : null;
    if (content) {
      result.set(entry.name, content.toString("utf8"));
    }
  }

  return result;
}

function readCentralDirectory(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      break;
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + filenameLength).toString("utf8");
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + filenameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  throw new Error("OOXML_ZIP_DIRECTORY_MISSING");
}

function docxParagraphStyle(xml: string): string | null {
  const match = xml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/);
  return match ? decodeXml(match[1]) : null;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map((match) => extractXmlText(match[0], "t"));
}

function parseWorkbookSheetNames(archive: Map<string, string>): Map<string, string> {
  const workbookXml = archive.get("xl/workbook.xml") ?? "";
  const relsXml = archive.get("xl/_rels/workbook.xml.rels") ?? "";
  const rels = new Map<string, string>();
  for (const rel of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    rels.set(rel[1], `xl/${rel[2].replace(/^\//, "")}`);
  }

  const names = new Map<string, string>();
  for (const sheet of workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = rels.get(sheet[2]);
    if (target) {
      names.set(target, decodeXml(sheet[1]));
    }
  }
  return names;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  return [...xml.matchAll(/<row\b[\s\S]*?<\/row>/g)].map((rowMatch) => {
    const cells = [...rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map((cellMatch) =>
      parseWorksheetCell(cellMatch[1], cellMatch[2], sharedStrings)
    );
    return cells;
  });
}

function parseWorksheetCell(attributes: string, xml: string, sharedStrings: string[]): string {
  const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? "";
  if (type === "inlineStr") {
    return extractXmlText(xml, "t");
  }
  const value = xml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") {
    return sharedStrings[Number(value)] ?? "";
  }
  return decodeXml(value);
}

function extractPresentationText(xml: string): string[] {
  return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean);
}

function extractXmlText(xml: string, tagName: string): string {
  const escapedTagName = tagName.replace(":", "\\:");
  const pattern = new RegExp(`<${escapedTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTagName}>`, "g");
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1])).join("");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
