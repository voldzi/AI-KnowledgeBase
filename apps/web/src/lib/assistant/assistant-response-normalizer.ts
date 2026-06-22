import { normalizeAssistantAnswerReports } from "@/lib/reporting/assistant-answer-report";
import type { AssistantChatResponse, ResponseLanguage } from "@/lib/types";

import type { AssistantToolRoute } from "./assistant-tool-router";

const ASSISTANT_CONTRACT_VERSION = "2026-06-22";

export function normalizeAssistantChatResponse({
  response,
  message,
  language,
  route
}: {
  response: AssistantChatResponse;
  message: string;
  language: ResponseLanguage;
  route: AssistantToolRoute;
}): AssistantChatResponse {
  const normalized = normalizeAssistantAnswerReports(response, message, language);
  return {
    ...normalized,
    current_context: compactContext({
      ...normalized.current_context,
      answer_source: normalized.current_context.answer_source ?? answerSourceForRoute(route),
      assistant_contract_version: ASSISTANT_CONTRACT_VERSION,
      assistant_tool: route.tool,
      assistant_tool_reason: route.reason,
      structured_output_requested: route.structuredOutput,
      obligation_output_requested: route.obligationOutput,
      registry_report_kind: route.registryReportKind,
      registry_topic_count: route.registryTopics.length,
      report_artifact_count: normalized.report_artifacts.length
    })
  };
}

function answerSourceForRoute(route: AssistantToolRoute): string {
  return route.tool === "registry_document_report" ? "registry_metadata" : "rag_retrieval";
}

function compactContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== null && value !== undefined)
  );
}
