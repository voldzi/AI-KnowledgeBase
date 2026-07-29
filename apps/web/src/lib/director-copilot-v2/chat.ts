import "server-only";

import { randomUUID } from "node:crypto";

import type { AklConfig } from "@/lib/api/config";
import type {
  ApiClients,
  ApiRequestContext,
  AssistantChatResponse,
  ResponseLanguage,
} from "@/lib/types";
import {
  DIRECTOR_COPILOT_AUDIT_TARGET,
  directorCopilotServiceToken,
} from "@/lib/director-copilot/service-identity";
import type { ConversationQueryState } from "@/lib/director-copilot/query-state";
import { DirectorCopilotTransportError } from "@/lib/director-copilot/transport-error";

import {
  DIRECTOR_COPILOT_V2_CONTRACT,
  DIRECTOR_COPILOT_V2_REVISION,
  type DirectorCopilotV2Fact,
  type DirectorCopilotV2Item,
} from "./contracts";
import { DirectorCopilotV2DomainToolClient } from "./domain-tool-client";
import { loadDirectorCopilotV2ManifestCatalog } from "./manifest-catalog";
import {
  orchestrateDirectorCopilotV2,
  type DirectorCopilotV2OrchestrationResult,
  type DirectorCopilotV2SourceOutcome,
  type DirectorCopilotV2Snapshot,
} from "./orchestrator";
import type { DirectorCopilotIntent } from "./shared";

const SERVICE_CLIENT_ID = "svc-akb-director-copilot";

export async function runDirectorCopilotV2Chat(input: {
  message: string;
  conversationId: string | null;
  responseLanguage: ResponseLanguage;
  actorContext: ApiRequestContext;
  clients: ApiClients;
  config: AklConfig;
  intent: DirectorCopilotIntent;
  queryState: ConversationQueryState;
  refreshActorContext?: () => Promise<ApiRequestContext>;
  mode: "active";
  fetcher?: typeof fetch;
}): Promise<AssistantChatResponse> {
  const catalog = await loadDirectorCopilotV2ManifestCatalog({
    config: input.config,
    fetcher: input.fetcher,
    context: input.actorContext,
  });
  const orchestration = await orchestrateDirectorCopilotV2({
    message: input.message,
    language: input.responseLanguage,
    context: input.actorContext,
    intent: input.intent,
    queryState: input.queryState,
    catalog,
    client: new DirectorCopilotV2DomainToolClient({
      config: input.config,
      catalog,
      fetcher: input.fetcher,
    }),
    refreshActorContext: input.refreshActorContext,
    authorizeDocument: async (documentId, context) => {
      await input.clients.registry.getDocument(documentId, context);
      return true;
    },
  });
  const response = composeResponse(
    input.conversationId,
    orchestration,
    input.responseLanguage,
  );
  await auditResult(input, orchestration, response);
  return response;
}

export function directorCopilotV2FailureResponse(input: {
  conversationId: string | null;
  language: ResponseLanguage;
  error: unknown;
  queryState: ConversationQueryState;
}): AssistantChatResponse {
  const notAuthorized = input.error instanceof DirectorCopilotTransportError
    && input.error.outcome === "not_authorized";
  const failureReasonCode = input.error instanceof DirectorCopilotTransportError
    ? input.error.code
    : "DIRECTOR_COPILOT_V2_FAILED";
  const contractRejected = failureReasonCode
    === "DIRECTOR_COPILOT_V2_SOURCE_CONTRACT_INVALID";
  const answer = input.language === "en"
    ? notAuthorized
      ? "Your current authorized scope does not cover the requested live STRATOS data."
      : contractRejected
        ? "The live STRATOS source responded, but AKB could not safely verify the response against the binding contract. I did not display the data or replace it with a document answer."
        : "The requested live STRATOS source is temporarily unavailable. I did not replace it with a document answer."
    : notAuthorized
      ? "Váš aktuálně oprávněný rozsah nepokrývá požadovaná živá data STRATOS."
      : contractRejected
        ? "Živý zdroj STRATOS odpověděl, ale AKB nemohlo odpověď bezpečně ověřit proti závaznému kontraktu. Data jsem nezobrazil ani nenahradil odpovědí z dokumentů."
        : "Požadovaný živý zdroj STRATOS je dočasně nedostupný. Nenahradil jsem jej odpovědí z dokumentů.";
  return baseResponse({
    conversationId: input.conversationId,
    responseType: notAuthorized ? "restricted" : "no_answer",
    answer,
    confidence: "insufficient_source",
    queryState: input.queryState,
    warnings: [...new Set([
      failureReasonCode,
      notAuthorized
        ? "DIRECTOR_COPILOT_V2_NOT_AUTHORIZED"
        : contractRejected
          ? "LIVE_DATA_CONTRACT_REJECTED"
          : "DIRECTOR_COPILOT_V2_SOURCE_UNAVAILABLE",
      "LIVE_DATA_FALLBACK_BLOCKED",
    ])],
    missingInformation: answer,
  });
}

