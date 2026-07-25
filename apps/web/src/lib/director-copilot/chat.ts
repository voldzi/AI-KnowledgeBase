import "server-only";

import { randomUUID } from "node:crypto";

import { getDirectorCopilotConfig, type AklConfig } from "@/lib/api/config";
import { normalizeAssistantChatResponse } from "@/lib/assistant/assistant-response-normalizer";
import { ragContextForAssistantRoute, routeAssistantMessageForRag } from "@/lib/assistant/assistant-tool-router";
import type { ApiClients, ApiRequestContext, AssistantChatResponse, ResponseLanguage } from "@/lib/types";

import type {
  AnalysisSnapshot,
  DirectorCopilotIntent,
  DirectorQueryPlan,
  EvidenceItem,
} from "./contracts";
import { accessProjectionHash, domainAccessFor } from "./access";
import { DirectorDomainToolClient } from "./domain-tool-client";
import { domainCatalogStatus } from "./domain-catalog";
import { directorCopilotPromptEvidence, finalizeDirectorSnapshot, orchestrateDirectorCopilot } from "./orchestrator";
import type { ConversationQueryState } from "./query-state";
import type { StratosSemanticSource } from "./semantic-catalog";
import { semanticRegistryStatus } from "./semantic-registry";
import { directorCopilotServiceToken } from "./service-identity";

const DIRECTOR_COPILOT_SERVICE_CLIENT_ID = "svc-akb-director-copilot";

