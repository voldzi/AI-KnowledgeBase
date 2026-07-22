import "server-only";

import { randomUUID } from "node:crypto";

import { getDirectorCopilotConfig, type AklConfig } from "@/lib/api/config";
import { normalizeAssistantChatResponse } from "@/lib/assistant/assistant-response-normalizer";
import { ragContextForAssistantRoute, routeAssistantMessageForRag } from "@/lib/assistant/assistant-tool-router";
import type { ApiClients, ApiRequestContext, AssistantChatResponse, ResponseLanguage } from "@/lib/types";

import type { AnalysisSnapshot, DirectorQueryPlan, EvidenceItem } from "./contracts";
import { accessProjectionHash, domainAccessFor } from "./access";
import { DirectorDomainToolClient } from "./domain-tool-client";
import { directorCopilotPromptEvidence, finalizeDirectorSnapshot, orchestrateDirectorCopilot } from "./orchestrator";

export async function runDirectorCopilotChat(input: {
  message: string;
  conversationId: string | null;
  responseLanguage: ResponseLanguage;
  actorContext: ApiRequestContext;
  clients: ApiClients;
  config: AklConfig;
  refreshActorContext?: () => Promise<ApiRequestContext>;
}): Promise<AssistantChatResponse> {
  const domainClient = new DirectorDomainToolClient({ config: input.config });
  const directorConfig = getDirectorCopilotConfig(input.config);
  const orchestration = await orchestrateDirectorCopilot({
    message: input.message,
    language: input.responseLanguage,
    context: input.actorContext,
    client: domainClient,
    timeoutMs: directorConfig.timeoutMs,
  });
  if (!orchestration.snapshot) {
    const response = emptyDirectorResponse(
      input.conversationId,
      orchestration.status,
      input.responseLanguage,
      orchestration.warnings,
      orchestration.plan,
    );
    await auditDirectorResult(input, response, orchestration.plan, null, orchestration.status);
    return response;
  }
  const snapshot = orchestration.snapshot;
  if (input.refreshActorContext) {
    const refreshedContext = await input.refreshActorContext();
    const projectionChanged = refreshedContext.subjectId !== input.actorContext.subjectId
      || accessProjectionHash(refreshedContext) !== snapshot.projection_hash
      || !domainAccessFor(refreshedContext, "budget").authorized
      || !domainAccessFor(refreshedContext, "projectflow").authorized;
    if (projectionChanged) {
      const response = emptyDirectorResponse(
        input.conversationId,
        "not_authorized",
        input.responseLanguage,
        [...orchestration.warnings, "ACCESS_PROJECTION_CHANGED_BEFORE_SYNTHESIS"],
        orchestration.plan,
      );
      await auditDirectorResult(input, response, orchestration.plan, null, "not_authorized");
      return response;
    }
  }
  if (blocksAiProcessing(snapshot)) {
    const response = composeFourLayerResponse(
      policyBlockedDocumentResponse(input.conversationId, input.responseLanguage),
      snapshot,
      input.responseLanguage,
      [...orchestration.warnings, "DIRECTOR_COPILOT_AI_POLICY_BLOCKED"],
    );
    await auditDirectorResult(input, response, orchestration.plan, snapshot, "policy_blocked");
    return response;
  }
  const route = routeAssistantMessageForRag(input.message, input.responseLanguage, {});
  const ragContext = ragContextForAssistantRoute({
    tags: snapshot.document_context_tags,
    director_copilot_evidence: directorCopilotPromptEvidence(snapshot),
    answer_format_instruction: documentFindingInstruction(input.responseLanguage),
  }, route);
  const ragResponse = await input.clients.rag.assistantChat({
    user_id: input.actorContext.subjectId,
    conversation_id: input.conversationId,
    message: input.message,
    context: ragContext,
    mode: "manager_brief",
    response_language: input.responseLanguage,
    persist_conversation: false,
  }, input.actorContext);
  const normalized = normalizeAssistantChatResponse({
    response: ragResponse,
    message: input.message,
    language: input.responseLanguage,
    route,
  });
  const finalized = finalizeDirectorSnapshot(snapshot, normalized.citations);
  const governedResponse = {
    ...normalized,
    citations: normalized.citations.filter((citation) => finalized.acceptedChunkIds.has(citation.chunk_id)),
  };
  const response = composeFourLayerResponse(
    governedResponse,
    finalized.snapshot,
    input.responseLanguage,
    [...orchestration.warnings, ...finalized.warnings],
  );
  await auditDirectorResult(input, response, orchestration.plan, finalized.snapshot, orchestration.status);
  return response;
}