export async function auditDirectorCopilotV2Failure(input: {
  conversationId: string | null;
  actorContext: ApiRequestContext;
  clients: ApiClients;
  config: AklConfig;
  mode: "active";
  error: unknown;
}): Promise<void> {
  const serviceToken = await directorCopilotServiceToken(
    input.config,
    fetch,
    DIRECTOR_COPILOT_AUDIT_TARGET,
  );
  const serviceContext: ApiRequestContext = {
    ...input.actorContext,
    subjectId: SERVICE_CLIENT_ID,
    accessToken: serviceToken,
    roles: [],
    groups: [],
    capabilities: [],
    scopes: [],
    applicationAccess: [],
    serviceClientId: SERVICE_CLIENT_ID,
  };
  const errorCode = input.error instanceof DirectorCopilotTransportError
    ? input.error.code
    : "DIRECTOR_COPILOT_V2_FAILED";
  await input.clients.registry.createAuditEvent({
    actor_id: input.actorContext.subjectId,
    event_type: "assistant.director_copilot_v2_failed",
    resource_type: "assistant_conversation",
    resource_id:
      input.conversationId
      ?? input.actorContext.correlationId
      ?? input.actorContext.requestId
      ?? "director-copilot-v2",
    severity: "warning",
    metadata: {
      contract_version: DIRECTOR_COPILOT_V2_CONTRACT,
      contract_revision: DIRECTOR_COPILOT_V2_REVISION,
      mode: input.mode,
      error_code: errorCode,
      failure_reason_code: errorCode,
      validation_error_code: input.error instanceof DirectorCopilotTransportError
        ? input.error.diagnosticCode ?? null
        : null,
      validation_issue_paths_json: input.error instanceof DirectorCopilotTransportError
        ? JSON.stringify(input.error.diagnosticPaths)
        : "[]",
      outcome: input.error instanceof DirectorCopilotTransportError
        ? input.error.outcome
        : "unavailable",
      correlation_id:
        input.actorContext.correlationId
        ?? input.actorContext.requestId
        ?? null,
    },
  }, serviceContext);
}

