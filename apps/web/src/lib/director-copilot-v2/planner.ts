import type { ApiRequestContext, ResponseLanguage } from "@/lib/types";
import {
  resolveConversationQuery,
  type ConversationQueryState,
} from "@/lib/director-copilot/query-state";
import { sourceForMetric } from "@/lib/director-copilot/semantic-catalog";

import { directorCopilotV2AccessFor, type DirectorCopilotV2AccessDecision } from "./access";
import {
  DIRECTOR_COPILOT_V2_CONTRACT,
  V2_TOOL_IDS,
  assertDirectorCopilotV2Request,
  directorCopilotV2StableId,
  type ActiveDirectorCopilotV2Application,
  type DirectorCopilotV2EntityFilters,
  type DirectorCopilotV2Granularity,
  type DirectorCopilotV2Manifest,
  type DirectorCopilotV2Request,
  type DirectorCopilotV2RequestPeriod,
  type DirectorCopilotV2Scenario,
  type DirectorCopilotV2ToolId,
} from "./contracts";
import type { DirectorCopilotV2ManifestCatalog } from "./manifest-catalog";
import {
  accessProjectionHash,
  canonicalDirectorCopilotApplication,
  type DirectorCopilotIntent,
} from "./shared";

export const DIRECTOR_COPILOT_V2_PLAN_VERSION = "director-copilot-v2-query-plan-1" as const;

export interface DirectorCopilotV2PlanNode {
  node_id: string;
  question: string;
  query_state: ConversationQueryState;
  application: ActiveDirectorCopilotV2Application;
  tool_id: DirectorCopilotV2ToolId;
  schema_revision: string;
  required_capabilities: string[];
  access: DirectorCopilotV2AccessDecision;
  request: DirectorCopilotV2Request | null;
  planning_error_code: string | null;
  timeout_ms: number;
}

export interface DirectorCopilotV2Plan {
  schema_version: typeof DIRECTOR_COPILOT_V2_PLAN_VERSION;
  contract_version: typeof DIRECTOR_COPILOT_V2_CONTRACT;
  plan_id: string;
  intent: DirectorCopilotIntent;
  language: ResponseLanguage;
  created_at: string;
  projection_hash: string;
  query_state: ConversationQueryState;
  nodes: DirectorCopilotV2PlanNode[];
}

export function buildDirectorCopilotV2Plan(input: {
  message: string;
  language: ResponseLanguage;
  context: ApiRequestContext;
  intent: DirectorCopilotIntent;
  queryState: ConversationQueryState;
  catalog: DirectorCopilotV2ManifestCatalog;
  now?: Date;
}): DirectorCopilotV2Plan {
  const now = input.now ?? new Date();
  const components = planningComponents({
    message: input.message,
    intent: input.intent,
    queryState: input.queryState,
    now,
  });
  const planSeed = {
    version: DIRECTOR_COPILOT_V2_PLAN_VERSION,
    intent: input.intent,
    message: input.message.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase(),
    query_state: input.queryState,
    projection_hash: accessProjectionHash(input.context),
  };
  const planId = directorCopilotV2StableId("plan", planSeed);
  const nodes = components.map((component, index) => {
    const { application, question, queryState } = component;
    const toolId = toolForApplication(application, queryState);
    const manifest = input.catalog.byTool.get(toolId);
    if (!manifest) throw new Error(`Director Copilot V2 manifest is missing ${toolId}.`);
    const granularity = granularityForManifest(queryState, input.context, application, manifest);
    const access = directorCopilotV2AccessFor(
      input.context,
      application,
      manifest,
      granularity,
      now.getTime(),
    );
    const filterResolution = entityFiltersForApplication(
      queryState,
      application,
    );
    const toolCallId = directorCopilotV2StableId("call", {
      plan_id: planId,
      node_index: index,
      question,
      application,
      tool_id: toolId,
    });
    const request = access.authorized && !filterResolution.errorCode
      ? requestForNode({
          planId,
          toolCallId,
          toolId,
          actorId: input.context.subjectId,
          queryState,
          message: question,
          granularity,
          manifest,
          scopes: access.scopes,
          entityFilters: filterResolution.filters,
          now,
        })
      : null;
    return {
      node_id: `node_${application}_${index + 1}`,
      question,
      query_state: queryState,
      application,
      tool_id: toolId,
      schema_revision: manifest.schema_revision,
      required_capabilities: requiredCapabilities(manifest, granularity, access.scopes.map((scope) => scope.type)),
      access,
      request,
      planning_error_code: filterResolution.errorCode,
      timeout_ms: manifest.timeout_ms,
    };
  });
  return {
    schema_version: DIRECTOR_COPILOT_V2_PLAN_VERSION,
    contract_version: DIRECTOR_COPILOT_V2_CONTRACT,
    plan_id: planId,
    intent: input.intent,
    language: input.language,
    created_at: now.toISOString(),
    projection_hash: accessProjectionHash(input.context),
    query_state: input.queryState,
    nodes,
  };
}

