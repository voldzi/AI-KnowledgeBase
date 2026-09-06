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
  uncompressedSize: number;
  localHeaderOffset: number;
}

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_PREVIEW_ENTRIES = 4096;
const MAX_PREVIEW_XML_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_TOTAL_XML_BYTES = 32 * 1024 * 1024;

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

  const sheets = worksheetEntries.slice(0, 8).map((entryName, index) => {
    const rows = parseWorksheetRows(archive.get(entryName) ?? "", sharedStrings);
    return { name: sheetNames.get(entryName) ?? `Sheet ${index + 1}`, rows: rows.slice(0, 80), truncated: rows.length > 80 };
  });

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
  const { entries, contentEnd } = readCentralDirectory(buffer);
  const result = new Map<string, string>();
  let expandedBytes = 0;

  for (const entry of entries) {
    // A text preview never expands embedded images, macros, fonts or attachments.
    if (!/\.(?:xml|rels)$/.test(entry.name)) continue;
    const remaining = MAX_PREVIEW_TOTAL_XML_BYTES - expandedBytes;
    if (entry.uncompressedSize > MAX_PREVIEW_XML_BYTES || entry.uncompressedSize > remaining) {
      throw new Error("OOXML_PREVIEW_SIZE_LIMIT");
    }
    const localHeaderOffset = entry.localHeaderOffset;
    if (localHeaderOffset + 30 > contentEnd || buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error("OOXML_ZIP_ENTRY_INVALID");
    }
    const filenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + filenameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataStart < 0 || dataEnd > contentEnd || dataStart > dataEnd) {
      throw new Error("OOXML_ZIP_ENTRY_INVALID");
    }
    const localName = buffer.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + filenameLength).toString("utf8");
    if (localName !== entry.name || buffer.readUInt16LE(localHeaderOffset + 8) !== entry.method || (buffer.readUInt16LE(localHeaderOffset + 6) & 1)) {
      throw new Error("OOXML_ZIP_ENTRY_INVALID");
    }
    const compressed = buffer.subarray(dataStart, dataEnd);
    const limit = Math.min(MAX_PREVIEW_XML_BYTES, remaining);
    if (limit <= 0 || (entry.method === 0 && compressed.length > limit)) throw new Error("OOXML_PREVIEW_SIZE_LIMIT");
    // The actual output is bounded too: a forged small directory size is not trusted.
    let content: Buffer;
    try {
      content = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: limit });
    } catch {
      throw new Error("OOXML_ZIP_EXPANSION_REJECTED");
    }
    if (content.length !== entry.uncompressedSize) throw new Error("OOXML_ZIP_SIZE_MISMATCH");
    expandedBytes += content.length;
    result.set(entry.name, content.toString("utf8"));
  }

  return result;
}

function readCentralDirectory(buffer: Buffer): { entries: ZipEntry[]; contentEnd: number } {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (buffer.readUInt16LE(eocdOffset + 4) !== 0 || buffer.readUInt16LE(eocdOffset + 6) !== 0
    || buffer.readUInt16LE(eocdOffset + 8) !== totalEntries
    || totalEntries > MAX_PREVIEW_ENTRIES
    || centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
    throw new Error("OOXML_ZIP_DIRECTORY_INVALID");
  }
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > eocdOffset || buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("OOXML_ZIP_DIRECTORY_INVALID");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + filenameLength).toString("utf8");
    const nextOffset = offset + 46 + filenameLength + extraLength + commentLength;
    if (nextOffset > eocdOffset || !name || name.includes("\0") || name.includes("\\") || name.startsWith("/")
      || name.split("/").includes("..") || names.has(name) || (method !== 0 && method !== 8)
      || (buffer.readUInt16LE(offset + 8) & 1) || localHeaderOffset >= centralDirectoryOffset) {
      throw new Error("OOXML_ZIP_ENTRY_INVALID");
    }
    names.add(name);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nextOffset;
  }
  if (offset !== eocdOffset) throw new Error("OOXML_ZIP_DIRECTORY_INVALID");
  return { entries, contentEnd: centralDirectoryOffset };
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE
      && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) {
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