function composeResponse(
  conversationId: string | null,
  orchestration: DirectorCopilotV2OrchestrationResult,
  language: ResponseLanguage,
): AssistantChatResponse {
  if (orchestration.status === "not_authorized") {
    const answer = language === "en"
      ? "Your current access does not cover the requested live STRATOS data."
      : "Vaše aktuální oprávnění nepokrývá požadovaná živá data STRATOS.";
    return baseResponse({
      conversationId,
      responseType: "restricted",
      answer,
      confidence: "insufficient_source",
      queryState: orchestration.continuation_query_state,
      snapshot: orchestration.snapshot,
      warnings: outcomeWarnings(orchestration.snapshot),
      missingInformation: answer,
    });
  }
  if (orchestration.status === "unavailable") {
    const contractRejected = orchestration.snapshot.outcomes.some((outcome) => (
      outcome.reason_codes.includes("DIRECTOR_COPILOT_V2_SOURCE_CONTRACT_INVALID")
    ));
    const answer = language === "en"
      ? contractRejected
        ? "The live STRATOS source responded, but AKB could not safely verify the response against the binding contract. I did not display the data or substitute document search."
        : "The requested live STRATOS source is temporarily unavailable. I did not substitute document search."
      : contractRejected
        ? "Živý zdroj STRATOS odpověděl, ale AKB nemohlo odpověď bezpečně ověřit proti závaznému kontraktu. Data jsem nezobrazil ani nenahradil vyhledáváním v dokumentech."
        : "Požadovaný živý zdroj STRATOS je dočasně nedostupný. Nenahradil jsem jej vyhledáváním v dokumentech.";
    return baseResponse({
      conversationId,
      responseType: "no_answer",
      answer,
      confidence: "insufficient_source",
      queryState: orchestration.continuation_query_state,
      snapshot: orchestration.snapshot,
      warnings: [
        ...outcomeWarnings(orchestration.snapshot),
        contractRejected
          ? "LIVE_DATA_CONTRACT_REJECTED"
          : "DIRECTOR_COPILOT_V2_SOURCE_UNAVAILABLE",
        "LIVE_DATA_FALLBACK_BLOCKED",
      ],
      missingInformation: answer,
    });
  }
  if (orchestration.status === "no_data") {
    const answer = language === "en"
      ? "The authorized STRATOS sources contain no data matching this query."
      : "Oprávněné zdroje STRATOS neobsahují data odpovídající tomuto dotazu.";
    return baseResponse({
      conversationId,
      responseType: "no_answer",
      answer,
      confidence: "high",
      queryState: orchestration.continuation_query_state,
      snapshot: orchestration.snapshot,
      warnings: outcomeWarnings(orchestration.snapshot),
      missingInformation: answer,
    });
  }
  const sections = orchestration.snapshot.outcomes
    .filter((outcome) => outcome.items.length > 0)
    .map((outcome) => renderSource(
      outcome,
      orchestration.plan.query_state,
      language,
    ));
  const correlations = [
    renderProjectCorrelation(orchestration.snapshot, language),
    renderInnovationTrace(orchestration.snapshot, language),
  ].filter(Boolean);
  const partialNotice = orchestration.status === "partial"
    ? language === "en"
      ? "The result is partial because at least one authorized source did not return a complete result."
      : "Výsledek je částečný, protože nejméně jeden oprávněný zdroj neposkytl úplný výsledek."
    : "";
  const documentNotice = orchestration.snapshot.authorized_document_ids.length
    ? language === "en"
      ? `${orchestration.snapshot.authorized_document_ids.length} related AKB document(s) were independently authorized.`
      : `Samostatnou autorizací prošlo ${orchestration.snapshot.authorized_document_ids.length} souvisejících dokumentů AKB.`
    : "";
  const answer = [
    partialNotice,
    ...correlations,
    ...sections,
    documentNotice,
  ].filter(Boolean).join("\n\n");
  return baseResponse({
    conversationId,
    responseType: "answer",
    answer,
    confidence: orchestration.status === "partial" ? "medium" : "high",
    queryState: orchestration.continuation_query_state,
    snapshot: orchestration.snapshot,
    warnings: outcomeWarnings(orchestration.snapshot),
    missingInformation: null,
    followUps: followUps(language, orchestration.plan.intent),
  });
}

function renderInnovationTrace(
  snapshot: DirectorCopilotV2Snapshot,
  language: ResponseLanguage,
): string {
  const ideas = snapshot.outcomes.find((outcome) => outcome.application === "aiip");
  const needs = snapshot.outcomes.find((outcome) => outcome.application === "archflow");
  if (!ideas || !needs) return "";
  const needsById = new Map(needs.items.map((item) => [item.canonical_id, item]));
  const rows = ideas.items.flatMap((idea, index) => {
    const needLink = idea.links.find((link) => (
      link.key === "aiip.idea.archflow_need"
      && link.relation_type === "direct"
      && link.target_entity_type === "need"
    ));
    if (!needLink) return [];
    const need = needsById.get(needLink.target_canonical_id);
    if (!need) return [];
    const linkedProject = need.links.some((link) => (
      link.key === "archflow.need.linked_project"
      && link.relation_type === "direct"
      && link.target_entity_type === "project"
    ));
    return [[
      safeItemLabel(idea, index, language),
      safeItemLabel(need, index, language),
      formatFact(
        need.facts.find((fact) => fact.key === "archflow.need.status"),
        language,
      ),
      linkedProject
        ? language === "en" ? "yes" : "ano"
        : language === "en" ? "no" : "ne",
    ]];
  }).slice(0, 25);
  if (!rows.length) return "";
  const headers = language === "en"
    ? ["Idea", "Need", "Need status", "Linked project"]
    : ["Podnět", "Potřeba", "Stav potřeby", "Navázaný projekt"];
  const table = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
  const title = language === "en"
    ? "### Idea to delivery trace"
    : "### Cesta podnětu k realizaci";
  return `${title}\n\n${table}`;
}

