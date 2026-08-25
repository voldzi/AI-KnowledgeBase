import type {
  AssistantChatResponse,
  RagConfidence,
  ResponseLanguage,
} from "@/lib/types";

import type { AssistantUserGoal } from "./user-goal";

const INTERNAL_RAG_WARNINGS = new Set([
  "CONVERSATION_HISTORY_DISABLED_FOR_GOVERNED_FEDERATION",
]);

export function composeMixedEvidenceAssistantResponse(input: {
  directorResponse: AssistantChatResponse;
  documentResponse: AssistantChatResponse | null;
  documentUnavailable: boolean;
  goal: AssistantUserGoal;
  language: ResponseLanguage;
}): AssistantChatResponse {
  const liveAnswer = substantiveLiveAnswer(input.directorResponse);
  const documentAnswer = substantiveDocumentAnswer(input.documentResponse);
  const liveComplete = liveAnswer !== null;
  const documentsComplete = documentAnswer !== null;
  const warnings = unique([
    ...input.directorResponse.warnings,
    ...filteredDocumentWarnings(input.documentResponse),
    "MIXED_EVIDENCE_COMPOSITION",
    ...(!liveComplete ? ["LIVE_DATA_NOT_REPLACED_BY_DOCUMENTS"] : []),
    ...(!documentsComplete
      ? [input.documentUnavailable
          ? "DOCUMENT_EVIDENCE_UNAVAILABLE"
          : "DOCUMENT_EVIDENCE_INSUFFICIENT"]
      : []),
  ]);
  const goalFollowUps = followUpsForGoal(input.goal, input.language);

  if (!liveComplete && !documentsComplete) {
    return {
      ...input.directorResponse,
      confidence: "insufficient_source",
      current_context: mixedContext(
        input.directorResponse.current_context,
        input.goal,
        false,
        false,
      ),
      follow_up_questions: unique([
        ...input.directorResponse.follow_up_questions,
        ...goalFollowUps,
      ]).slice(0, 4),
      warnings,
      recommended_action: input.language === "en"
        ? "Specify the period, organizational scope, and whether you need an explanation, diagnosis, or recommendation."
        : "Upřesněte období, organizační rozsah a zda potřebujete vysvětlení, diagnostiku, nebo doporučení.",
    };
  }

  const sections: string[] = [];
  sections.push(section(
    input.language === "en" ? "Verified live data" : "Ověřená živá data",
    liveAnswer ?? liveDataLimitation(input.directorResponse, input.language),
  ));
  sections.push(section(
    input.language === "en" ? "Cited document guidance" : "Citované dokumentové podklady",
    documentAnswer ?? documentLimitation(input.documentUnavailable, input.language),
  ));
  sections.push(section(
    input.language === "en" ? "How to read this result" : "Jak výsledek číst",
    interpretationBoundary(
      input.goal,
      liveComplete,
      documentsComplete,
      input.language,
    ),
  ));

  return {
    ...input.directorResponse,
    response_type: "answer",
    answer: sections.join("\n\n"),
    message: null,
    questions: [],
    why_needed: null,
    current_context: mixedContext(
      input.directorResponse.current_context,
      input.goal,
      liveComplete,
      documentsComplete,
    ),
    citations: documentsComplete ? input.documentResponse!.citations : [],
    follow_up_questions: unique([
      ...input.directorResponse.follow_up_questions,
      ...(documentsComplete ? input.documentResponse!.follow_up_questions : []),
      ...goalFollowUps,
    ]).slice(0, 4),
    suggested_actions: documentsComplete ? input.documentResponse!.suggested_actions : [],
    report_artifacts: documentsComplete ? input.documentResponse!.report_artifacts : [],
    confidence: mixedConfidence(
      input.directorResponse.confidence,
      documentsComplete ? input.documentResponse!.confidence : null,
      liveComplete,
      documentsComplete,
    ),
    warnings,
    missing_information: liveComplete && documentsComplete
      ? null
      : input.language === "en"
        ? "The answer is missing either current live data or cited document guidance."
        : "Odpovědi chybí buď aktuální živá data, nebo citovaný dokumentový podklad.",
    recommended_action: null,
  };
}

function substantiveLiveAnswer(response: AssistantChatResponse): string | null {
  if (response.response_type !== "answer") return null;
  return response.answer?.trim() || response.message?.trim() || null;
}

function substantiveDocumentAnswer(response: AssistantChatResponse | null): string | null {
  if (!response || response.response_type !== "answer" || response.citations.length === 0) {
    return null;
  }
  return response.answer?.trim() || response.message?.trim() || null;
}

function mixedContext(
  context: Record<string, unknown>,
  goal: AssistantUserGoal,
  liveComplete: boolean,
  documentsComplete: boolean,
): Record<string, unknown> {
  return {
    ...context,
    answer_source: "mixed_evidence",
    assistant_goal: goal,
    answer_composition: "live_and_document_evidence",
    mixed_evidence: {
      live_data: liveComplete ? "available" : "not_available",
      document_guidance: documentsComplete ? "available" : "not_available",
      live_data_substituted_by_documents: false,
    },
  };
}

