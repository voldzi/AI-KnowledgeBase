import {
  extractRegistryDocumentTopics,
  isRegistryDocumentReportQuestion,
  registryReportKindFromMessage,
  type RegistryReportKind
} from "@/lib/reporting/assistant-registry-report";
import type { ResponseLanguage } from "@/lib/types";

import {
  buildAssistantQueryPlan,
  type AssistantQueryPlan
} from "./assistant-query-planner";

export type AssistantToolName = "registry_document_report" | "rag_document_answer";
export type AssistantToolRouteReason = "registry_metadata_intent" | "rag_structured_output" | "rag_grounded_answer";

export interface AssistantToolRoute {
  tool: AssistantToolName;
  reason: AssistantToolRouteReason;
  structuredOutput: boolean;
  obligationOutput: boolean;
  registryReportKind: RegistryReportKind | null;
  registryTopics: string[];
  answerFormatInstruction: string | null;
  queryPlan: AssistantQueryPlan;
}

const STRUCTURED_OUTPUT_RE = /(sestav|report|tabulk|excel|xlsx|export|přehled|prehled|pdf)/i;
const OBLIGATION_OUTPUT_RE = /(povinnost|obligation)/i;

export function routeAssistantMessage(message: string, language: ResponseLanguage): AssistantToolRoute {
  const structuredOutput = STRUCTURED_OUTPUT_RE.test(message);
  const obligationOutput = OBLIGATION_OUTPUT_RE.test(message);
  if (isRegistryDocumentReportQuestion(message)) {
    return withQueryPlan(message, language, {
      tool: "registry_document_report",
      reason: "registry_metadata_intent",
      structuredOutput,
      obligationOutput,
      registryReportKind: registryReportKindFromMessage(message),
      registryTopics: extractRegistryDocumentTopics(message, language),
      answerFormatInstruction: null
    });
  }
  return withQueryPlan(message, language, {
    tool: "rag_document_answer",
    reason: structuredOutput ? "rag_structured_output" : "rag_grounded_answer",
    structuredOutput,
    obligationOutput,
    registryReportKind: null,
    registryTopics: [],
    answerFormatInstruction: structuredOutput ? answerFormatInstruction(language, obligationOutput) : null
  });
}

export function routeAssistantMessageForRag(message: string, language: ResponseLanguage): AssistantToolRoute {
  const route = routeAssistantMessage(message, language);
  if (route.tool === "rag_document_answer") {
    return route;
  }
  return {
    ...route,
    tool: "rag_document_answer",
    reason: route.structuredOutput ? "rag_structured_output" : "rag_grounded_answer",
    registryReportKind: null,
    registryTopics: [],
    answerFormatInstruction: route.structuredOutput ? answerFormatInstruction(language, route.obligationOutput) : null,
    queryPlan: buildAssistantQueryPlan({
      message,
      language,
      tool: "rag_document_answer",
      reason: route.structuredOutput ? "rag_structured_output" : "rag_grounded_answer",
      structuredOutput: route.structuredOutput,
      obligationOutput: route.obligationOutput,
      registryReportKind: null,
      registryTopics: []
    })
  };
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
      registryTopics: route.registryTopics
    })
  };
}

function answerFormatInstruction(language: ResponseLanguage, obligationOutput: boolean): string {
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
  return `${instruction}${obligationInstruction}`;
}