function renderProjectCorrelation(
  snapshot: DirectorCopilotV2Snapshot,
  language: ResponseLanguage,
): string {
  const budget = snapshot.outcomes.find((outcome) => outcome.application === "budget");
  const projectflow = snapshot.outcomes.find((outcome) => outcome.application === "projectflow");
  if (!budget || !projectflow) return "";
  const projectflowById = new Map(
    projectflow.items
      .filter((item) => item.canonical_id.startsWith("stratos:project:"))
      .map((item) => [item.canonical_id, item]),
  );
  const pairs = budget.items
    .filter((item) => item.canonical_id.startsWith("stratos:project:"))
    .flatMap((financial) => {
      const delivery = projectflowById.get(financial.canonical_id);
      return delivery ? [{ financial, delivery }] : [];
    })
    .slice(0, 25);
  if (!pairs.length) return "";
  const headers = language === "en"
    ? ["Project", "Plan", "Forecast/actual", "Variance", "Schedule", "Maximum delay"]
    : ["Projekt", "Plán", "Výhled/skutečnost", "Odchylka", "Harmonogram", "Nejvyšší zpoždění"];
  const rows = pairs.map(({ financial, delivery }, index) => {
    const forecastOrActual = financial.facts.find(
      (fact) => fact.key === "budget.forecast_amount",
    ) ?? financial.facts.find((fact) => fact.key === "budget.actual_amount");
    return [
      safeItemLabel(financial, index, language),
      formatFact(financial.facts.find((fact) => fact.key === "budget.plan_amount"), language),
      formatFact(forecastOrActual, language),
      formatFact(financial.facts.find((fact) => fact.key === "budget.variance_amount"), language),
      formatFact(delivery.facts.find((fact) => fact.key === "project.schedule_status"), language),
      formatFact(delivery.facts.find((fact) => fact.key === "milestone.max_delay_days"), language),
    ];
  });
  const table = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
  const title = language === "en"
    ? "### Financial and delivery correlation"
    : "### Souvislost financí a realizace";
  return `${title}\n\n${table}`;
}

function renderSource(
  outcome: DirectorCopilotV2SourceOutcome,
  queryState: ConversationQueryState,
  language: ResponseLanguage,
): string {
  const application = outcome.application;
  const ranked = rankItems(outcome, queryState);
  const items = ranked.items;
  const sourceName = {
    budget: "Budget",
    projectflow: "ProjectFlow",
    archflow: "ArchFlow",
    aiip: "AI Innovation Portal",
  }[application];
  const selectedFacts = preferredFactKeys(application, items);
  const headers = [
    language === "en" ? "Item" : "Položka",
    ...selectedFacts.map((key) => factLabel(key, language)),
    language === "en" ? "As of" : "Stav k",
  ];
  const rows = items.slice(0, 25).map((item, index) => [
    safeItemLabel(item, index, language),
    ...selectedFacts.map((key) => formatFact(
      item.facts.find((fact) => fact.key === key),
      language,
    )),
    formatDateTime(item.as_of, language),
  ]);
  const table = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
  const summary = ranked.topOnly && queryState.sort
    ? language === "en"
      ? `Highest authorized item by ${factLabel(queryState.sort.metric, language)} from ${outcome.items.length} returned item(s).`
      : `Nejvyšší oprávněná položka podle metriky ${factLabel(queryState.sort.metric, language)} z ${outcome.items.length} vrácených položek.`
    : language === "en"
      ? `${sourceName} returned ${outcome.items.length} authorized item(s).`
      : `${sourceName} vrátil ${outcome.items.length} oprávněných položek.`;
  const truncated = !ranked.topOnly && items.length > rows.length
    ? language === "en"
      ? `\n\nThe table shows the first ${rows.length} items.`
      : `\n\nTabulka zobrazuje prvních ${rows.length} položek.`
    : "";
  return `### ${sourceName}\n\n${summary}\n\n${table}${truncated}`;
}