function section(title: string, body: string): string {
  return `### ${title}\n\n${body}`;
}

function liveDataLimitation(
  response: AssistantChatResponse,
  language: ResponseLanguage,
): string {
  const detail = response.answer?.trim() || response.message?.trim();
  if (detail) return detail;
  return language === "en"
    ? "No verified live result is available for the selected period and authorized scope."
    : "Pro zvolené období a oprávněný rozsah není k dispozici ověřený živý výsledek.";
}

function documentLimitation(unavailable: boolean, language: ResponseLanguage): string {
  if (language === "en") {
    return unavailable
      ? "The document retrieval service is temporarily unavailable. No document-based recommendation was inferred."
      : "No sufficiently precise authorized document source was found. No general recommendation was invented.";
  }
  return unavailable
    ? "Služba dokumentového vyhledávání je dočasně nedostupná. Dokumentové doporučení nebylo domyšleno."
    : "Nebyl nalezen dostatečně přesný oprávněný dokumentový zdroj. Obecné doporučení nebylo domyšleno.";
}

function interpretationBoundary(
  goal: AssistantUserGoal,
  liveComplete: boolean,
  documentsComplete: boolean,
  language: ResponseLanguage,
): string {
  if (goal === "scenario") {
    return language === "en"
      ? "AKB did not calculate hypothetical amounts. Current authorized facts and cited assumptions are shown separately; a scenario needs explicit input values and a governed calculation model."
      : "AKB nevypočítalo hypotetické částky. Aktuální oprávněná fakta a citované předpoklady jsou uvedeny odděleně; scénář vyžaduje konkrétní vstupy a řízený výpočetní model.";
  }
  if (goal === "diagnose") {
    return language === "en"
      ? "AKB does not infer causation from a correlation alone. Live deviations are facts; a cause is stated only when supported by a cited source."
      : "AKB nevyvozuje příčinu pouze ze souběhu údajů. Živé odchylky jsou fakta; příčina je uvedena jen tehdy, pokud ji podporuje citovaný zdroj.";
  }
  if (language === "en") {
    if (liveComplete && documentsComplete) {
      return "Amounts and statuses come only from authorized live tools. Recommendations come only from cited documents; AKB does not treat them as a substitute for missing live data.";
    }
    if (liveComplete) {
      return "Amounts and statuses are verified live facts. Without a cited methodology, AKB does not infer a recommendation from them.";
    }
    return "The document guidance is general and cited. It is not a statement about the current plan because verified live data is missing.";
  }
  if (liveComplete && documentsComplete) {
    return "Částky a stavy pocházejí pouze z oprávněných živých nástrojů. Doporučení vychází pouze z citovaných dokumentů a nenahrazuje chybějící živá data.";
  }
  if (liveComplete) {
    return "Částky a stavy jsou ověřená živá fakta. Bez citované metodiky z nich AKB nedovozuje doporučení.";
  }
  return "Dokumentové doporučení je obecné a citované. Není tvrzením o aktuálním plánu, protože chybí ověřená živá data.";
}

function mixedConfidence(
  live: RagConfidence | null,
  documents: RagConfidence | null,
  liveComplete: boolean,
  documentsComplete: boolean,
): RagConfidence {
  const values = [live, documents];
  if (values.includes("conflicting_sources")) return "conflicting_sources";
  if (values.includes("insufficient_source")) return "insufficient_source";
  if (!liveComplete || !documentsComplete) return "insufficient_source";
  if (values.includes("low")) return "low";
  if (values.includes("medium")) return "medium";
  return "high";
}

function followUpsForGoal(goal: AssistantUserGoal, language: ResponseLanguage): string[] {
  const english: Record<AssistantUserGoal, string[]> = {
    lookup: [],
    explain: ["Which source defines this process?", "Which exceptions apply?"],
    compare: ["Show the most important differences.", "Which source is authoritative?"],
    diagnose: ["Which deviations require attention first?", "What information is still missing?"],
    recommend: ["Which actions have the highest priority?", "What evidence supports each recommendation?"],
    scenario: ["Which assumptions does the scenario use?", "Which risks could change the result?"],
  };
  const czech: Record<AssistantUserGoal, string[]> = {
    lookup: [],
    explain: ["Který zdroj tento postup upravuje?", "Jaké výjimky se uplatní?"],
    compare: ["Ukaž nejdůležitější rozdíly.", "Který zdroj je rozhodující?"],
    diagnose: ["Které odchylky je potřeba řešit nejdříve?", "Jaké informace ještě chybí?"],
    recommend: ["Které kroky mají nejvyšší prioritu?", "Jaký podklad podporuje každé doporučení?"],
    scenario: ["Z jakých předpokladů scénář vychází?", "Která rizika mohou výsledek změnit?"],
  };
  return (language === "en" ? english : czech)[goal];
}

function filteredDocumentWarnings(response: AssistantChatResponse | null): string[] {
  return (response?.warnings ?? []).filter((warning) => !INTERNAL_RAG_WARNINGS.has(warning));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
