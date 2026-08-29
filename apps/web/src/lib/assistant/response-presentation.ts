import type { AssistantChatResponse, RagConfidence, ResponseLanguage } from "@/lib/types";
import { assistantLiveSources } from "./live-source-presentation";

type Translation = readonly [cs: string, en: string];
interface ResponseStatus { value: RagConfidence | "info"; label?: string }

export function assistantResponseStatus(response: AssistantChatResponse, language: ResponseLanguage): ResponseStatus | null {
  const badge = (value: ResponseStatus["value"], labels: Translation): ResponseStatus => ({ value, label: translate(labels, language) });
  const warnings = new Set(response.warnings);
  const workflow = record(response.current_context.workflow_workspace);
  const sources = assistantLiveSources(response.current_context);
  const mixed = record(response.current_context.mixed_evidence);
  if (response.confidence === "conflicting_sources" || warnings.has("CONTROLLED_RULE_CONFLICT")) {
    return badge("conflicting_sources", ["Rozpor ve zdrojích", "Conflicting sources"]);
  }
  if (response.response_type === "clarification_needed") return badge("info", ["Potřebuji upřesnit", "Clarification needed"]);
  if (response.response_type === "restricted" || workflow?.status === "not_authorized") {
    return badge("insufficient_source", ["Omezený přístup", "Access restricted"]);
  }
  if (workflow?.status === "history") return badge("info", ["Obnovit osobní přehled", "Refresh personal overview"]);
  if (warnings.has("LIVE_DATA_EVIDENCE_GATE_FAILED") || warnings.has("LIVE_DATA_CONTRACT_REJECTED")) {
    return badge("insufficient_source", ["Výsledek nelze ověřit", "Result could not be verified"]);
  }
  const incompleteSources = sources.some((source) => ["partial", "unavailable", "not_authorized"].includes(source.status));
  const incompleteComposition = mixed && (mixed.live_data !== "available" || mixed.document_guidance !== "available");
  if (response.response_type === "answer" && (incompleteSources || incompleteComposition || warnings.has("BUDGET_APPROVED_PLAN_MISSING"))) {
    return badge("medium", ["Částečná odpověď", "Partial answer"]);
  }
  if (workflow?.status === "unavailable" || sources.some((source) => source.status === "unavailable")
    || warnings.has("DIRECTOR_COPILOT_V2_SOURCE_UNAVAILABLE") || warnings.has("DOCUMENT_EVIDENCE_UNAVAILABLE")) {
    return badge("insufficient_source", ["Dočasně nedostupné", "Temporarily unavailable"]);
  }
  if (workflow?.status === "no_data") return badge("info", ["Bez přiřazených záznamů", "No assigned records"]);
  if (warnings.has("LIVE_DATA_NO_MATCHING_DATA") || warnings.has("NO_MATCHING_CONTROLLED_RULE")
    || (sources.length > 0 && sources.every((source) => source.status === "no_data"))) {
    return badge("insufficient_source", ["Bez odpovídajících dat", "No matching data"]);
  }
  if (response.response_type === "no_answer" || response.response_type === "handoff_recommended") {
    return badge("insufficient_source", ["Chybí ověřený podklad", "Verified evidence missing"]);
  }
  if (warnings.has("SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE")) return badge("medium", ["Ověřit aktuálnost", "Review freshness"]);
  if (workflow?.status === "complete") return badge("high", ["Ověřený osobní přehled", "Verified personal overview"]);
  if (sources.length > 0 && sources.every((source) => source.status === "complete")) {
    return badge("high", ["Ověřená data", "Verified data"]);
  }
  return response.confidence ? { value: response.confidence } : null;
}

const PROVENANCE_MARKERS = new Set([
  "REGISTRY_METADATA_REPORT", "REGISTRY_METADATA_SUMMARY", "REGISTRY_DOCUMENT_LIST",
  "DIRECTOR_COPILOT_PROJECTFLOW_LIVE_DATA", "DIRECTOR_COPILOT_BUDGET_LIVE_DATA", "DIRECTOR_COPILOT_V2_LIVE_DATA",
  "MIXED_EVIDENCE_COMPOSITION", "LIVE_DATA_FALLBACK_BLOCKED", "LIVE_DATA_NOT_REPLACED_BY_DOCUMENTS",
  "CONVERSATION_HISTORY_DISABLED_FOR_GOVERNED_FEDERATION", "REPORT_MARKDOWN_TABLE_PROMOTED",
]);