function rankItems(
  outcome: DirectorCopilotV2SourceOutcome,
  queryState: ConversationQueryState,
): { items: DirectorCopilotV2Item[]; topOnly: boolean } {
  const sort = queryState.sort;
  if (!sort) return { items: outcome.items, topOnly: false };
  const comparable = outcome.items.flatMap((item) => {
    const fact = item.facts.find((candidate) => candidate.key === sort.metric);
    return typeof fact?.value === "number" ? [{ item, fact }] : [];
  });
  if (!comparable.length || !comparableCurrencies(comparable.map(({ fact }) => fact))) {
    return { items: outcome.items, topOnly: false };
  }
  const direction = sort.direction === "asc" ? 1 : -1;
  const sorted = [...comparable]
    .sort((left, right) => (
      (Number(left.fact.value) - Number(right.fact.value)) * direction
      || left.item.canonical_id.localeCompare(right.item.canonical_id)
    ))
    .map(({ item }) => item);
  const topOnly = outcome.authorized_result_complete
    && outcome.candidate_count <= outcome.items.length;
  return {
    items: topOnly ? sorted.slice(0, 1) : sorted,
    topOnly,
  };
}

function comparableCurrencies(facts: DirectorCopilotV2Fact[]): boolean {
  const currencies = new Set(
    facts
      .filter((fact) => fact.value_type === "currency")
      .map((fact) => fact.currency ?? ""),
  );
  return currencies.size <= 1;
}

function preferredFactKeys(
  application: "budget" | "projectflow" | "archflow" | "aiip",
  items: DirectorCopilotV2Item[],
): string[] {
  const available = new Set(items.flatMap((item) => item.facts.map((fact) => fact.key)));
  const preferences = {
    budget: [
      "budget.plan_amount",
      "budget.actual_amount",
      "budget.forecast_amount",
      "budget.commitments_amount",
      "budget.variance_amount",
    ],
    projectflow: [
      "project.status",
      "project.schedule_status",
      "project.progress_percent",
      "milestone.max_delay_days",
      "milestone.next_due_date",
    ],
    archflow: [
      "archflow.need.status",
      "archflow.need.readiness_score",
      "archflow.need.impact_score",
      "archflow.need.decision",
      "archflow.need.budget_handoff_status",
    ],
    aiip: [
      "aiip.idea.pipeline_status",
      "aiip.idea.category",
      "aiip.idea.value_score",
      "aiip.idea.risk_manageability_score",
      "aiip.idea.archflow_handoff_status",
    ],
  }[application];
  return preferences.filter((key) => available.has(key)).slice(0, 5);
}

function safeItemLabel(
  item: DirectorCopilotV2Item,
  index: number,
  language: ResponseLanguage,
): string {
  const displayName = item.facts.find((fact) => fact.key.endsWith(".display_name"))
    ?? item.facts.find((fact) => fact.key === "idea.display_name");
  const fallback = language === "en" ? `Item ${index + 1}` : `Položka ${index + 1}`;
  const label = typeof displayName?.value === "string" && displayName.value.trim()
    ? displayName.value.trim()
    : fallback;
  const safeLabel = markdownCell(label);
  try {
    const url = new URL(item.deep_link);
    return url.protocol === "https:" || url.protocol === "http:"
      ? `[${safeLabel}](${url.toString()})`
      : safeLabel;
  } catch {
    return safeLabel;
  }
}

