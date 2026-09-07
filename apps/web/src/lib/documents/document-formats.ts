import catalog from "./document-formats.generated.json";

// Generated copies are checked against contracts/document-formats/v1/catalog.json.
export const DOCUMENT_FORMAT_CATALOG = catalog;
export type DocumentFormat = (typeof catalog.formats)[number];
export const ADMITTED_DOCUMENT_FORMATS = catalog.formats.filter((format) => format.admission === "enabled");
export const DOCUMENT_UPLOAD_EXTENSIONS = ADMITTED_DOCUMENT_FORMATS.flatMap((format) => format.extensions);
export const DOCUMENT_UPLOAD_MIME_TYPES = [...new Set(ADMITTED_DOCUMENT_FORMATS.flatMap(
  (format) => [format.mime_type, ...format.mime_aliases],
))];
export const DOCUMENT_UPLOAD_ACCEPT = [...DOCUMENT_UPLOAD_EXTENSIONS, ...DOCUMENT_UPLOAD_MIME_TYPES].join(",");

export function documentFormatForFilename(filename: string): DocumentFormat | undefined {
  const extension = filename.toLowerCase().match(/\.[^.\\/]+$/)?.[0];
  return catalog.formats.find((format) => format.extensions.includes(extension ?? ""));
}

export function documentFormatHint(filename: string, language: "cs" | "en"): string | null {
  return documentFormatForFilename(filename)?.limitation[language] ?? null;
}

export function documentFormatError(filename: string, language: "cs" | "en"): string | null {
  const format = documentFormatForFilename(filename);
  if (format?.admission === "enabled") return null;
  return format?.limitation[language] ?? (language === "cs"
    ? "Tento formát zatím není podporovaný. Exportujte dokument do PDF, DOCX nebo textu UTF-8."
    : "This format is not supported. Export the document to PDF, DOCX or UTF-8 text.");
}
