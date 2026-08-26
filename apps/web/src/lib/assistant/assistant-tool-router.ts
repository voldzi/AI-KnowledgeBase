import {
  extractRegistryDocumentTopics,
  isRegistryDocumentReportQuestion,
  registryReportKindFromMessage,
  type RegistryReportKind
} from "@/lib/reporting/assistant-registry-report";
import type { AnswerMode, ResponseLanguage } from "@/lib/types";
import {
  assistantReportColumnLabel,
  assistantReportRequestFromContext,
  type AssistantReportRequest
} from "./assistant-report-request";

import {
  buildAssistantQueryPlan,
  type AssistantQueryPlan
} from "./assistant-query-planner";
import {
  controlledRuleIntentFromMessage,
  type ControlledRuleIntent,
} from "./controlled-rule-answer";
import {
  resolveDocumentKnowledgeIntent,
  type DocumentKnowledgeIntentResolution,
} from "./document-knowledge-intent";

export type AssistantToolName = "controlled_rule_answer" | "registry_document_report" | "rag_document_answer";
export type AssistantToolRouteReason =
  | "controlled_rule_intent"
  | "registry_metadata_intent"
  | "rag_structured_output"
  | "rag_document_task"
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
  controlledRuleIntent: ControlledRuleIntent | null;
  documentKnowledge: DocumentKnowledgeIntentResolution;
  answerMode: AnswerMode;
}

const ANSWER_MODES = new Set<AnswerMode>([
  "ask",
  "standard_answer",
  "normative_with_citations",
  "normative_answer_with_citations",
  "retrieve_only",
  "compare",
  "compare_documents",
  "summary",
  "extract_obligations",
  "extract_roles",
  "extract_deadlines",
  "extract_risks",
  "find_procedure",
  "find_owner",
  "find_responsibility",
  "create_checklist",
  "create_faq",
  "create_kb_article",
  "find_conflicts",
  "find_missing_metadata",
  "explain_process",
  "it_support_answer",
  "manager_brief",
  "audit_question",
]);

const STRUCTURED_OUTPUT_RE = /(sestav|report|tabulk|excel|xlsx|export|přehled|prehled|pdf|graf|diagram|vizualiz|chart|plot)/i;
const OBLIGATION_OUTPUT_RE = /(povinnost|obligation)/i;

export function routeAssistantMessage(
  message: string,
  language: ResponseLanguage,
  context: Record<string, unknown> = {}
): AssistantToolRoute {
  const reportRequest = assistantReportRequestFromContext(context);
  const documentKnowledge = resolveDocumentKnowledgeIntent(message, context);
  const structuredOutput = Boolean(reportRequest) || STRUCTURED_OUTPUT_RE.test(message);
  const obligationOutput = reportRequest?.template === "obligation_table" || OBLIGATION_OUTPUT_RE.test(message);
  const controlledRuleIntent = controlledRuleIntentFromMessage(message, context);
  if (controlledRuleIntent) {
    return withQueryPlan(message, language, {
      tool: "controlled_rule_answer",
      reason: "controlled_rule_intent",
      structuredOutput: false,
      obligationOutput: false,
      registryReportKind: null,
      registryTopics: [],
      answerFormatInstruction: null,
      reportRequest: null,
      controlledRuleIntent,
      documentKnowledge,
      answerMode: "normative_with_citations",
    });
  }
  if (isRegistryDocumentReportQuestion(message, context)) {
    return withQueryPlan(message, language, {
      tool: "registry_document_report",
      reason: "registry_metadata_intent",
      structuredOutput,
      obligationOutput,
      registryReportKind: registryReportKindFromMessage(message, context),
      registryTopics: extractRegistryDocumentTopics(message, language),
      answerFormatInstruction: null,
      reportRequest,
      controlledRuleIntent: null,
      documentKnowledge,
      answerMode: "it_support_answer",
    });
  }
  return withQueryPlan(message, language, {
    tool: "rag_document_answer",
    reason: structuredOutput
      ? "rag_structured_output"
      : documentKnowledge.taskOriented
        ? "rag_document_task"
        : "rag_grounded_answer",
    structuredOutput,
    obligationOutput,
    registryReportKind: null,
    registryTopics: [],
    answerFormatInstruction: ragAnswerFormatInstruction(
      language,
      structuredOutput,
      obligationOutput,
      reportRequest,
      documentKnowledge,
    ),
    reportRequest,
    controlledRuleIntent: null,
    documentKnowledge,
    answerMode: documentKnowledge.answerMode,
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
    reason: route.structuredOutput
      ? "rag_structured_output"
      : route.documentKnowledge.taskOriented
        ? "rag_document_task"
        : "rag_grounded_answer",
    registryReportKind: null,
    registryTopics: [],
    answerFormatInstruction: ragAnswerFormatInstruction(
      language,
      route.structuredOutput,
      route.obligationOutput,
      route.reportRequest,
      route.documentKnowledge,
    ),
    queryPlan: buildAssistantQueryPlan({
      message,
      language,
      tool: "rag_document_answer",
      reason: route.structuredOutput
        ? "rag_structured_output"
        : route.documentKnowledge.taskOriented
          ? "rag_document_task"
          : "rag_grounded_answer",
      structuredOutput: route.structuredOutput,
      obligationOutput: route.obligationOutput,
      registryReportKind: null,
      registryTopics: [],
      documentKnowledgeIntent: route.documentKnowledge.intent,
      reportRequest: route.reportRequest
    }),
    reportRequest: route.reportRequest,
    controlledRuleIntent: null,
    answerMode: route.documentKnowledge.answerMode,
  };
}

export function ragContextForAssistantRoute(
  context: Record<string, unknown>,
  route: AssistantToolRoute
): Record<string, unknown> {
  const routedContext: Record<string, unknown> = {
    ...context,
    assistant_query_plan: route.queryPlan,
    document_knowledge_state: {
      version: route.documentKnowledge.version,
      intent: route.documentKnowledge.intent,
      answer_mode: route.documentKnowledge.answerMode,
      task_oriented: route.documentKnowledge.taskOriented,
      explicit: route.documentKnowledge.explicit,
      inherited: route.documentKnowledge.inherited,
    },
    document_retrieval_hints: route.documentKnowledge.retrievalHints,
  };
  if (route.answerFormatInstruction) {
    routedContext.answer_format_instruction = route.answerFormatInstruction;
  }
  return routedContext;
}

export function answerModeForAssistantRequest(
  route: AssistantToolRoute,
  requestedMode: unknown,
): AnswerMode {
  if (
    typeof requestedMode === "string"
    && requestedMode !== "ask"
    && ANSWER_MODES.has(requestedMode as AnswerMode)
  ) {
    return requestedMode as AnswerMode;
  }
  return route.answerMode;
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
      documentKnowledgeIntent: route.documentKnowledge.intent,
      reportRequest: route.reportRequest
    })
  };
}