function formatFact(
  fact: DirectorCopilotV2Fact | undefined,
  language: ResponseLanguage,
): string {
  if (!fact || fact.value === null) return language === "en" ? "not available" : "není k dispozici";
  if (fact.value_type === "currency" && typeof fact.value === "number") {
    return new Intl.NumberFormat(language === "en" ? "en-US" : "cs-CZ", {
      style: "currency",
      currency: fact.currency ?? "CZK",
      maximumFractionDigits: 2,
    }).format(fact.value);
  }
  if (fact.value_type === "percent" && typeof fact.value === "number") {
    return `${new Intl.NumberFormat(language === "en" ? "en-US" : "cs-CZ").format(fact.value)} %`;
  }
  if (fact.value_type === "duration_days" && typeof fact.value === "number") {
    return language === "en" ? `${fact.value} days` : `${fact.value} dní`;
  }
  if (typeof fact.value === "number") {
    return new Intl.NumberFormat(language === "en" ? "en-US" : "cs-CZ").format(fact.value);
  }
  if (typeof fact.value === "boolean") {
    return fact.value
      ? language === "en" ? "yes" : "ano"
      : language === "en" ? "no" : "ne";
  }
  return String(fact.value);
}

function factLabel(key: string, language: ResponseLanguage): string {
  const labels: Record<string, [string, string]> = {
    "budget.plan_amount": ["Plan", "Plán"],
    "budget.actual_amount": ["Actual", "Skutečnost"],
    "budget.forecast_amount": ["Forecast", "Výhled"],
    "budget.commitments_amount": ["Commitments", "Závazky"],
    "budget.variance_amount": ["Variance", "Odchylka"],
    "project.status": ["Status", "Stav"],
    "project.schedule_status": ["Schedule", "Harmonogram"],
    "project.progress_percent": ["Progress", "Postup"],
    "milestone.max_delay_days": ["Maximum delay", "Nejvyšší zpoždění"],
    "milestone.next_due_date": ["Next milestone", "Nejbližší milník"],
    "archflow.need.status": ["Status", "Stav"],
    "archflow.need.readiness_score": ["Readiness", "Připravenost"],
    "archflow.need.impact_score": ["Impact", "Dopad"],
    "archflow.need.decision": ["Decision", "Rozhodnutí"],
    "archflow.need.budget_handoff_status": ["Budget handoff", "Předání do Budgetu"],
    "aiip.idea.pipeline_status": ["Status", "Stav"],
    "aiip.idea.category": ["Category", "Kategorie"],
    "aiip.idea.value_score": ["Value", "Přínos"],
    "aiip.idea.risk_manageability_score": ["Risk", "Riziko"],
    "aiip.idea.archflow_handoff_status": ["ArchFlow handoff", "Předání do ArchFlow"],
  };
  return labels[key]?.[language === "en" ? 0 : 1] ?? key;
}

function baseResponse(input: {
  conversationId: string | null;
  responseType: AssistantChatResponse["response_type"];
  answer: string;
  confidence: AssistantChatResponse["confidence"];
  queryState: ConversationQueryState;
  snapshot?: DirectorCopilotV2Snapshot;
  warnings: string[];
  missingInformation: string | null;
  followUps?: string[];
}): AssistantChatResponse {
  return {
    response_type: input.responseType,
    conversation_id: input.conversationId
      ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer: input.answer,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      answer_source: "director_copilot_v2",
      active_source_application: null,
      stratos_query_state: input.queryState,
      requested_director_copilot_intent: input.snapshot?.plan.intent ?? null,
      ...(input.snapshot ? { director_copilot_v2_snapshot: input.snapshot } : {}),
    },
    citations: [],
    follow_up_questions: input.followUps ?? [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: input.confidence,
    warnings: [...new Set(input.warnings)],
    missing_information: input.missingInformation,
    recommended_action: null,
  };
}

function outcomeWarnings(snapshot: DirectorCopilotV2Snapshot): string[] {
  return [...new Set([
    ...snapshot.outcomes.flatMap((outcome) => outcome.reason_codes),
    ...snapshot.internal_warnings,
    "DIRECTOR_COPILOT_V2_LIVE_DATA",
  ])];
}

function followUps(
  language: ResponseLanguage,
  intent: DirectorCopilotIntent,
): string[] {
  if (intent === "budget_portfolio_status") {
    return language === "en"
      ? ["Break it down by portfolios.", "Which projects exceed the plan?"]
      : ["Rozděl ho podle portfolií.", "Které projekty překračují plán?"];
  }
  if (intent === "project_portfolio_status") {
    return language === "en"
      ? ["Which projects are delayed?", "Show upcoming milestones."]
      : ["Které projekty jsou zpožděné?", "Ukaž nejbližší milníky."];
  }
  return language === "en"
    ? ["Show the incomplete handoffs.", "Which items require a decision?"]
    : ["Ukaž nedokončená předání.", "Které položky vyžadují rozhodnutí?"];
}