interface PlanningComponent {
  question: string;
  application: ActiveDirectorCopilotV2Application;
  queryState: ConversationQueryState;
}

function planningComponents(input: {
  message: string;
  intent: DirectorCopilotIntent;
  queryState: ConversationQueryState;
  now: Date;
}): PlanningComponent[] {
  const questions = splitCompositeQuestion(input.message);
  if (questions.length < 2) {
    return fallbackPlanningComponents(input.message, input.intent, input.queryState);
  }

  let inheritedState = input.queryState;
  const components: PlanningComponent[] = [];
  const relationshipQuery = isCrossSourceRelationshipQuery(input.message, input.queryState);
  for (const question of questions) {
    const resolved = resolveConversationQuery({
      message: question,
      context: { stratos_query_state: inheritedState },
      now: input.now,
    });
    if (!resolved.recognized || resolved.state.sources.length === 0) continue;
    const localState = explicitCurrentPeriodState(question, resolved.state, input.now);
    inheritedState = localState;
    for (const application of selectedApplications(localState.sources)) {
      components.push({
        question,
        application,
        queryState: relationshipQuery
          ? relationshipSourceScopedState(localState, application)
          : sourceScopedState(localState, application),
      });
    }
  }

  const unique = components.filter((component, index, all) => (
    all.findIndex((candidate) => (
      candidate.question === component.question
      && candidate.application === component.application
      && candidate.queryState.operation === component.queryState.operation
    )) === index
  ));
  return unique.length >= 2
    ? unique
    : fallbackPlanningComponents(input.message, input.intent, input.queryState);
}

function isCrossSourceRelationshipQuery(
  message: string,
  state: ConversationQueryState,
): boolean {
  if (!state.sources.includes("projectflow") || state.sources.length < 2) return false;
  const normalized = message.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(navazan\w*|propojen\w*|souvis\w*|vazb\w*|spojen\w*|relationship\w*|linked)\b/.test(normalized);
}

function relationshipSourceScopedState(
  state: ConversationQueryState,
  application: ActiveDirectorCopilotV2Application,
): ConversationQueryState {
  return {
    ...sourceScopedState(state, application),
    granularity: application === "archflow" ? "item" : "project",
  };
}

function fallbackPlanningComponents(
  message: string,
  intent: DirectorCopilotIntent,
  queryState: ConversationQueryState,
): PlanningComponent[] {
  return applicationsForIntent(intent, queryState.sources).map((application) => ({
    question: message,
    application,
    queryState: fallbackSourceScopedState(queryState, application),
  }));
}

function explicitCurrentPeriodState(
  question: string,
  state: ConversationQueryState,
  now: Date,
): ConversationQueryState {
  const normalized = question.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!/\b(aktualni|soucasny|nyni|prave ted|dnes|current|currently|now)\b/.test(normalized)) {
    return state;
  }
  return {
    ...structuredClone(state),
    period: {
      type: "current",
      fiscal_year: now.getUTCFullYear(),
      as_of: now.toISOString(),
      interval: null,
    },
  };
}

function fallbackSourceScopedState(
  state: ConversationQueryState,
  application: ActiveDirectorCopilotV2Application,
): ConversationQueryState {
  const scoped = sourceScopedState(state, application);
  if (state.sources.length < 2 || !state.sources.includes("projectflow")) return scoped;
  return {
    ...scoped,
    granularity: application === "archflow" ? "item" : "project",
  };
}

function splitCompositeQuestion(message: string): string[] {
  const normalized = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const interrogative = String.raw`(?:(?:v|ve|na|podle|dle|z|ze|u)\s+)?(?:jak(?:y|ý|a|á|e|é|em|ém|ou)?|kolik|kter(?:e|é|y|ý|a|á)|co|what|how|which)`;
  const boundary = new RegExp(
    String.raw`(?:[;?]\s*|:\s*(?=(?:a\s+)?${interrogative}\b)|,\s*(?=(?:a\s+)?${interrogative}\b)|\s+a\s+(?=${interrogative}\b))`,
    "iu",
  );
  return normalized
    .split(boundary)
    .map((part) => part.replace(/^(?:a|and)\s+/iu, "").trim())
    .filter((part) => part.length >= 4);
}

function sourceScopedState(
  state: ConversationQueryState,
  application: ActiveDirectorCopilotV2Application,
): ConversationQueryState {
  const metrics = state.metrics.filter((metric) => sourceForMetric(metric) === application);
  return {
    ...structuredClone(state),
    sources: [application],
    metrics,
    sort: state.sort && sourceForMetric(state.sort.metric) === application
      ? state.sort
      : null,
  };
}