export async function runDirectorCopilotChat(input: {
  message: string;
  conversationId: string | null;
  responseLanguage: ResponseLanguage;
  actorContext: ApiRequestContext;
  clients: ApiClients;
  config: AklConfig;
  intent?: DirectorCopilotIntent;
  queryState?: ConversationQueryState;
  refreshActorContext?: () => Promise<ApiRequestContext>;
}): Promise<AssistantChatResponse> {
  const domainClient = new DirectorDomainToolClient({ config: input.config });
  const directorConfig = getDirectorCopilotConfig(input.config);
  const orchestration = await orchestrateDirectorCopilot({
    message: input.message,
    language: input.responseLanguage,
    context: input.actorContext,
    client: domainClient,
    intent: input.intent,
    queryState: input.queryState,
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
    const requiredApplications = new Set(
      snapshot.plan.nodes.flatMap((node) => (
        node.source_application === "budget"
        || node.source_application === "projectflow"
        || node.source_application === "archflow"
        || node.source_application === "aiip"
          ? [node.source_application]
          : []
      )),
    );
    const projectionChanged = refreshedContext.subjectId !== input.actorContext.subjectId
      || accessProjectionHash(refreshedContext) !== snapshot.projection_hash
      || [...requiredApplications].some(
        (application) => !domainAccessFor(refreshedContext, application).authorized,
      );
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
  if (snapshot.plan.intent === "project_portfolio_status" || snapshot.plan.intent === "project_access_overview") {
    const response = composeProjectFlowResponse(
      input.conversationId,
      snapshot,
      input.responseLanguage,
      orchestration.warnings,
    );
    await auditDirectorResult(input, response, orchestration.plan, snapshot, orchestration.status);
    return response;
  }
  if (snapshot.plan.intent === "budget_portfolio_status") {
    const response = composeBudgetResponse(
      input.conversationId,
      snapshot,
      input.responseLanguage,
      orchestration.warnings,
    );
    await auditDirectorResult(input, response, orchestration.plan, snapshot, orchestration.status);
    return response;
  }
  if (snapshot.plan.intent === "portfolio_performance_overview") {
    const response = composePortfolioPerformanceResponse(
      input.conversationId,
      snapshot,
      input.responseLanguage,
      orchestration.warnings,
    );
    await auditDirectorResult(input, response, orchestration.plan, snapshot, orchestration.status);
    return response;
  }
  if (snapshot.plan.intent === "archflow_demand_overview") {
    const response = composeArchFlowResponse(
      input.conversationId,
      snapshot,
      input.responseLanguage,
      orchestration.warnings,
    );
    await auditDirectorResult(input, response, orchestration.plan, snapshot, orchestration.status);
    return response;
  }
  if (snapshot.plan.intent === "aiip_idea_overview") {
    const response = composeAiipResponse(
      input.conversationId,
      snapshot,
      input.responseLanguage,
      orchestration.warnings,
    );
    await auditDirectorResult(input, response, orchestration.plan, snapshot, orchestration.status);
    return response;
  }
  if (snapshot.plan.intent === "innovation_delivery_trace") {
    const response = composeInnovationTraceResponse(
      input.conversationId,
      snapshot,
      input.responseLanguage,
      orchestration.warnings,
    );
    await auditDirectorResult(input, response, orchestration.plan, snapshot, orchestration.status);
    return response;
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

export function directorCopilotUnavailableResponse(input: {
  conversationId: string | null;
  language: ResponseLanguage;
  intent: DirectorCopilotIntent;
  queryState?: ConversationQueryState;
}): AssistantChatResponse {
  const projectOnly = input.intent === "project_portfolio_status" || input.intent === "project_access_overview";
  const budgetOnly = input.intent === "budget_portfolio_status";
  const archFlowOnly = input.intent === "archflow_demand_overview";
  const aiipOnly = input.intent === "aiip_idea_overview";
  const answer = projectOnly
    ? localized(input.language, "project_source_unavailable")
    : budgetOnly
      ? localized(input.language, "budget_source_unavailable")
    : archFlowOnly
      ? localized(input.language, "archflow_source_unavailable")
      : aiipOnly
        ? localized(input.language, "aiip_source_unavailable")
        : localized(input.language, "sources_unavailable");
  return {
    response_type: "no_answer",
    conversation_id: input.conversationId ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      answer_source: projectOnly
        ? "director_copilot_projectflow"
        : budgetOnly
          ? "director_copilot_budget"
          : archFlowOnly
            ? "director_copilot_archflow"
            : aiipOnly
              ? "director_copilot_aiip"
              : "director_copilot_federation",
      requested_director_copilot_intent: input.intent,
      ...(input.queryState ? { stratos_query_state: input.queryState } : {}),
    },
    citations: [],
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "insufficient_source",
    warnings: ["DIRECTOR_COPILOT_DISABLED", "LIVE_DATA_FALLBACK_BLOCKED"],
    missing_information: answer,
    recommended_action: null,
  };
}

export function directorCopilotPendingSourcesResponse(input: {
  conversationId: string | null;
  language: ResponseLanguage;
  sources: StratosSemanticSource[];
  queryState: ConversationQueryState;
}): AssistantChatResponse {
  const sourceNames = input.sources.map((source) => ({
    archflow: "ArchFlow",
    aiip: "AI Innovation Portal",
    budget: "Budget",
    projectflow: "ProjectFlow",
  })[source]);
  const answer = input.language === "en"
    ? `The live ${sourceNames.join(" and ")} data tool is not connected to AKB yet. I will not replace the requested live data with a document answer.`
    : `Nástroj pro živá data ${sourceNames.join(" a ")} zatím není k AKB připojen. Požadovaná živá data proto nenahrazuji odpovědí z dokumentů.`;
  return {
    response_type: "no_answer",
    conversation_id: input.conversationId ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      answer_source: "director_copilot_federation",
      stratos_query_state: input.queryState,
      active_source_application: null,
    },
    citations: [],
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "insufficient_source",
    warnings: input.sources.map((source) => `DIRECTOR_COPILOT_${source.toUpperCase()}_TOOL_NOT_CONNECTED`),
    missing_information: answer,
    recommended_action: null,
  };
}

function composeProjectFlowResponse(
  conversationId: string | null,
  snapshot: AnalysisSnapshot,
  language: ResponseLanguage,
  orchestrationWarnings: string[],
): AssistantChatResponse {
  const projects = [...new Set(
    snapshot.evidence
      .filter((item) => item.source_system === "STRATOS_PROJECTFLOW")
      .map((item) => item.canonical_id),
  )].map((canonicalId) => {
    const evidence = snapshot.evidence.filter((item) => item.canonical_id === canonicalId);
    return {
      canonicalId,
      entityId: evidence[0]?.entity_id ?? canonicalId.replace(/^stratos:project:/, ""),
      displayName: factValue(evidence, "project.display_name"),
      deepLink: evidence[0]?.deep_link ?? "",
      status: factValue(evidence, "project.status"),
      scheduleStatus: factValue(evidence, "project.schedule_status"),
      delayDays: factValue(evidence, "milestone.max_delay_days"),
      nextDueDate: factValue(evidence, "milestone.next_due_date"),
      asOf: [...new Set(evidence.map((item) => item.as_of))].sort().at(-1) ?? snapshot.created_at,
    };
  }).sort((left, right) => {
    const leftDelay = typeof left.delayDays === "number" ? left.delayDays : 0;
    const rightDelay = typeof right.delayDays === "number" ? right.delayDays : 0;
    return rightDelay - leftDelay || left.entityId.localeCompare(right.entityId);
  });
  const delayedCount = projects.filter((project) => (
    project.scheduleStatus === "delayed"
    || (typeof project.delayDays === "number" && project.delayDays > 0)
  )).length;
  const asOf = [...new Set(projects.map((project) => project.asOf))].sort().at(-1) ?? snapshot.created_at;
  const accessOverview = snapshot.plan.intent === "project_access_overview";
  const summary = language === "en"
    ? `${accessOverview ? "ProjectFlow is available to your account. " : ""}ProjectFlow returned ${projects.length} project(s) in your current authorized scope; ${delayedCount} have a delayed schedule. Live data as of ${formatDateTime(asOf, language)}.`
    : `${accessOverview ? "ProjectFlow je pro váš účet dostupný. " : ""}ProjectFlow v aktuálně oprávněném rozsahu vrátil ${projects.length} projektů; ${delayedCount} má zpožděný harmonogram. Živá data ke ${formatDateTime(asOf, language)}.`;
  const headers = language === "en"
    ? ["Project", "Status", "Schedule", "Maximum delay", "Next milestone", "As of"]
    : ["Projekt", "Stav", "Harmonogram", "Nejvyšší zpoždění", "Nejbližší milník", "Stav k"];
  const rows = projects.map((project) => [
    projectLinkLabel(project.displayName, project.deepLink, language),
    localizedFact(project.status, language),
    localizedFact(project.scheduleStatus, language),
    typeof project.delayDays === "number"
      ? language === "en" ? `${project.delayDays} days` : `${project.delayDays} dní`
      : localizedFact(project.delayDays, language),
    localizedFact(project.nextDueDate, language),
    formatDateTime(project.asOf, language),
  ]);
  const table = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
  const warnings = [...new Set([
    ...orchestrationWarnings,
    "DIRECTOR_COPILOT_PROJECTFLOW_LIVE_DATA",
  ])];
  return {
    response_type: "answer",
    conversation_id: conversationId ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer: `${summary}\n\n${table}`,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      answer_source: "director_copilot_projectflow",
      director_copilot_query_plan: snapshot.plan,
      director_copilot_snapshot: snapshot,
      stratos_query_state: snapshot.plan.query_state,
      active_source_application: "projectflow",
    },
    citations: [],
    follow_up_questions: language === "en"
      ? ["Which projects are delayed?", "Show the next milestones."]
      : ["Které projekty jsou zpožděné?", "Ukaž nejbližší milníky."],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "high",
    warnings,
    missing_information: null,
    recommended_action: null,
  };
}

function composeBudgetResponse(
  conversationId: string | null,
  snapshot: AnalysisSnapshot,
  language: ResponseLanguage,
  orchestrationWarnings: string[],
): AssistantChatResponse {
  const projects = [...new Set(
    snapshot.evidence
      .filter((item) => item.source_system === "STRATOS_BUDGET")
      .map((item) => item.canonical_id),
  )].map((canonicalId) => {
    const evidence = snapshot.evidence.filter((item) => item.canonical_id === canonicalId);
    return {
      displayName: factValue(evidence, "project.display_name"),
      deepLink: evidence[0]?.deep_link ?? "",
      planAmount: factFor(evidence, "budget.plan_amount"),
      actualAmount: factFor(evidence, "budget.actual_amount"),
      forecastAmount: factFor(evidence, "budget.forecast_amount"),
      varianceAmount: factFor(evidence, "budget.variance_amount"),
      asOf: [...new Set(evidence.map((item) => item.as_of))].sort().at(-1) ?? snapshot.created_at,
    };
  });
  const headers = language === "en"
    ? ["Project", "Plan", "Actual", "Forecast", "Variance", "As of"]
    : ["Projekt", "Plán", "Skutečnost", "Výhled", "Odchylka", "Stav k"];
  const rows = projects.map((project) => [
    projectLinkLabel(project.displayName, project.deepLink, language),
    markdownCell(formatFact(project.planAmount, language)),
    markdownCell(formatFact(project.actualAmount, language)),
    markdownCell(formatFact(project.forecastAmount, language)),
    markdownCell(formatFact(project.varianceAmount, language)),
    formatDateTime(project.asOf, language),
  ]);
  const table = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
  const aggregateRequested = snapshot.plan.query_state.granularity === "organization"
    || snapshot.plan.query_state.granularity === "organization_unit";
  const summary = language === "en"
    ? `Budget returned financial data for ${projects.length} project(s) in your authorized scope for ${formatQueryPeriod(snapshot.plan.query_state, language)}.`
    : `Budget v aktuálně oprávněném rozsahu vrátil finanční údaje pro ${projects.length} projektů za ${formatQueryPeriod(snapshot.plan.query_state, language)}.`;
  const aggregateNotice = !aggregateRequested
    ? ""
    : language === "en"
      ? "\n\nThe currently connected source tool returns project rows. An authoritative organization or organizational-unit total requires the source-owned Budget aggregate tool and is not calculated by AKB."
      : "\n\nAktuálně připojený zdrojový nástroj vrací projektové položky. Autoritativní součet za organizaci nebo útvar vyžaduje zdrojový agregační nástroj Budgetu; AKB jej samo nedopočítává.";
  return {
    response_type: "answer",
    conversation_id: conversationId ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer: `${summary}${aggregateNotice}\n\n${table}`,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      answer_source: "director_copilot_budget",
      director_copilot_query_plan: snapshot.plan,
      director_copilot_snapshot: snapshot,
      stratos_query_state: snapshot.plan.query_state,
      active_source_application: "budget",
    },
    citations: [],
    follow_up_questions: language === "en"
      ? ["Which projects have the largest variance?"]
      : ["Které projekty mají nejvyšší odchylku?"],
    suggested_actions: [],
    report_artifacts: [],
    confidence: aggregateRequested ? "medium" : "high",
    warnings: [...new Set([
      ...orchestrationWarnings,
      "DIRECTOR_COPILOT_BUDGET_LIVE_DATA",
      ...(aggregateRequested ? ["DIRECTOR_COPILOT_BUDGET_AGGREGATE_TOOL_REQUIRED"] : []),
    ])],
    missing_information: null,
    recommended_action: null,
  };
}

