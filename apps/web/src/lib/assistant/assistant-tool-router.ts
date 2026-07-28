import {
  extractRegistryDocumentTopics,
  isRegistryDocumentReportQuestion,
  registryReportKindFromMessage,
  type RegistryReportKind
} from "@/lib/reporting/assistant-registry-report";
import type { ResponseLanguage } from "@/lib/types";
import {
  assistantReportColumnLabel,
  assistantReportRequestFromContext,
  type AssistantReportRequest
} from "./assistant-report-request";

import {
  buildAssistantQueryPlan,
  type AssistantQueryPlan
} from "./assistant-query-planner";

export type AssistantToolName =
  | "registry_document_report"
  | "document_search_extract"
  | "rag_document_answer";
export type AssistantToolRouteReason =
  | "registry_metadata_intent"
  | "document_lookup_intent"
  | "rag_structured_output"
  | "rag_grounded_answer";

export interface AssistantToolRoute {
  tool: AssistantToolName;
  reason: AssistantToolRouteReason;
  structuredOutput: boolean;
  obligationOutput: boolean;
  registryReportKind: RegistryReportKind | null;
  registryTopics: string[];
  answerFormatInstruction: string | null;
  queryPlan: AssistantQueryPlan;
  reportRequest: AssistantReportRequest | null;
}

const STRUCTURED_OUTPUT_RE = /(sestav|report|tabulk|excel|xlsx|export|přehled|prehled|pdf|graf|diagram|vizualiz|chart|plot)/i;
const OBLIGATION_OUTPUT_RE = /(povinnost|obligation)/i;
const DOCUMENT_LOOKUP_ACTION_RE = /(?:^|[\s,.;:!?])(najdi|vyhledej|dohledej|ukaž|ukaz|otevři|otevri)(?:\s|$)/i;
const DOCUMENT_LOOKUP_OBJECT_RE = /(dokument|směrnic|smernic|předpis|predpis|zákon|zakon|smlouv|metodik|ustanoven|člán|cl\.|odstav|příloh|priloh|kapitol|sekc|pasáž|pasaz|část|cast|verz|soubor)/i;
const DOCUMENT_QUOTE_RE = /(?:^|[\s,.;:!?])(cituj|ocituj)(?:\s|$)|přesn[ée]\s+znění|presn[ée]\s+zneni|kde\s+je\s+(?:to\s+)?uveden|ve\s+kterém\s+dokumentu|v\s+jakém\s+dokumentu/i;
const DOCUMENT_IDENTIFIER_RE =
  /\b(?:doc|ver)_[a-z0-9_-]{6,}\b|\b(?:čl|cl)\.\s*\d+[a-z]?(?:\s+odst\.\s*\d+)?|\b\d{1,4}\/\d{4}\s*sb\.?\b|\b[A-ZČŘŠŽŤĎŇ]{2,12}\s+\d{1,4}\/\d{2,4}\b|\b\d{2,6}[-/]\d{2,4}[-/][A-Z0-9]{1,12}\b/i;
const SYNTHESIS_RE =
  /(shrň|shrn|vysvět|vysvet|popiš|popis|porov|rozdíl|rozdil|rozpor|povinnost|dopad|rizik|doporuč|doporuc|vyhodnoť|vyhodnot|analyz|co\s+(?:je|znamená|znamena|stanoví|stanovi|upravuje)|k\s+čemu|k\s+cemu|co\s+z\s+toho\s+plyne|praktick[ýy]\s+význam|praktick[ýy]\s+vyznam)/i;

export function routeAssistantMessage(
  message: string,
  language: ResponseLanguage,
  context: Record<string, unknown> = {}
): AssistantToolRoute {
  const reportRequest = assistantReportRequestFromContext(context);
  const structuredOutput = Boolean(reportRequest) || STRUCTURED_OUTPUT_RE.test(message);
  const obligationOutput = reportRequest?.template === "obligation_table" || OBLIGATION_OUTPUT_RE.test(message);
  if (isRegistryDocumentReportQuestion(message, context)) {
    return withQueryPlan(message, language, {
      tool: "registry_document_report",
      reason: "registry_metadata_intent",
      structuredOutput,
      obligationOutput,
      registryReportKind: registryReportKindFromMessage(message, context),
      registryTopics: extractRegistryDocumentTopics(message, language),
      answerFormatInstruction: null,
      reportRequest
    });
  }
  if (isDocumentSearchExtractQuestion(message, structuredOutput)) {
    return withQueryPlan(message, language, {
      tool: "document_search_extract",
      reason: "document_lookup_intent",
      structuredOutput: false,
      obligationOutput: false,
      registryReportKind: null,
      registryTopics: [],
      answerFormatInstruction: null,
      reportRequest: null
    });
  }
  return withQueryPlan(message, language, {
    tool: "rag_document_answer",
    reason: structuredOutput ? "rag_structured_output" : "rag_grounded_answer",
    structuredOutput,
    obligationOutput,
    registryReportKind: null,
    registryTopics: [],
    answerFormatInstruction: structuredOutput ? answerFormatInstruction(language, obligationOutput, reportRequest) : null,
    reportRequest
  });
}

