import type { ResponseLanguage } from "@/lib/types";
import type { RegistryReportKind } from "@/lib/reporting/assistant-registry-report";

import type { AssistantToolName, AssistantToolRouteReason } from "./assistant-tool-router";

export const ASSISTANT_QUERY_PLAN_VERSION = "2026-06-23";
export const ASSISTANT_REPORT_ARTIFACT_CONTRACT_VERSION = "report.v2";

export type AssistantQueryIntent =
  | "document_metadata_report"
  | "document_list"
  | "grounded_answer"
  | "structured_report"
  | "obligation_table";

export type AssistantPlannedOutputKind = "answer" | "table" | "registry_report";

export interface AssistantQueryPlan {
  plan_id: string;
  version: typeof ASSISTANT_QUERY_PLAN_VERSION;
  intent: AssistantQueryIntent;
  tool: AssistantToolName;
  reason: AssistantToolRouteReason;
  language: ResponseLanguage;
  structured_output: boolean;
  obligation_output: boolean;
  output: {
    kind: AssistantPlannedOutputKind;
    artifact_contract_version: typeof ASSISTANT_REPORT_ARTIFACT_CONTRACT_VERSION;
    required_columns: string[];
  };
  quality_gates: {
    citations_required: boolean;
    row_citations_required: boolean;
    min_columns: number | null;
    min_informative_cells_per_row: number | null;
    registry_metadata_without_chunk_citations_allowed: boolean;
  };
  retrieval: {
    registry_report_kind: RegistryReportKind | null;
    topics: string[];
  };
}

export function buildAssistantQueryPlan(input: {
  message: string;
  language: ResponseLanguage;
  tool: AssistantToolName;
  reason: AssistantToolRouteReason;
  structuredOutput: boolean;
  obligationOutput: boolean;
  registryReportKind: RegistryReportKind | null;
  registryTopics: string[];
}): AssistantQueryPlan {
  const intent = queryIntentFor(input);
  const outputKind = outputKindFor(input.tool, intent, input.structuredOutput);
  return {
    plan_id: `plan_${stableHash([
      ASSISTANT_QUERY_PLAN_VERSION,
      input.language,
      input.tool,
      input.reason,
      intent,
      input.registryReportKind ?? "",
      input.registryTopics.join(","),
      normalizePlanMessage(input.message)
    ].join("|")).slice(0, 16)}`,
    version: ASSISTANT_QUERY_PLAN_VERSION,
    intent,
    tool: input.tool,
    reason: input.reason,
    language: input.language,
    structured_output: input.structuredOutput,
    obligation_output: input.obligationOutput,
    output: {
      kind: outputKind,
      artifact_contract_version: ASSISTANT_REPORT_ARTIFACT_CONTRACT_VERSION,
      required_columns: requiredColumnsFor(input.language, intent)
    },
    quality_gates: {
      citations_required: input.tool === "rag_document_answer",
      row_citations_required: input.tool === "rag_document_answer" && input.structuredOutput,
      min_columns: input.structuredOutput || input.tool === "registry_document_report" ? 2 : null,
      min_informative_cells_per_row: input.structuredOutput ? 2 : null,
      registry_metadata_without_chunk_citations_allowed: input.tool === "registry_document_report"
    },
    retrieval: {
      registry_report_kind: input.registryReportKind,
      topics: input.registryTopics
    }
  };
}

function queryIntentFor(input: {
  tool: AssistantToolName;
  structuredOutput: boolean;
  obligationOutput: boolean;
  registryReportKind: RegistryReportKind | null;
}): AssistantQueryIntent {
  if (input.tool === "registry_document_report") {
    return input.registryReportKind === "document_list" ? "document_list" : "document_metadata_report";
  }
  if (input.structuredOutput && input.obligationOutput) {
    return "obligation_table";
  }
  if (input.structuredOutput) {
    return "structured_report";
  }
  return "grounded_answer";
}

function outputKindFor(
  tool: AssistantToolName,
  intent: AssistantQueryIntent,
  structuredOutput: boolean
): AssistantPlannedOutputKind {
  if (tool === "registry_document_report") {
    return "registry_report";
  }
  if (structuredOutput || intent === "obligation_table") {
    return "table";
  }
  return "answer";
}

function requiredColumnsFor(language: ResponseLanguage, intent: AssistantQueryIntent): string[] {
  if (intent !== "obligation_table") {
    return [];
  }
  return language === "en"
    ? ["obligation_or_area", "cited_rule_or_source", "practical_meaning_or_note"]
    : ["povinnost_nebo_oblast", "citovane_ustanoveni_nebo_zdroj", "prakticky_vyznam_nebo_poznamka"];
}

function normalizePlanMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().toLowerCase();
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