function composePortfolioPerformanceResponse(
  conversationId: string | null,
  snapshot: AnalysisSnapshot,
  language: ResponseLanguage,
  orchestrationWarnings: string[],
): AssistantChatResponse {
  const projectIds = [...new Set(
    snapshot.evidence.map((item) => item.canonical_id),
  )].sort();
  const projects = projectIds.map((canonicalId) => {
    const evidence = snapshot.evidence.filter((item) => item.canonical_id === canonicalId);
    const displayName = factValue(evidence, "project.display_name");
    return {
      displayName,
      deepLink: evidence.find((item) => item.source_system === "STRATOS_PROJECTFLOW")?.deep_link
        ?? evidence[0]?.deep_link
        ?? "",
      planAmount: factFor(evidence, "budget.plan_amount"),
      actualAmount: factFor(evidence, "budget.actual_amount"),
      forecastAmount: factFor(evidence, "budget.forecast_amount"),
      varianceAmount: factFor(evidence, "budget.variance_amount"),
      status: factValue(evidence, "project.status"),
      scheduleStatus: factValue(evidence, "project.schedule_status"),
      delayDays: factValue(evidence, "milestone.max_delay_days"),
      nextDueDate: factValue(evidence, "milestone.next_due_date"),
    };
  }).sort((left, right) => {
    const leftDelay = typeof left.delayDays === "number" ? left.delayDays : 0;
    const rightDelay = typeof right.delayDays === "number" ? right.delayDays : 0;
    return rightDelay - leftDelay || String(left.displayName ?? "").localeCompare(String(right.displayName ?? ""));
  });
  const headers = language === "en"
    ? ["Project", "Plan", "Actual / forecast", "Variance", "Status", "Schedule", "Delay", "Next milestone"]
    : ["Projekt", "Plán", "Skutečnost / výhled", "Odchylka", "Stav", "Harmonogram", "Zpoždění", "Nejbližší milník"];
  const rows = projects.map((project) => [
    projectLinkLabel(project.displayName, project.deepLink, language),
    markdownCell(formatFact(project.planAmount, language)),
    markdownCell(formatFact(project.actualAmount ?? project.forecastAmount, language)),
    markdownCell(formatFact(project.varianceAmount, language)),
    localizedFact(project.status, language),
    localizedFact(project.scheduleStatus, language),
    typeof project.delayDays === "number"
      ? language === "en" ? `${project.delayDays} days` : `${project.delayDays} dní`
      : localizedFact(project.delayDays, language),
    localizedFact(project.nextDueDate, language),
  ]);
  const table = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
  const summary = language === "en"
    ? `Budget and ProjectFlow returned a joined live overview of ${projects.length} project(s) in your authorized scope for ${formatQueryPeriod(snapshot.plan.query_state, language)}.`
    : `Budget a ProjectFlow vrátily společný živý přehled ${projects.length} projektů v aktuálně oprávněném rozsahu za ${formatQueryPeriod(snapshot.plan.query_state, language)}.`;
  return {
    response_type: "answer",
    conversation_id: conversationId ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer: `${summary}\n\n${table}`,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      answer_source: "director_copilot_federation",
      director_copilot_query_plan: snapshot.plan,
      director_copilot_snapshot: snapshot,
      stratos_query_state: snapshot.plan.query_state,
      active_source_application: null,
    },
    citations: [],
    follow_up_questions: language === "en"
      ? ["Which projects have the largest variance?", "Show only delayed projects."]
      : ["Které projekty mají nejvyšší odchylku?", "Ukaž jen zpožděné projekty."],
    suggested_actions: [],
    report_artifacts: [],
    confidence: snapshot.unavailable_sources.length ? "medium" : "high",
    warnings: [...new Set([
      ...orchestrationWarnings,
      "DIRECTOR_COPILOT_FEDERATED_LIVE_DATA",
    ])],
    missing_information: null,
    recommended_action: null,
  };
}