export function routeAssistantMessageForRag(
  message: string,
  language: ResponseLanguage,
  context: Record<string, unknown> = {}
): AssistantToolRoute {
  const route = routeAssistantMessage(message, language, context);
  if (route.tool === "rag_document_answer") {
    return route;
  }
  return {
    ...route,
    tool: "rag_document_answer",
    reason: route.structuredOutput ? "rag_structured_output" : "rag_grounded_answer",
    registryReportKind: null,
    registryTopics: [],
    answerFormatInstruction: route.structuredOutput ? answerFormatInstruction(language, route.obligationOutput, route.reportRequest) : null,
    queryPlan: buildAssistantQueryPlan({
      message,
      language,
      tool: "rag_document_answer",
      reason: route.structuredOutput ? "rag_structured_output" : "rag_grounded_answer",
      structuredOutput: route.structuredOutput,
      obligationOutput: route.obligationOutput,
      registryReportKind: null,
      registryTopics: [],
      reportRequest: route.reportRequest
    }),
    reportRequest: route.reportRequest
  };
}

function isDocumentSearchExtractQuestion(message: string, structuredOutput: boolean): boolean {
  if (!message.trim() || structuredOutput || SYNTHESIS_RE.test(message)) {
    return false;
  }
  if (DOCUMENT_QUOTE_RE.test(message) || DOCUMENT_IDENTIFIER_RE.test(message)) {
    return true;
  }
  return DOCUMENT_LOOKUP_ACTION_RE.test(message) && DOCUMENT_LOOKUP_OBJECT_RE.test(message);
}

export function ragContextForAssistantRoute(
  context: Record<string, unknown>,
  route: AssistantToolRoute
): Record<string, unknown> {
  if (!route.answerFormatInstruction) {
    return {
      ...context,
      assistant_query_plan: route.queryPlan
    };
  }
  return {
    ...context,
    assistant_query_plan: route.queryPlan,
    answer_format_instruction: route.answerFormatInstruction
  };
}

function withQueryPlan(
  message: string,
  language: ResponseLanguage,
  route: Omit<AssistantToolRoute, "queryPlan">
): AssistantToolRoute {
  return {
    ...route,
    queryPlan: buildAssistantQueryPlan({
      message,
      language,
      tool: route.tool,
      reason: route.reason,
      structuredOutput: route.structuredOutput,
      obligationOutput: route.obligationOutput,
      registryReportKind: route.registryReportKind,
      registryTopics: route.registryTopics,
      reportRequest: route.reportRequest
    })
  };
}

function answerFormatInstruction(
  language: ResponseLanguage,
  obligationOutput: boolean,
  reportRequest: AssistantReportRequest | null
): string {
  const instruction = language === "en"
    ? [
        "Structured output requirement:",
        "- If you answer with a table, return a Markdown table with at least two meaningful columns.",
        "- For obligations, prefer columns: obligation/area, cited rule or source, practical meaning/note.",
        "- Do not return a one-column list as a table. If a detail is not present in the cited source, write \"not stated\"."
      ].join("\n")
    : [
        "Požadavek na strukturovaný výstup:",
        "- Pokud odpovídáš tabulkou, vrať markdown tabulku s alespoň dvěma významovými sloupci.",
        "- Pro povinnosti preferuj sloupce: povinnost/oblast, citované ustanovení nebo zdroj, praktický význam/poznámka.",
        "- Nevracej jednosloupcový seznam jako tabulku. Pokud detail není v citovaném zdroji uvedený, napiš \"neuvedeno\"."
      ].join("\n");
  const obligationInstruction = obligationOutput
    ? language === "en"
      ? "\n- For every obligation row, include the best source-supported explanation available."
      : "\n- U každého řádku povinnosti uveď nejlepší dostupné vysvětlení podložené zdrojem."
    : "";
  const reportModeInstruction = reportRequest
    ? reportRequestInstruction(language, reportRequest)
    : "";
  return `${instruction}${obligationInstruction}${reportModeInstruction}`;
}

function reportRequestInstruction(language: ResponseLanguage, request: AssistantReportRequest): string {
  const columns = request.columns.map((column) => assistantReportColumnLabel(column, language)).join(", ");
  const detail = language === "en"
    ? `\n- Detail level requested by the user: ${request.detail_level}.`
    : `\n- Uživatel zvolil úroveň detailu: ${request.detail_level}.`;
  const exportFormat = language === "en"
    ? `\n- Preferred export format in the UI: ${request.export_format}.`
    : `\n- Preferovaný export v UI: ${request.export_format}.`;
  const columnInstruction = language === "en"
    ? `\n- Use these requested columns when the cited sources support them: ${columns}.`
    : `\n- Použij tyto zvolené sloupce, pokud je citované zdroje podporují: ${columns}.`;
  const citationInstruction = language === "en"
    ? "\n- Each table row must be traceable to the cited sources; write \"not stated\" where a requested detail is absent."
    : "\n- Každý řádek tabulky musí být dohledatelný v citovaných zdrojích; pokud zvolený detail chybí, napiš \"neuvedeno\".";
  return `${detail}${exportFormat}${columnInstruction}${citationInstruction}`;
}