function requestForNode(input: {
  planId: string;
  toolCallId: string;
  toolId: DirectorCopilotV2ToolId;
  actorId: string;
  queryState: ConversationQueryState;
  message: string;
  granularity: DirectorCopilotV2Granularity;
  manifest: DirectorCopilotV2Manifest;
  scopes: DirectorCopilotV2Request["requested_scopes"];
  entityFilters: DirectorCopilotV2EntityFilters;
  now: Date;
}): DirectorCopilotV2Request {
  const request: DirectorCopilotV2Request = {
    schema_version: DIRECTOR_COPILOT_V2_CONTRACT,
    tool_id: input.toolId,
    tool_call_id: input.toolCallId,
    plan_id: input.planId,
    organization_id: "org_stratos",
    actor: {
      type: "person",
      subject_id: input.actorId,
    },
    requested_at: input.now.toISOString(),
    requested_scopes: input.scopes,
    parameters: {
      period: periodForQuery(input.message, input.queryState),
      entity_filters: input.entityFilters,
      granularity: input.granularity,
      group_by: groupBy(input.queryState, input.granularity, input.manifest),
      scenario: scenarios(input.queryState, input.manifest),
      as_of: input.queryState.period.as_of,
      cursor: null,
      limit: input.queryState.operation === "count"
        ? 1
        : Math.min(100, input.manifest.limits.max_items),
    },
  };
  assertDirectorCopilotV2Request(request);
  return request;
}

function applicationsForIntent(
  intent: DirectorCopilotIntent,
  sources: string[],
): ActiveDirectorCopilotV2Application[] {
  if (intent === "portfolio_risk_correlation" || intent === "portfolio_performance_overview") {
    const selected = selectedApplications(sources);
    return selected.length > 1 ? selected : ["budget", "projectflow"];
  }
  if (intent === "budget_portfolio_status") return ["budget"];
  if (intent === "project_portfolio_status" || intent === "project_access_overview") {
    return ["projectflow"];
  }
  if (intent === "archflow_demand_overview") return ["archflow"];
  return selectedApplications(sources);
}

function selectedApplications(sources: string[]): ActiveDirectorCopilotV2Application[] {
  const selected = sources.filter(
    (source): source is ActiveDirectorCopilotV2Application => (
      source === "budget"
      || source === "projectflow"
      || source === "archflow"
    ),
  );
  const selectedSet = new Set(selected);
  return (["budget", "projectflow", "archflow"] as const)
    .filter((application) => selectedSet.has(application));
}

function toolForApplication(
  application: ActiveDirectorCopilotV2Application,
  queryState: ConversationQueryState,
): DirectorCopilotV2ToolId {
  if (application === "budget") {
    return queryState.granularity === "project"
      && queryState.entity_filters.project_ids.length > 0
      ? V2_TOOL_IDS.budgetProject
      : V2_TOOL_IDS.budgetOrganization;
  }
  if (application === "projectflow") return V2_TOOL_IDS.projectflow;
  return V2_TOOL_IDS.archflow;
}

function granularityForManifest(
  state: ConversationQueryState,
  context: ApiRequestContext,
  application: ActiveDirectorCopilotV2Application,
  manifest: DirectorCopilotV2Manifest,
): DirectorCopilotV2Granularity {
  const requested = crossSourceGranularity(state, application)
    ?? (state.granularity === "authorized_scope"
      ? operationGranularity(state, application)
        ?? inferredGranularityFromProjection(context, application)
      : state.granularity);
  if (manifest.granularities.includes(requested)) return requested;
  if (manifest.granularities.includes("item")) return "item";
  if (manifest.granularities.includes("organization")) return "organization";
  return manifest.granularities[0]!;
}

function crossSourceGranularity(
  state: ConversationQueryState,
  application: ActiveDirectorCopilotV2Application,
): DirectorCopilotV2Granularity | null {
  if (state.sources.length < 2 || !state.sources.includes("projectflow")) return null;
  if (application === "archflow") return "item";
  return "project";
}

function operationGranularity(
  state: ConversationQueryState,
  application: ActiveDirectorCopilotV2Application,
): DirectorCopilotV2Granularity | null {
  if (state.operation === "summary") return null;
  if (application === "projectflow") return "project";
  return "item";
}