function composeArchFlowResponse(
  conversationId: string | null,
  snapshot: AnalysisSnapshot,
  language: ResponseLanguage,
  orchestrationWarnings: string[],
): AssistantChatResponse {
  const needs = structuredEntities(snapshot, "STRATOS_ARCHFLOW").map((entity) => ({
    ...entity,
    displayName: factValue(entity.evidence, "archflow.need.display_name"),
    status: factValue(entity.evidence, "archflow.need.status"),
    readiness: factValue(entity.evidence, "archflow.need.readiness_score"),
    impact: factValue(entity.evidence, "archflow.need.impact_score"),
    decision: factValue(entity.evidence, "archflow.need.decision"),
    handoff: factValue(entity.evidence, "archflow.need.budget_handoff_status"),
  }));
  const headers = language === "en"
    ? ["Need", "Status", "Readiness", "Impact", "Decision", "Budget handoff", "As of"]
    : ["Požadavek", "Stav", "Připravenost", "Dopad", "Rozhodnutí", "Předání do Budgetu", "Stav k"];
  const rows = needs.map((need) => [
    entityLinkLabel(need.displayName, need.deepLink, language, "Open need", "Otevřít požadavek"),
    localizedFact(need.status, language),
    localizedFact(need.readiness, language),
    localizedFact(need.impact, language),
    localizedFact(need.decision, language),
    localizedFact(need.handoff, language),
    formatDateTime(need.asOf, language),
  ]);
  return structuredSourceResponse({
    conversationId,
    snapshot,
    language,
    answerSource: "director_copilot_archflow",
    activeSourceApplication: "archflow",
    summary: language === "en"
      ? `ArchFlow returned ${needs.length} business need(s) in your authorized scope.`
      : `ArchFlow v aktuálně oprávněném rozsahu vrátil ${needs.length} business požadavků.`,
    headers,
    rows,
    followUps: language === "en"
      ? ["Which needs are ready for a decision?", "Which needs have not been handed to Budget?"]
      : ["Které požadavky jsou připravené k rozhodnutí?", "Které požadavky ještě nebyly předány do Budgetu?"],
    warnings: [...orchestrationWarnings, "DIRECTOR_COPILOT_ARCHFLOW_LIVE_DATA"],
  });
}

function composeAiipResponse(
  conversationId: string | null,
  snapshot: AnalysisSnapshot,
  language: ResponseLanguage,
  orchestrationWarnings: string[],
): AssistantChatResponse {
  const ideas = structuredEntities(snapshot, "STRATOS_AIIP").map((entity) => ({
    ...entity,
    displayName: factValue(entity.evidence, "aiip.idea.display_name"),
    status: factValue(entity.evidence, "aiip.idea.status"),
    value: factValue(entity.evidence, "aiip.idea.value_score"),
    risk: factValue(entity.evidence, "aiip.idea.risk_score"),
    benefit: factValue(entity.evidence, "aiip.idea.expected_benefit"),
    handoff: factValue(entity.evidence, "aiip.idea.handoff_status"),
  }));
  const headers = language === "en"
    ? ["AI idea", "Status", "Value", "Risk", "Expected benefit", "Handoff", "As of"]
    : ["AI podnět", "Stav", "Hodnota", "Riziko", "Očekávaný přínos", "Předání", "Stav k"];
  const rows = ideas.map((idea) => [
    entityLinkLabel(idea.displayName, idea.deepLink, language, "Open idea", "Otevřít podnět"),
    localizedFact(idea.status, language),
    localizedFact(idea.value, language),
    localizedFact(idea.risk, language),
    localizedFact(idea.benefit, language),
    localizedFact(idea.handoff, language),
    formatDateTime(idea.asOf, language),
  ]);
  return structuredSourceResponse({
    conversationId,
    snapshot,
    language,
    answerSource: "director_copilot_aiip",
    activeSourceApplication: "aiip",
    summary: language === "en"
      ? `AI Innovation Portal returned ${ideas.length} idea(s) in your authorized scope.`
      : `AI Innovation Portal v aktuálně oprávněném rozsahu vrátil ${ideas.length} podnětů.`,
    headers,
    rows,
    followUps: language === "en"
      ? ["Which ideas have the highest value?", "Which ideas have not been handed to ArchFlow?"]
      : ["Které podněty mají nejvyšší hodnotu?", "Které podněty ještě nebyly předány do ArchFlow?"],
    warnings: [...orchestrationWarnings, "DIRECTOR_COPILOT_AIIP_LIVE_DATA"],
  });
}

