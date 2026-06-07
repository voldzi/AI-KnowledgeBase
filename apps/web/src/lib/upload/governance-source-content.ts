import { buildNativeSourcePreview, type NativeSourcePreview } from "./ooxml-preview";
import {
  createSourceOpenDecision,
  readSourceObject,
  verifySourceDownloadToken,
  type SourceDownloadSettings,
  type SourceOpenRequest
} from "./source-download";

export interface GovernanceSourceContent {
  content: string;
  extracted: boolean;
  warnings: string[];
}

const MAX_GOVERNANCE_CONTENT_CHARS = 180_000;

export async function readGovernanceSourceContent(
  request: SourceOpenRequest,
  settings?: SourceDownloadSettings
): Promise<GovernanceSourceContent> {
  const decision = await createSourceOpenDecision(request, settings);
  if (!decision.available || !decision.download_url) {
    return {
      content: "",
      extracted: false,
      warnings: [decision.unavailable_reason ?? "SOURCE_OBJECT_NOT_AVAILABLE"]
    };
  }

  const token = new URL(`http://akl.local${decision.download_url}`).searchParams.get("token");
  if (!token) {
    return {
      content: "",
      extracted: false,
      warnings: ["SOURCE_DOWNLOAD_TOKEN_MISSING"]
    };
  }

  const payload = verifySourceDownloadToken(token, settings);
  const source = await readSourceObject(payload, settings);
  const extracted = extractTextForGovernance({
    bytes: source.bytes,
    filename: source.filename,
    mimeType: source.mime_type
  });

  return {
    content: limitContent(extracted.content),
    extracted: extracted.extracted,
    warnings: extracted.warnings
  };
}

function extractTextForGovernance({
  bytes,
  filename,
  mimeType
}: {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}): GovernanceSourceContent {
  const normalizedMime = mimeType.toLowerCase();
  const normalizedFilename = filename.toLowerCase();

  if (
    normalizedMime.startsWith("text/") ||
    normalizedMime === "application/xml" ||
    normalizedMime === "application/json" ||
    normalizedFilename.endsWith(".md") ||
    normalizedFilename.endsWith(".markdown") ||
    normalizedFilename.endsWith(".csv") ||
    normalizedFilename.endsWith(".txt")
  ) {
    return {
      content: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
      extracted: true,
      warnings: []
    };
  }

  if (normalizedFilename.endsWith(".docx") || normalizedFilename.endsWith(".xlsx") || normalizedFilename.endsWith(".pptx")) {
    const preview = buildNativeSourcePreview({ bytes, filename, mimeType });
    return ooxmlPreviewToText(preview);
  }

  return {
    content: "",
    extracted: false,
    warnings: ["SOURCE_TEXT_EXTRACTION_UNSUPPORTED"]
  };
}

function ooxmlPreviewToText(preview: NativeSourcePreview): GovernanceSourceContent {
  if (preview.kind === "docx") {
    return {
      content: preview.paragraphs.map((paragraph) => paragraph.text).join("\n\n"),
      extracted: preview.paragraphs.length > 0,
      warnings: [...preview.warnings, ...(preview.truncated ? ["SOURCE_TEXT_TRUNCATED"] : [])]
    };
  }

  if (preview.kind === "xlsx") {
    const content = preview.sheets
      .map((sheet) => [`# ${sheet.name}`, ...sheet.rows.map((row) => row.join("\t"))].join("\n"))
      .join("\n\n");
    return {
      content,
      extracted: content.trim().length > 0,
      warnings: [...preview.warnings, ...(preview.sheets.some((sheet) => sheet.truncated) ? ["SOURCE_TEXT_TRUNCATED"] : [])]
    };
  }

  if (preview.kind === "presentation") {
    const content = preview.slides
      .map((slide) => [`# Slide ${slide.slide_number}${slide.title ? `: ${slide.title}` : ""}`, ...slide.text].join("\n"))
      .join("\n\n");
    return {
      content,
      extracted: content.trim().length > 0,
      warnings: [...preview.warnings, ...(preview.truncated ? ["SOURCE_TEXT_TRUNCATED"] : [])]
    };
  }

  return {
    content: "",
    extracted: false,
    warnings: preview.warnings
  };
}

function limitContent(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= MAX_GOVERNANCE_CONTENT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_GOVERNANCE_CONTENT_CHARS)}\n\n[AKL_SOURCE_TEXT_TRUNCATED]`;
}