function inferredGranularityFromProjection(
  context: ApiRequestContext,
  application: ActiveDirectorCopilotV2Application,
): DirectorCopilotV2Granularity {
  const access = (context.applicationAccess ?? []).find(
    (candidate) => canonicalDirectorCopilotApplication(candidate.application) === application,
  );
  const explicitTypes = new Set(
    (access?.scopes ?? []).map((scope) => scope.split(":", 1)[0]),
  );
  if (explicitTypes.has("organization")) return "organization";
  if (explicitTypes.has("organization_unit")) return "organization_unit";
  if (explicitTypes.has("portfolio")) return "portfolio";
  if (explicitTypes.has("project")) return "project";
  return "item";
}

function periodForQuery(
  message: string,
  state: ConversationQueryState,
): DirectorCopilotV2RequestPeriod {
  const dates = [...message.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((match) => match[1]!);
  if (dates.length >= 2 && dates[0]! <= dates[1]!) {
    return { type: "interval", start: dates[0]!, end: dates[1]! };
  }
  if (state.period.interval) {
    return {
      type: "interval",
      start: state.period.interval.start,
      end: state.period.interval.end,
    };
  }
  return {
    type: "fiscal_year",
    fiscal_year: state.period.fiscal_year,
  };
}

function entityFilters(state: ConversationQueryState): DirectorCopilotV2EntityFilters {
  return {
    organization_unit_ids: state.entity_filters.organization_unit_ids,
    budget_scope_ids: state.entity_filters.budget_scope_ids,
    portfolio_ids: state.entity_filters.portfolio_ids,
    project_ids: state.entity_filters.project_ids,
    need_ids: state.entity_filters.need_ids,
    idea_ids: state.entity_filters.idea_ids,
  };
}

function entityFiltersForApplication(
  state: ConversationQueryState,
  application: ActiveDirectorCopilotV2Application,
): {
  filters: DirectorCopilotV2EntityFilters;
  errorCode: string | null;
} {
  const filters = entityFilters(state);
  if (application !== "projectflow") {
    return {
      filters,
      errorCode: null,
    };
  }
  const unsupported = [
    ["budget_scope_ids", filters.budget_scope_ids ?? []],
    ["need_ids", filters.need_ids ?? []],
    ["idea_ids", filters.idea_ids ?? []],
  ] as const;
  const unresolvedTypes = unsupported
    .filter(([, values]) => values.length > 0)
    .map(([key]) => key);
  if (!unresolvedTypes.length) {
    return {
      filters,
      errorCode: null,
    };
  }
  return {
    filters,
    errorCode: "DIRECTOR_COPILOT_V2_ENTITY_FILTER_RESOLUTION_REQUIRED",
  };
}

function groupBy(
  state: ConversationQueryState,
  granularity: DirectorCopilotV2Granularity,
  manifest: DirectorCopilotV2Manifest,
): string[] {
  const actionDimension = granularity === "item"
    && state.group_by.includes("procurement_action")
    && manifest.entity_types.includes("procurement_action")
    ? "procurement_action"
    : null;
  const itemDimension = actionDimension ?? (granularity === "item"
    && state.metrics.some((metric) => metric.startsWith("budget."))
    && manifest.entity_types.includes("budget_item")
    ? "budget_item"
    : null);
  const requestedDimensions = state.group_by.map((dimension) => (
    (dimension === "item" || dimension === "procurement_action") && itemDimension
      ? itemDimension
      : dimension
  ));
  const candidates = [
    ...requestedDimensions,
    itemDimension,
    granularity === "item" ? null : granularity,
    state.filters.schedule_status ? "schedule_status" : null,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)].filter((value) => manifest.group_by.includes(value)).slice(0, 10);
}

function scenarios(
  state: ConversationQueryState,
  manifest: DirectorCopilotV2Manifest,
): DirectorCopilotV2Scenario[] {
  const resolved = state.metrics.flatMap((metric) => {
    if (metric === "budget.plan_amount") return ["plan" as const];
    if (metric === "budget.actual_amount") return ["actual" as const];
    if (metric === "budget.forecast_amount") return ["forecast" as const];
    if (metric === "budget.commitments_amount") return ["commitments" as const];
    if (metric === "budget.variance_amount") return ["variance" as const];
    return [];
  });
  return [...new Set(resolved)].filter((scenario) => manifest.scenarios.includes(scenario));
}

function requiredCapabilities(
  manifest: DirectorCopilotV2Manifest,
  granularity: DirectorCopilotV2Granularity,
  scopeTypes: string[],
): string[] {
  const conditional = manifest.capability_requirements.conditional.filter(
    (clause) => clause.when.granularities.includes(granularity)
      && clause.when.scope_types.some((scope) => scopeTypes.includes(scope)),
  );
  return [...new Set([
    ...manifest.capability_requirements.all_of,
    ...manifest.capability_requirements.any_of,
    ...conditional.flatMap((clause) => [...clause.all_of, ...clause.any_of]),
  ])].sort();
}