function composeInnovationTraceResponse(
  conversationId: string | null,
  snapshot: AnalysisSnapshot,
  language: ResponseLanguage,
  orchestrationWarnings: string[],
): AssistantChatResponse {
  const entities = [
    ...structuredEntities(snapshot, "STRATOS_AIIP").map((entity) => ({
      ...entity,
      source: "AIIP",
      displayName: factValue(entity.evidence, "aiip.idea.display_name"),
      status: factValue(entity.evidence, "aiip.idea.status"),
      relation: factValue(entity.evidence, "relation.archflow_need_canonical_id"),
    })),
    ...structuredEntities(snapshot, "STRATOS_ARCHFLOW").map((entity) => ({
      ...entity,
      source: "ArchFlow",
      displayName: factValue(entity.evidence, "archflow.need.display_name"),
      status: factValue(entity.evidence, "archflow.need.status"),
      relation: factValue(entity.evidence, "relation.project_canonical_id")
        ?? factValue(entity.evidence, "relation.aiip_idea_canonical_id"),
    })),
  ];
  const headers = language === "en"
    ? ["Source", "Item", "Status", "Declared next relation", "As of"]
    : ["Zdroj", "Položka", "Stav", "Deklarovaná navazující vazba", "Stav k"];
  const rows = entities.map((entity) => [
    entity.source,
    entityLinkLabel(entity.displayName, entity.deepLink, language, "Open item", "Otevřít položku"),
    localizedFact(entity.status, language),
    localizedFact(entity.relation, language),
    formatDateTime(entity.asOf, language),
  ]);
  return structuredSourceResponse({
    conversationId,
    snapshot,
    language,
    answerSource: "director_copilot_federation",
    activeSourceApplication: null,
    summary: language === "en"
      ? `The authorized innovation trace contains ${entities.length} live item(s). Relations are shown only when declared by the source system.`
      : `Oprávněná inovační stopa obsahuje ${entities.length} živých položek. Vazby jsou uvedeny pouze tehdy, pokud je deklaroval zdrojový systém.`,
    headers,
    rows,
    followUps: language === "en"
      ? ["Which ideas have not reached ArchFlow?", "Which needs have not reached Budget?"]
      : ["Které podněty se ještě nedostaly do ArchFlow?", "Které požadavky se ještě nedostaly do Budgetu?"],
    warnings: [...orchestrationWarnings, "DIRECTOR_COPILOT_FEDERATED_LIVE_DATA"],
  });
}

function structuredEntities(
  snapshot: AnalysisSnapshot,
  sourceSystem: "STRATOS_ARCHFLOW" | "STRATOS_AIIP",
): Array<{
  canonicalId: string;
  evidence: EvidenceItem[];
  deepLink: string;
  asOf: string;
}> {
  return [...new Set(
    snapshot.evidence
      .filter((item) => item.source_system === sourceSystem && item.type === "structured_fact")
      .map((item) => item.canonical_id),
  )].sort().map((canonicalId) => {
    const evidence = snapshot.evidence.filter(
      (item) => item.source_system === sourceSystem && item.canonical_id === canonicalId,
    );
    return {
      canonicalId,
      evidence,
      deepLink: evidence[0]?.deep_link ?? "",
      asOf: [...new Set(evidence.map((item) => item.as_of))].sort().at(-1) ?? snapshot.created_at,
    };
  });
}

function structuredSourceResponse(input: {
  conversationId: string | null;
  snapshot: AnalysisSnapshot;
  language: ResponseLanguage;
  answerSource: string;
  activeSourceApplication: string | null;
  summary: string;
  headers: string[];
  rows: string[][];
  followUps: string[];
  warnings: string[];
}): AssistantChatResponse {
  const table = [
    `| ${input.headers.join(" | ")} |`,
    `| ${input.headers.map(() => "---").join(" | ")} |`,
    ...input.rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
  return {
    response_type: "answer",
    conversation_id: input.conversationId ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer: `${input.summary}\n\n${table}`,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      answer_source: input.answerSource,
      director_copilot_query_plan: input.snapshot.plan,
      director_copilot_snapshot: input.snapshot,
      stratos_query_state: input.snapshot.plan.query_state,
      active_source_application: input.activeSourceApplication,
    },
    citations: [],
    follow_up_questions: input.followUps,
    suggested_actions: [],
    report_artifacts: [],
    confidence: input.snapshot.unavailable_sources.length ? "medium" : "high",
    warnings: [...new Set(input.warnings)],
    missing_information: null,
    recommended_action: null,
  };
}

function factValue(evidence: EvidenceItem[], key: string): string | number | boolean | null {
  return evidence.find((item) => item.fact?.key === key)?.fact?.value ?? null;
}

function formatQueryPeriod(
  state: ConversationQueryState,
  language: ResponseLanguage,
): string {
  if (state.period.type === "fiscal_year") {
    return language === "en"
      ? `fiscal year ${state.period.fiscal_year}`
      : `rozpočtový rok ${state.period.fiscal_year}`;
  }
  return language === "en"
    ? `the current year ${state.period.fiscal_year}`
    : `aktuální rok ${state.period.fiscal_year}`;
}