function blocksAiProcessing(snapshot: AnalysisSnapshot): boolean {
  return snapshot.strictest_policy.classification.handling_class === "RESTRICTED"
    || snapshot.strictest_policy.obligations.some(
    (obligation) => [
      "NO_EXTERNAL_AI",
      "LOCAL_PROCESSING_ONLY",
      "RECIPIENT_CONFIRMATION",
      "ORIGINATOR_APPROVAL",
      "PAP_ENFORCEMENT",
    ].includes(obligation),
  );
}

function policyBlockedDocumentResponse(
  conversationId: string | null,
  language: ResponseLanguage,
): AssistantChatResponse {
  const message = language === "en"
    ? "Document analysis was not run because the source policy does not permit the configured AI processing path."
    : "Dokumentová analýza nebyla spuštěna, protože zdrojová politika nepovoluje nakonfigurovanou cestu AI zpracování.";
  return {
    response_type: "no_answer",
    conversation_id: conversationId ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer: message,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {},
    citations: [],
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "insufficient_source",
    warnings: ["DIRECTOR_COPILOT_AI_POLICY_BLOCKED"],
    missing_information: message,
    recommended_action: null,
  };
}

function composeFourLayerResponse(
  response: AssistantChatResponse,
  snapshot: AnalysisSnapshot,
  language: ResponseLanguage,
  orchestrationWarnings: string[],
): AssistantChatResponse {
  const facts = factsTable(snapshot.evidence, language);
  const hasDocumentEvidence = response.citations.length > 0;
  const policyBlocked = response.warnings.includes("DIRECTOR_COPILOT_AI_POLICY_BLOCKED");
  const documentFindings = policyBlocked
    ? response.answer ?? localized(language, "ai_policy_blocked")
    : hasDocumentEvidence
    ? response.answer ?? response.message ?? localized(language, "document_unavailable")
    : localized(language, "document_unavailable");
  const uncertainty = uncertaintyText(snapshot, hasDocumentEvidence, policyBlocked, language);
  const interpretation = policyBlocked
    ? localized(language, "ai_policy_blocked")
    : interpretationText(snapshot, hasDocumentEvidence, language);
  const headings = language === "en"
    ? ["Verified facts", "Document findings", "AI interpretation", "Uncertainties"]
    : ["Ověřená fakta", "Dokumentová zjištění", "AI interpretace", "Nejistoty"];
  const answer = [
    `## ${headings[0]}\n${facts}`,
    `## ${headings[1]}\n${documentFindings}`,
    `## ${headings[2]}\n${interpretation}`,
    `## ${headings[3]}\n${uncertainty}`,
  ].join("\n\n");
  const warnings = [...new Set([
    ...response.warnings,
    ...orchestrationWarnings,
    ...(hasDocumentEvidence || policyBlocked ? [] : ["DIRECTOR_COPILOT_DOCUMENT_EVIDENCE_MISSING"]),
    "CONVERSATION_HISTORY_DISABLED_FOR_GOVERNED_FEDERATION",
  ])];
  return {
    ...response,
    response_type: "answer",
    answer,
    message: null,
    confidence: hasDocumentEvidence ? response.confidence : "low",
    warnings,
    report_artifacts: [],
    current_context: {
      ...response.current_context,
      answer_source: "director_copilot_federation",
      director_copilot_query_plan: snapshot.plan,
      director_copilot_snapshot: snapshot,
      director_copilot_ephemeral: true,
    },
  };
}

function emptyDirectorResponse(
  conversationId: string | null,
  status: "complete" | "partial" | "not_authorized" | "no_match",
  language: ResponseLanguage,
  warnings: string[],
  plan: unknown,
): AssistantChatResponse {
  const denied = status === "not_authorized";
  const partial = status === "partial";
  const answer = denied
    ? localized(language, "not_authorized")
    : partial
      ? localized(language, "sources_unavailable")
      : localized(language, "no_match");
  return {
    response_type: denied ? "restricted" : "no_answer",
    conversation_id: conversationId ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      answer_source: "director_copilot_federation",
      director_copilot_query_plan: plan,
      director_copilot_ephemeral: true,
    },
    citations: [],
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "insufficient_source",
    warnings: [...new Set([...warnings, "CONVERSATION_HISTORY_DISABLED_FOR_GOVERNED_FEDERATION"])],
    missing_information: answer,
    recommended_action: null,
  };
}