function structuredAnswerFormatInstruction(
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

function ragAnswerFormatInstruction(
  language: ResponseLanguage,
  structuredOutput: boolean,
  obligationOutput: boolean,
  reportRequest: AssistantReportRequest | null,
  documentKnowledge: DocumentKnowledgeIntentResolution,
): string | null {
  const instructions: string[] = [];
  if (structuredOutput) {
    instructions.push(structuredAnswerFormatInstruction(language, obligationOutput, reportRequest));
  }
  if (documentKnowledge.taskOriented) {
    instructions.push(documentTaskInstruction(language, documentKnowledge.intent));
  }
  return instructions.length ? instructions.join("\n\n") : null;
}

function documentTaskInstruction(
  language: ResponseLanguage,
  intent: DocumentKnowledgeIntentResolution["intent"],
): string {
  const common = language === "en"
    ? "Use only authorized cited documents. Never invent a form, link, contact, owner, deadline, or support channel."
    : "Použij pouze oprávněné citované dokumenty. Nikdy nevymýšlej formulář, odkaz, kontakt, vlastníka, termín ani kanál podpory.";
  const instructions: Record<DocumentKnowledgeIntentResolution["intent"], string> = language === "en"
    ? {
        general: "Answer the question from cited evidence.",
        procedure: "Give actionable ordered steps, prerequisites, responsible roles, and the next action when stated.",
        resource: "Identify the exact resource and where to find it. Include a link or file name only when present in a citation.",
        support_channel: "Identify the documented support channel and what information to provide. Do not assume a service desk exists.",
        owner: "Name the responsible role or contact only when explicitly supported and distinguish owner from approver.",
        responsibility: "Separate responsibilities by role and state unclear boundaries.",
        deadline: "List the applicable deadline, trigger, and exceptions; do not infer missing dates.",
        obligation: "List required actions, documents, prerequisites, and deadlines supported by sources.",
        policy: "Explain the applicable rule, scope, effective version, and exceptions with citations.",
      }
    : {
        general: "Odpověz na dotaz z citované evidence.",
        procedure: "Uveď proveditelné kroky v pořadí, podmínky, odpovědné role a další krok, pokud je zdroj stanoví.",
        resource: "Urči přesný formulář nebo zdroj a kde jej najít. Odkaz či název souboru uveď jen tehdy, když je ve zdroji.",
        support_channel: "Urči doložený kanál podpory a údaje potřebné k nahlášení. Nepředpokládej, že existuje Service Desk.",
        owner: "Uveď odpovědnou roli nebo kontakt jen při výslovné opoře ve zdroji a odliš vlastníka od schvalovatele.",
        responsibility: "Odděl odpovědnosti podle rolí a označ nejasné hranice.",
        deadline: "Uveď platnou lhůtu, její spouštěcí událost a výjimky; chybějící termíny neodvozuj.",
        obligation: "Uveď požadované úkony, doklady, podmínky a termíny podložené zdroji.",
        policy: "Vysvětli použitelné pravidlo, rozsah, účinnou verzi a výjimky s citacemi.",
      };
  return `${common}\n${instructions[intent]}`;
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