function factFor(evidence: EvidenceItem[], key: string): EvidenceItem["fact"] {
  return evidence.find((item) => item.fact?.key === key)?.fact;
}

function projectLinkLabel(
  displayName: string | number | boolean | null,
  deepLink: string,
  language: ResponseLanguage,
): string {
  const name = typeof displayName === "string" && displayName.trim()
    ? markdownCell(displayName)
    : language === "en" ? "Open project" : "Otevřít projekt";
  return deepLink ? `[${name}](${deepLink})` : name;
}

function entityLinkLabel(
  displayName: string | number | boolean | null,
  deepLink: string,
  language: ResponseLanguage,
  englishFallback: string,
  czechFallback: string,
): string {
  const name = typeof displayName === "string" && displayName.trim()
    ? markdownCell(displayName)
    : language === "en" ? englishFallback : czechFallback;
  return deepLink ? `[${name}](${deepLink})` : name;
}

function localizedFact(value: string | number | boolean | null, language: ResponseLanguage): string {
  if (value === null || value === "") return language === "en" ? "not available" : "není k dispozici";
  const translated = {
    cs: {
      active: "aktivní",
      planned: "plánovaný",
      blocked: "blokovaný",
      done: "dokončený",
      delayed: "zpožděný",
      on_track: "podle plánu",
      at_risk: "ohrožený",
    },
    en: {},
  } as const;
  const normalized = String(value).toLowerCase();
  return language === "cs"
    ? translated.cs[normalized as keyof typeof translated.cs] ?? String(value)
    : String(value);
}

function formatDateTime(value: string, language: ResponseLanguage): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return markdownCell(value);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  }).format(parsed);
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
      stratos_query_state: snapshot.plan.query_state,
    },
  };
}

function emptyDirectorResponse(
  conversationId: string | null,
  status: "complete" | "partial" | "not_authorized" | "no_match",
  language: ResponseLanguage,
  warnings: string[],
  plan: DirectorQueryPlan,
): AssistantChatResponse {
  const denied = status === "not_authorized";
  const partial = status === "partial";
  const projectOnly = plan.intent === "project_portfolio_status" || plan.intent === "project_access_overview";
  const budgetOnly = plan.intent === "budget_portfolio_status";
  const archFlowOnly = plan.intent === "archflow_demand_overview";
  const aiipOnly = plan.intent === "aiip_idea_overview";
  const answer = denied
    ? projectOnly
      ? projectAuthorizationMessage(language, warnings)
      : budgetOnly
        ? budgetAuthorizationMessage(language, warnings)
        : archFlowOnly
          ? applicationAuthorizationMessage("ArchFlow", language, warnings)
          : aiipOnly
            ? applicationAuthorizationMessage("AI Innovation Portal", language, warnings)
            : localized(language, "not_authorized")
    : partial
      ? localized(
          language,
          projectOnly
            ? "project_source_unavailable"
            : budgetOnly
              ? "budget_source_unavailable"
              : archFlowOnly
                ? "archflow_source_unavailable"
                : aiipOnly
                  ? "aiip_source_unavailable"
                  : "sources_unavailable",
        )
      : budgetOnly
        ? budgetNoDataMessage(language, warnings)
        : localized(
            language,
            projectOnly
              ? "project_no_match"
              : archFlowOnly
                ? "archflow_no_match"
                : aiipOnly
                  ? "aiip_no_match"
                  : "no_match",
          );
  return {
    response_type: denied ? "restricted" : "no_answer",
    conversation_id: conversationId ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      answer_source: projectOnly
        ? "director_copilot_projectflow"
        : budgetOnly
          ? "director_copilot_budget"
          : archFlowOnly
            ? "director_copilot_archflow"
            : aiipOnly
              ? "director_copilot_aiip"
              : "director_copilot_federation",
      director_copilot_query_plan: plan,
      requested_director_copilot_intent: plan.intent,
      stratos_query_state: plan.query_state,
      active_source_application: projectOnly
        ? "projectflow"
        : budgetOnly
          ? "budget"
          : archFlowOnly
            ? "archflow"
            : aiipOnly
              ? "aiip"
              : null,
    },
    citations: [],
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "insufficient_source",
    warnings: [...new Set(warnings)],
    missing_information: answer,
    recommended_action: null,
  };
}

function applicationAuthorizationMessage(
  application: "ArchFlow" | "AI Innovation Portal",
  language: ResponseLanguage,
  warnings: string[],
): string {
  const prefix = application === "ArchFlow" ? "ARCHFLOW" : "AIIP";
  const codes = new Set(warnings);
  if (
    codes.has(`${prefix}_ACCESS_CAPABILITY_MISSING`)
    || codes.has(`${prefix}_APPLICATION_ACCESS_INACTIVE`)
  ) {
    return language === "en"
      ? `You do not have active access to ${application}.`
      : `Nemáte aktivní přístup do aplikace ${application}.`;
  }
  if (
    codes.has(`${prefix}_READ_CAPABILITY_MISSING`)
    || codes.has(`${prefix}_CAPABILITY_DENIED`)
  ) {
    return language === "en"
      ? `You do not have permission to read data from ${application}.`
      : `Nemáte oprávnění ke čtení dat z aplikace ${application}.`;
  }
  if (
    codes.has(`${prefix}_SCOPE_MISSING`)
    || codes.has(`${prefix}_SCOPE_LIMIT_EXCEEDED`)
    || codes.has(`${prefix}_SCOPE_NOT_COVERED`)
  ) {
    return language === "en"
      ? `Your ${application} access does not contain a usable scope for this query.`
      : `Vaše oprávnění v aplikaci ${application} neobsahuje použitelný rozsah pro tento dotaz.`;
  }
  if ([...codes].some((code) => code.includes("POLICY"))) {
    return language === "en"
      ? `${application} data is not available under the applicable Information Policy.`
      : `Data z aplikace ${application} nejsou dostupná podle platné Information Policy.`;
  }
  return language === "en"
    ? `${application} denied the request without a more specific safe reason.`
    : `${application} dotaz odmítl bez podrobnějšího bezpečně sdělitelného důvodu.`;
}