async function auditResult(
  input: {
    actorContext: ApiRequestContext;
    clients: ApiClients;
    config: AklConfig;
  mode: "active";
  },
  orchestration: DirectorCopilotV2OrchestrationResult,
  response: AssistantChatResponse,
): Promise<void> {
  const serviceToken = await directorCopilotServiceToken(
    input.config,
    fetch,
    DIRECTOR_COPILOT_AUDIT_TARGET,
  );
  const serviceContext: ApiRequestContext = {
    ...input.actorContext,
    subjectId: SERVICE_CLIENT_ID,
    accessToken: serviceToken,
    roles: [],
    groups: [],
    capabilities: [],
    scopes: [],
    applicationAccess: [],
    serviceClientId: SERVICE_CLIENT_ID,
  };
  await input.clients.registry.createAuditEvent({
    actor_id: input.actorContext.subjectId,
    event_type: "assistant.director_copilot_v2_returned",
    resource_type: "assistant_conversation",
    resource_id: response.conversation_id,
    severity: orchestration.status === "complete" ? "info" : "warning",
    metadata: {
      contract_version: DIRECTOR_COPILOT_V2_CONTRACT,
      contract_revision: DIRECTOR_COPILOT_V2_REVISION,
      mode: input.mode,
      plan_id: orchestration.plan.plan_id,
      snapshot_id: orchestration.snapshot.snapshot_id,
      snapshot_hash: orchestration.snapshot.snapshot_hash,
      tool_ids_json: JSON.stringify(
        orchestration.plan.nodes.map((node) => node.tool_id),
      ),
      schema_revisions_json: JSON.stringify(
        orchestration.plan.nodes.map((node) => node.schema_revision),
      ),
      source_versions_json: JSON.stringify(
        orchestration.snapshot.outcomes.map((outcome) => ({
          application: outcome.application,
          source_version: outcome.source_version,
        })),
      ),
      requested_capabilities_json: JSON.stringify(
        [...new Set(orchestration.plan.nodes.flatMap((node) => node.required_capabilities))].sort(),
      ),
      authorized_scope_types_json: JSON.stringify(
        [...new Set(orchestration.plan.nodes.flatMap(
          (node) => node.request?.requested_scopes.map((scope) => scope.type) ?? [],
        ))].sort(),
      ),
      source_statuses_json: JSON.stringify(
        orchestration.snapshot.outcomes.map((outcome) => ({
          application: outcome.application,
          status: outcome.status,
          reason_codes: outcome.reason_codes,
          returned_item_count: outcome.items.length,
          latency_ms: outcome.latency_ms,
        })),
      ),
      returned_item_count: orchestration.snapshot.outcomes.reduce(
        (total, outcome) => total + outcome.items.length,
        0,
      ),
      authorized_document_link_count:
        orchestration.snapshot.authorized_document_ids.length,
      status: orchestration.status,
      failure_reason_code: primaryFailureReasonCode(orchestration),
    },
  }, serviceContext);
}

function primaryFailureReasonCode(
  orchestration: DirectorCopilotV2OrchestrationResult,
): string | null {
  if (orchestration.status === "complete" || orchestration.status === "no_data") {
    return null;
  }
  const reasonCode = orchestration.snapshot.outcomes
    .filter((outcome) => (
      outcome.status === "partial"
      || outcome.status === "not_authorized"
      || outcome.status === "unavailable"
    ))
    .flatMap((outcome) => outcome.reason_codes)
    .sort()[0];
  return reasonCode
    ?? `DIRECTOR_COPILOT_V2_${orchestration.status.toUpperCase()}`;
}

function markdownCell(value: unknown): string {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function formatDateTime(value: string, language: ResponseLanguage): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return language === "en" ? "not available" : "není k dispozici";
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "cs-CZ", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  }).format(date);
}