function factsTable(evidence: EvidenceItem[], language: ResponseLanguage): string {
  const projects = [...new Set(
    evidence.filter((item) => item.type === "structured_fact").map((item) => item.canonical_id),
  )].sort();
  const headers = language === "en"
    ? ["Project", "Budget variance", "Milestone delay", "Cited contract evidence", "As of"]
    : ["Projekt", "Rozpočtová odchylka", "Zpoždění milníku", "Citovaný smluvní podklad", "Stav k"];
  const rows = projects.map((project) => {
    const projectEvidence = evidence.filter((item) => item.canonical_id === project);
    const variance = projectEvidence.find((item) => item.fact?.key.includes("variance"))?.fact;
    const delay = projectEvidence.find((item) => item.fact?.key.includes("delay"))?.fact;
    const citedContractEvidence = projectEvidence.some((item) => item.type === "document_finding");
    const asOf = [...new Set(projectEvidence.map((item) => item.as_of))].sort().join(" / ");
    return [
      markdownCell(project.replace(/^stratos:project:/, "")),
      markdownCell(formatFact(variance, language)),
      markdownCell(formatFact(delay, language)),
      citedContractEvidence ? (language === "en" ? "yes" : "ano") : (language === "en" ? "no" : "ne"),
      markdownCell(asOf),
    ];
  });
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function formatFact(fact: EvidenceItem["fact"], language: ResponseLanguage): string {
  if (!fact) return language === "en" ? "not available" : "není k dispozici";
  if (typeof fact.value === "number" && fact.currency) {
    return new Intl.NumberFormat(language === "en" ? "en-US" : "cs-CZ", {
      style: "currency",
      currency: fact.currency,
      maximumFractionDigits: 0,
    }).format(fact.value);
  }
  if (typeof fact.value === "number" && fact.value_type === "duration_days") {
    return language === "en" ? `${fact.value} days` : `${fact.value} dní`;
  }
  return String(fact.value ?? (language === "en" ? "not stated" : "neuvedeno"));
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

function interpretationText(snapshot: AnalysisSnapshot, hasDocumentEvidence: boolean, language: ResponseLanguage): string {
  const structuredProjects = new Set(
    snapshot.evidence.filter((item) => item.type === "structured_fact").map((item) => item.canonical_id),
  );
  const projectsWithDocumentEvidence = new Set(
    snapshot.evidence.filter((item) => item.type === "document_finding").map((item) => item.canonical_id),
  );
  const projectCount = structuredProjects.size;
  const documentedProjectCount = projectsWithDocumentEvidence.size;
  if (language === "en") {
    return hasDocumentEvidence
      ? `${projectCount} project(s) meet both structured conditions; ${documentedProjectCount} also have project-matched cited contract evidence. Contract risk must be assessed only from the cited document findings above; this output is decision support, not an approval.`
      : `${projectCount} project(s) meet the financial and schedule conditions, but contract risk cannot be confirmed without a cited AKB document.`;
  }
  return hasDocumentEvidence
    ? `${projectCount} projektů splňuje obě strukturované podmínky; ${documentedProjectCount} z nich má také projektově přiřazený citovaný smluvní podklad. Smluvní riziko je nutné posuzovat pouze podle citovaných dokumentových zjištění výše; výstup je podklad, nikoli rozhodnutí.`
    : `${projectCount} projektů splňuje finanční a harmonogramovou podmínku, ale smluvní riziko nelze potvrdit bez citovaného dokumentu v AKB.`;
}

function uncertaintyText(
  snapshot: AnalysisSnapshot,
  hasDocumentEvidence: boolean,
  policyBlocked: boolean,
  language: ResponseLanguage,
): string {
  const items: string[] = [];
  for (const source of snapshot.unavailable_sources) {
    items.push(language === "en"
      ? `${source.source}: ${source.status} (${source.code})`
      : `${source.source}: ${source.status} (${source.code})`);
  }
  if (policyBlocked) {
    items.push(localized(language, "ai_policy_blocked"));
  } else if (!hasDocumentEvidence) {
    items.push(localized(language, "document_unavailable"));
  }
  const asOfValues = [...new Set(snapshot.evidence.map((item) => item.as_of))];
  if (asOfValues.length > 1) {
    items.push(language === "en"
      ? `Sources have different as-of times: ${asOfValues.join(", ")}.`
      : `Zdroje mají rozdílný čas platnosti: ${asOfValues.join(", ")}.`);
  }
  return items.length ? items.map((item) => `- ${item}`).join("\n") : localized(language, "no_uncertainty");
}

function documentFindingInstruction(language: ResponseLanguage): string {
  return language === "en"
    ? "Return only concise contract-risk findings supported by AKB document citations. Do not repeat structured financial or schedule values. Do not infer a risk when no cited document states it."
    : "Vrať pouze stručná zjištění ke smluvnímu riziku podložená citacemi dokumentů AKB. Neopakuj strukturované finanční ani harmonogramové hodnoty. Neodvozuj riziko, pokud je citovaný dokument neuvádí.";
}

async function auditDirectorResult(
  input: {
    actorContext: ApiRequestContext;
    clients: ApiClients;
  },
  response: AssistantChatResponse,
  plan: DirectorQueryPlan,
  snapshot: AnalysisSnapshot | null,
  status: string,
): Promise<void> {
  const sourceRefs = snapshot
    ? [...new Map(snapshot.evidence.map((item) => [
        `${item.source_system}|${item.source_version}`,
        { source_system: item.source_system, source_version: item.source_version },
      ])).values()]
    : [];
  await input.clients.registry.createAuditEvent({
    actor_id: input.actorContext.subjectId,
    event_type: "assistant.director_copilot_returned",
    resource_type: "assistant_conversation",
    resource_id: response.conversation_id,
    severity: status === "complete" ? "info" : "warning",
    metadata: {
      plan_id: plan.plan_id,
      tool_ids: plan.nodes.map((node) => node.tool_id).join(","),
      snapshot_id: snapshot?.snapshot_id ?? null,
      snapshot_hash: snapshot?.snapshot_hash ?? null,
      source_refs_json: JSON.stringify(sourceRefs.slice(0, 10)),
      policy_refs_json: JSON.stringify(snapshot?.strictest_policy.source_policies.slice(0, 10) ?? []),
      evidence_count: snapshot?.evidence.length ?? 0,
      unavailable_source_count: snapshot?.unavailable_sources.length ?? 0,
      citation_count: response.citations.length,
      status,
      history_persisted: false,
    },
  }, input.actorContext);
}

function localized(language: ResponseLanguage, key: "not_authorized" | "sources_unavailable" | "no_match" | "document_unavailable" | "no_uncertainty" | "ai_policy_blocked"): string {
  const values = {
    cs: {
      not_authorized: "Pro tento mezidoménový dotaz nemáte současně oprávněný rozsah v Budgetu a ProjectFlow.",
      sources_unavailable: "Úplný podklad nelze bezpečně sestavit, protože některý povinný zdroj není dostupný nebo jej nelze ověřit.",
      no_match: "V aktuálně oprávněném rozsahu nebyl nalezen projekt se současnou rozpočtovou odchylkou a zpožděným milníkem.",
      document_unavailable: "Nebyl nalezen citovatelný dokumentový podklad pro potvrzení smluvního rizika.",
      no_uncertainty: "Nebyla zjištěna další nejistota nad dostupnými zdroji.",
      ai_policy_blocked: "Dokumentová analýza ani AI interpretace nebyla spuštěna, protože zdrojová politika nepovoluje nakonfigurovanou cestu AI zpracování.",
    },
    en: {
      not_authorized: "You do not have an authorized scope in both Budget and ProjectFlow for this cross-domain query.",
      sources_unavailable: "The complete evidence package cannot be assembled safely because a required source is unavailable or cannot be verified.",
      no_match: "No project with both a budget variance and a delayed milestone was found in the currently authorized scope.",
      document_unavailable: "No citable document evidence was found to confirm contract risk.",
      no_uncertainty: "No additional uncertainty was identified in the available sources.",
      ai_policy_blocked: "Document analysis and AI interpretation were not run because the source policy does not permit the configured AI processing path.",
    },
  } as const;
  return values[language][key];
}