function budgetAuthorizationMessage(language: ResponseLanguage, warnings: string[]): string {
  const codes = new Set(warnings);
  if (codes.has("BUDGET_READ_CAPABILITY_MISSING") || codes.has("BUDGET_CAPABILITY_DENIED")) {
    return language === "en"
      ? "You do not have permission to read Budget financial data."
      : "Nemáte oprávnění ke čtení finančních údajů v Budgetu.";
  }
  if (
    codes.has("BUDGET_SCOPE_MISSING")
    || codes.has("BUDGET_SCOPE_LIMIT_EXCEEDED")
    || codes.has("BUDGET_SCOPE_NOT_COVERED")
  ) {
    return language === "en"
      ? "Your Budget access does not contain a usable organization, budget, or project scope."
      : "Vaše oprávnění Budget neobsahuje použitelný organizační, rozpočtový nebo projektový rozsah.";
  }
  if ([...codes].some((code) => code.includes("POLICY"))) {
    return language === "en"
      ? "Financial data is not available under the applicable Information Policy."
      : "Finanční údaje nejsou dostupné podle platné Information Policy.";
  }
  return language === "en"
    ? "Budget denied the financial query."
    : "Budget finanční dotaz odmítl.";
}

function budgetNoDataMessage(
  language: ResponseLanguage,
  warnings: string[],
): string {
  const codes = new Set(warnings);
  if (codes.has("BUDGET_APPROVED_PLAN_MISSING")) {
    return language === "en"
      ? "Budget found the covered project, but no approved plan is available for a reliable financial comparison."
      : "Budget nalezl projekt v oprávněném rozsahu, ale pro spolehlivé finanční porovnání není k dispozici schválený plán.";
  }
  if (codes.has("BUDGET_CURRENCY_CONFLICT")) {
    return language === "en"
      ? "Budget found financial records in different currencies. It did not add them together and therefore did not return a misleading total."
      : "Budget nalezl finanční záznamy v rozdílných měnách. Nesčítal je a proto nevrátil zavádějící souhrnnou částku.";
  }
  return localized(language, "budget_no_match");
}

function projectAuthorizationMessage(language: ResponseLanguage, warnings: string[]): string {
  const codes = new Set(warnings);
  if (
    codes.has("PROJECTFLOW_ACCESS_CAPABILITY_MISSING")
    || codes.has("PROJECTFLOW_APPLICATION_ACCESS_INACTIVE")
  ) {
    return language === "en"
      ? "You do not have the ProjectFlow application access capability."
      : "Nemáte oprávnění pro vstup do ProjectFlow.";
  }
  if (
    codes.has("PROJECTFLOW_READ_CAPABILITY_MISSING")
    || codes.has("PROJECTFLOW_CAPABILITY_DENIED")
  ) {
    return language === "en"
      ? "You do not have permission to read ProjectFlow projects."
      : "Nemáte oprávnění ke čtení projektů v ProjectFlow.";
  }
  if (
    codes.has("PROJECTFLOW_SCOPE_MISSING")
    || codes.has("PROJECTFLOW_SCOPE_LIMIT_EXCEEDED")
  ) {
    return language === "en"
      ? "Your ProjectFlow access does not contain a usable organization, portfolio, or project scope."
      : "Vaše oprávnění ProjectFlow neobsahuje použitelný rozsah organizace, portfolia nebo projektu.";
  }
  if (
    codes.has("PROJECTFLOW_LOCAL_MEMBERSHIP_REQUIRED")
    || codes.has("LOCAL_PROJECT_MEMBERSHIP_REQUIRED")
  ) {
    return language === "en"
      ? "This direct project scope requires an active local ProjectFlow membership."
      : "Tento přímý projektový rozsah vyžaduje aktivní lokální členství v ProjectFlow.";
  }
  if ([...codes].some((code) => code.includes("POLICY"))) {
    return language === "en"
      ? "Project information is not available under the applicable Information Policy."
      : "Projektové informace nejsou dostupné podle platné Information Policy.";
  }
  if (codes.has("PROJECTFLOW_BROAD_SCOPE_UPSTREAM_DENIED_WITHOUT_REASON")) {
    return language === "en"
      ? "ProjectFlow did not return projects for the authorized organization or portfolio scope and did not provide a specific denial reason."
      : "ProjectFlow nevrátil projekty pro oprávněný organizační nebo portfolio rozsah a neposkytl konkrétní důvod odmítnutí.";
  }
  return language === "en"
    ? "ProjectFlow denied the request without confirming that local project membership was the reason."
    : "ProjectFlow dotaz odmítl, ale nepotvrdil, že důvodem bylo chybějící lokální projektové členství.";
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
    config: AklConfig;
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
  const serviceAccessToken = await directorCopilotServiceToken(input.config);
  const serviceContext: ApiRequestContext = {
    ...input.actorContext,
    subjectId: DIRECTOR_COPILOT_SERVICE_CLIENT_ID,
    accessToken: serviceAccessToken,
    roles: [],
    groups: [],
    capabilities: [],
    scopes: [],
    applicationAccess: [],
    serviceClientId: DIRECTOR_COPILOT_SERVICE_CLIENT_ID,
  };
  const authorizedScopeTypes = [...new Set(
    plan.nodes.flatMap((node) => node.requested_scopes.map((scope) => scope.type)),
  )].sort();
  const requestedCapabilities = [...new Set(
    plan.nodes.flatMap((node) => node.required_capabilities),
  )].sort();
  const returnedItemCount = snapshot
    ? new Set(
        snapshot.evidence
          .filter((item) => item.type === "structured_fact")
          .map((item) => `${item.source_system}:${item.canonical_id}`),
      ).size
    : 0;
  const registryStatus = semanticRegistryStatus();
  const catalogStatus = domainCatalogStatus();
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
      returned_item_count: returnedItemCount,
      requested_capabilities_json: JSON.stringify(requestedCapabilities),
      authorized_scope_types_json: JSON.stringify(authorizedScopeTypes),
      semantic_catalog_version: plan.query_state.catalog_version,
      semantic_registry_snapshot_id: registryStatus.snapshot_id,
      semantic_registry_content_sha256: registryStatus.content_sha256,
      stratos_domain_catalog_id: catalogStatus.catalog_id,
      connected_domain_tools_json: JSON.stringify(catalogStatus.connected_tools),
      contract_ready_domain_tools_json: JSON.stringify(catalogStatus.contract_ready_tools),
      query_sources_json: JSON.stringify(plan.query_state.sources),
      query_metric_keys_json: JSON.stringify(plan.query_state.metrics),
      query_fiscal_year: plan.query_state.period.fiscal_year,
      query_granularity: plan.query_state.granularity,
      unavailable_source_count: snapshot?.unavailable_sources.length ?? 0,
      citation_count: response.citations.length,
      status,
      history_persistence_managed_by: "web_bridge",
    },
  }, serviceContext);
}

