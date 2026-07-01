import type { ResponseLanguage } from "@/lib/types";

export const ASSISTANT_REPORT_REQUEST_CONTEXT_KEY = "assistant_report_request";

export type AssistantReportTemplate = "obligation_table" | "source_summary" | "decision_matrix";
export type AssistantReportDetailLevel = "brief" | "standard" | "detailed";
export type AssistantReportExportPreference = "xlsx" | "pdf" | "both";
export type AssistantReportColumnKey =
  | "obligation_or_area"
  | "cited_rule_or_source"
  | "practical_meaning_or_note"
  | "owner_or_role"
  | "deadline_or_frequency"
  | "source_document"
  | "page_or_section"
  | "evidence_summary"
  | "decision_or_recommendation"
  | "risk_or_priority";

export interface AssistantReportRequest {
  enabled: true;
  output_kind: "table";
  template: AssistantReportTemplate;
  detail_level: AssistantReportDetailLevel;
  export_format: AssistantReportExportPreference;
  columns: AssistantReportColumnKey[];
  require_row_citations: true;
}

export const ASSISTANT_REPORT_TEMPLATE_DEFAULT_COLUMNS: Record<AssistantReportTemplate, AssistantReportColumnKey[]> = {
  obligation_table: ["obligation_or_area", "cited_rule_or_source", "practical_meaning_or_note"],
  source_summary: ["source_document", "evidence_summary", "page_or_section"],
  decision_matrix: ["decision_or_recommendation", "risk_or_priority", "evidence_summary"]
};

const REPORT_TEMPLATES = new Set<AssistantReportTemplate>(["obligation_table", "source_summary", "decision_matrix"]);
const REPORT_DETAIL_LEVELS = new Set<AssistantReportDetailLevel>(["brief", "standard", "detailed"]);
const REPORT_EXPORT_PREFERENCES = new Set<AssistantReportExportPreference>(["xlsx", "pdf", "both"]);
const REPORT_COLUMNS = new Set<AssistantReportColumnKey>([
  "obligation_or_area",
  "cited_rule_or_source",
  "practical_meaning_or_note",
  "owner_or_role",
  "deadline_or_frequency",
  "source_document",
  "page_or_section",
  "evidence_summary",
  "decision_or_recommendation",
  "risk_or_priority"
]);

const REPORT_COLUMN_LABELS: Record<AssistantReportColumnKey, Record<ResponseLanguage, string>> = {
  obligation_or_area: { cs: "Povinnost nebo oblast", en: "Obligation or area" },
  cited_rule_or_source: { cs: "Citované ustanovení nebo zdroj", en: "Cited rule or source" },
  practical_meaning_or_note: { cs: "Praktický význam nebo poznámka", en: "Practical meaning or note" },
  owner_or_role: { cs: "Vlastník nebo role", en: "Owner or role" },
  deadline_or_frequency: { cs: "Termín nebo periodicita", en: "Deadline or frequency" },
  source_document: { cs: "Zdrojový dokument", en: "Source document" },
  page_or_section: { cs: "Strana nebo oddíl", en: "Page or section" },
  evidence_summary: { cs: "Důkazní shrnutí", en: "Evidence summary" },
  decision_or_recommendation: { cs: "Rozhodnutí nebo doporučení", en: "Decision or recommendation" },
  risk_or_priority: { cs: "Riziko nebo priorita", en: "Risk or priority" }
};

export function assistantReportRequestFromContext(context: Record<string, unknown>): AssistantReportRequest | null {
  const candidate = context[ASSISTANT_REPORT_REQUEST_CONTEXT_KEY];
  return normalizeAssistantReportRequest(candidate);
}

export function normalizeAssistantReportRequest(value: unknown): AssistantReportRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (source.enabled !== true) {
    return null;
  }
  const template = typeof source.template === "string" && REPORT_TEMPLATES.has(source.template as AssistantReportTemplate)
    ? source.template as AssistantReportTemplate
    : "obligation_table";
  const detailLevel = typeof source.detail_level === "string" && REPORT_DETAIL_LEVELS.has(source.detail_level as AssistantReportDetailLevel)
    ? source.detail_level as AssistantReportDetailLevel
    : "standard";
  const exportFormat = typeof source.export_format === "string" && REPORT_EXPORT_PREFERENCES.has(source.export_format as AssistantReportExportPreference)
    ? source.export_format as AssistantReportExportPreference
    : "xlsx";
  const requestedColumns = Array.isArray(source.columns)
    ? source.columns.filter((item): item is AssistantReportColumnKey => typeof item === "string" && REPORT_COLUMNS.has(item as AssistantReportColumnKey))
    : [];
  const columns = dedupeColumns(requestedColumns.length >= 2 ? requestedColumns : ASSISTANT_REPORT_TEMPLATE_DEFAULT_COLUMNS[template]);
  return {
    enabled: true,
    output_kind: "table",
    template,
    detail_level: detailLevel,
    export_format: exportFormat,
    columns,
    require_row_citations: true
  };
}

export function assistantReportColumnLabel(column: AssistantReportColumnKey, language: ResponseLanguage): string {
  return REPORT_COLUMN_LABELS[column]?.[language] ?? column;
}

export function assistantReportExportFormats(request: AssistantReportRequest | null): Array<"xlsx" | "pdf"> {
  if (!request) {
    return ["xlsx", "pdf"];
  }
  if (request.export_format === "both") {
    return ["xlsx", "pdf"];
  }
  return [request.export_format];
}

function dedupeColumns(columns: AssistantReportColumnKey[]): AssistantReportColumnKey[] {
  return Array.from(new Set(columns)).slice(0, 8);
}