const WARNING_LABELS: Record<string, Translation> = {
  SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE: ["Termín revize zdroje uplynul. Aktuálnost má potvrdit gestor.", "The source review is overdue. Its owner must confirm freshness."],
  BUDGET_APPROVED_PLAN_MISSING: ["Část oprávněných rozpočtových větví nemá schválený plán. Výsledek je nezahrnuje ani nenahrazuje nulou.", "Some authorized budget branches have no approved plan. They are excluded, not replaced with zero."],
  CONTROLLED_RULE_CONFLICT: ["Pravidla jsou v rozporu nebo nejsou připravena k rozhodnutí. Musí je posoudit gestor.", "Rules conflict or are not decision-ready. Their owner must review them."],
  NO_MATCHING_CONTROLLED_RULE: ["Pro tento dotaz a datum chybí odpovídající účinné ověřené pravidlo.", "No matching effective verified rule is available for this question and date."],
  NO_APPLICABLE_AUTHORIZED_CONTROLLED_DOCUMENT_PACKAGE: ["K vybranému datu není dostupný odpovídající oprávněný balíček předpisů.", "No matching authorized rule package is available for the selected date."],
  DIRECTOR_COPILOT_V2_MANIFEST_DRIFT: ["Popis integračního rozhraní se změnil. Správce AKB musí ověřit jeho soulad se zdrojem.", "The integration contract changed. An AKB administrator must verify compatibility."],
  DIRECTOR_COPILOT_V2_MANIFEST_UNAVAILABLE: ["Popis integračního rozhraní je dočasně nedostupný.", "The integration contract is temporarily unavailable."],
  DIRECTOR_COPILOT_V2_SOURCE_UNAVAILABLE: ["Živý zdroj je dočasně nedostupný. Zkuste dotaz později.", "The live source is temporarily unavailable. Try again later."],
  DIRECTOR_COPILOT_V2_NOT_AUTHORIZED: ["Váš aktuální přístup nepokrývá požadovaný zdroj nebo rozsah.", "Your current access does not cover the requested source or scope."],
  LIVE_DATA_CONTRACT_REJECTED: ["Odpověď zdroje neodpovídá ověřenému integračnímu kontraktu. Data nebyla použita.", "The source response does not match the verified integration contract. The data was not used."],
  LIVE_DATA_EVIDENCE_GATE_FAILED: ["Data neprošla důkazní kontrolou. Nebyla použita jako ověřená odpověď.", "The data failed the evidence check and was not used as a verified answer."],
  LIVE_DATA_EVIDENCE_COUNT_INCOMPLETE: ["Nebyly doloženy všechny položky. Úplný počet nelze bezpečně určit.", "Not all items were verified. A complete count cannot safely be determined."],
  LIVE_DATA_NO_MATCHING_DATA: ["V oprávněném rozsahu nejsou odpovídající data. Neznamená to nulovou částku ani nulový plán.", "No matching data is available within your authorized scope. This does not mean a zero amount or plan."],
  DOCUMENT_EVIDENCE_UNAVAILABLE: ["Dokumentové podklady jsou dočasně nedostupné.", "Document evidence is temporarily unavailable."],
  DOCUMENT_EVIDENCE_INSUFFICIENT: ["Pro dokumentovou část odpovědi chybí dostatečný citovatelný podklad.", "The document part lacks sufficient citable evidence."],
  WORKFLOW_ACCESS_DENIED: ["Aktuální oprávnění neumožňuje zobrazit osobní pracovní přehled.", "Your current access does not allow the personal workspace overview."],
  WORKFLOW_UNAVAILABLE: ["Osobní přehled se nepodařilo ověřit. Nejde o potvrzení prázdného seznamu.", "The personal overview could not be verified. This does not confirm an empty list."],
  REPORT_ROWS_TRUNCATED: ["Přehled zobrazuje jen část řádků. Upřesněte dotaz pro menší výběr.", "The report shows only some rows. Narrow the query for a smaller result."],
  REGISTRY_SCAN_LIMIT_REACHED: ["Přehled dosáhl limitu načítání a nemusí být úplný.", "The overview reached its loading limit and may be incomplete."],
  CONVERSATION_HISTORY_NOT_PERSISTED: ["Odpověď se nepodařilo uložit do historie konverzace.", "The answer could not be saved in conversation history."],
  REPORT_LIMITED_TO_CITED_SOURCES: ["Přehled obsahuje pouze doložené řádky s ověřenými citacemi.", "The report contains only supported rows with verified citations."],
  LLM_ANSWER_INCOMPLETE: ["Generování odpovědi nebylo dokončeno. Neúplná odpověď nebyla použita; zkuste dotaz zúžit nebo zopakovat.", "Answer generation did not finish. The incomplete answer was not used; narrow or repeat the question."],
};

export function assistantVisibleWarnings(warnings: readonly string[], language: ResponseLanguage): string[] {
  return [...new Set(warnings.filter((warning) => !PROVENANCE_MARKERS.has(warning)).map((warning) => translate(
    WARNING_LABELS[warning] ?? ["Odpověď obsahuje další provozní upozornění. Při opakování potíží kontaktujte správce AKB.", "The response includes an additional operational warning. Contact the AKB administrator if the problem persists."], language,
  )))];
}

function translate(value: Translation, language: ResponseLanguage): string { return value[language === "en" ? 1 : 0]; }
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