function localized(
  language: ResponseLanguage,
  key:
    | "not_authorized"
    | "sources_unavailable"
    | "no_match"
    | "project_not_authorized"
    | "project_source_unavailable"
    | "project_no_match"
    | "budget_source_unavailable"
    | "budget_no_match"
    | "archflow_source_unavailable"
    | "archflow_no_match"
    | "aiip_source_unavailable"
    | "aiip_no_match"
    | "document_unavailable"
    | "no_uncertainty"
    | "ai_policy_blocked",
): string {
  const values = {
    cs: {
      not_authorized: "Pro tento mezidoménový dotaz nemáte současně oprávněný rozsah v Budgetu a ProjectFlow.",
      sources_unavailable: "Úplný podklad nelze bezpečně sestavit, protože některý povinný zdroj není dostupný nebo jej nelze ověřit.",
      no_match: "V aktuálně oprávněném rozsahu nebyl nalezen projekt se současnou rozpočtovou odchylkou a zpožděným milníkem.",
      project_not_authorized: "Nemáte aktivní oprávnění ProjectFlow a lokální projektové členství potřebné pro zobrazení projektových dat.",
      project_source_unavailable: "Aktuální projektová data nelze bezpečně načíst z ProjectFlow. AKB je nenahradilo historickými dokumenty.",
      project_no_match: "ProjectFlow v aktuálně oprávněném rozsahu nevrátil žádný projekt.",
      budget_source_unavailable: "Aktuální finanční údaje nelze bezpečně načíst z Budgetu. AKB je nenahradilo historickými dokumenty.",
      budget_no_match: "Budget v aktuálně oprávněném rozsahu nevrátil žádná finanční data projektu.",
      archflow_source_unavailable: "Aktuální data business požadavků nelze bezpečně načíst z ArchFlow. AKB je nenahradilo historickými dokumenty.",
      archflow_no_match: "ArchFlow v aktuálně oprávněném rozsahu nevrátil žádný business požadavek.",
      aiip_source_unavailable: "Aktuální data AI podnětů nelze bezpečně načíst z AI Innovation Portal. AKB je nenahradilo historickými dokumenty.",
      aiip_no_match: "AI Innovation Portal v aktuálně oprávněném rozsahu nevrátil žádný podnět.",
      document_unavailable: "Nebyl nalezen citovatelný dokumentový podklad pro potvrzení smluvního rizika.",
      no_uncertainty: "Nebyla zjištěna další nejistota nad dostupnými zdroji.",
      ai_policy_blocked: "Dokumentová analýza ani AI interpretace nebyla spuštěna, protože zdrojová politika nepovoluje nakonfigurovanou cestu AI zpracování.",
    },
    en: {
      not_authorized: "You do not have an authorized scope in both Budget and ProjectFlow for this cross-domain query.",
      sources_unavailable: "The complete evidence package cannot be assembled safely because a required source is unavailable or cannot be verified.",
      no_match: "No project with both a budget variance and a delayed milestone was found in the currently authorized scope.",
      project_not_authorized: "You do not have active ProjectFlow access and local project membership required to view project data.",
      project_source_unavailable: "Current project data could not be loaded safely from ProjectFlow. AKB did not replace it with historical documents.",
      project_no_match: "ProjectFlow returned no projects in your current authorized scope.",
      budget_source_unavailable: "Current financial data could not be loaded safely from Budget. AKB did not replace it with historical documents.",
      budget_no_match: "Budget returned no project financial data in your current authorized scope.",
      archflow_source_unavailable: "Current business-need data could not be loaded safely from ArchFlow. AKB did not replace it with historical documents.",
      archflow_no_match: "ArchFlow returned no business needs in your current authorized scope.",
      aiip_source_unavailable: "Current AI-idea data could not be loaded safely from AI Innovation Portal. AKB did not replace it with historical documents.",
      aiip_no_match: "AI Innovation Portal returned no ideas in your current authorized scope.",
      document_unavailable: "No citable document evidence was found to confirm contract risk.",
      no_uncertainty: "No additional uncertainty was identified in the available sources.",
      ai_policy_blocked: "Document analysis and AI interpretation were not run because the source policy does not permit the configured AI processing path.",
    },
  } as const;
  return values[language][key];
}
