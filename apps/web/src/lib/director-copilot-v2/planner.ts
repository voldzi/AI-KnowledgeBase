import type { ApiRequestContext, ResponseLanguage } from "@/lib/types";
import { accessProjectionHash } from "@/lib/director-copilot/access";
import { canonicalDirectorCopilotApplication } from "@/lib/director-copilot/application-id";
import type { DirectorCopilotIntent } from "@/lib/director-copilot/contracts";
import type { ConversationQueryState } from "@/lib/director-copilot/query-state";

import { directorCopilotV2AccessFor, type DirectorCopilotV2AccessDecision } from "./access";
import {
  DIRECTOR_COPILOT_V2_CONTRACT,
  V2_TOOL_IDS,
  assertDirectorCopilotV2Request,
  directorCopilotV2StableId,
  type DirectorCopilotV2Application,
  type DirectorCopilotV2EntityFilters,
  type DirectorCopilotV2Granularity,
  type DirectorCopilotV2Manifest,
  type DirectorCopilotV2Request,
  type DirectorCopilotV2RequestPeriod,
  type DirectorCopilotV2Scenario,
  type DirectorCopilotV2ToolId,
} from "./contracts";
import type { DirectorCopilotV2ManifestCatalog } from "./manifest-catalog";

export const DIRECTOR_COPILOT_V2_PLAN_VERSION = "director-copilot-v2-query-plan-1" as const;

export interface DirectorCopilotV2PlanNode {
  node_id: string;
  application: DirectorCopilotV2Application;
  tool_id: DirectorCopilotV2ToolId;
  schema_revision: string;
  required_capabilities: string[];
  access: DirectorCopilotV2AccessDecision;
  request: DirectorCopilotV2Request | null;
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
  const applications = applicationsForIntent(input.intent, input.queryState.sources);
  const planSeed = {
    version: DIRECTOR_COPILOT_V2_PLAN_VERSION,
    intent: input.intent,
    message: input.message.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase(),
    query_state: input.queryState,
    projection_hash: accessProjectionHash(input.context),
  };
  const planId = directorCopilotV2StableId("plan", planSeed);
  const nodes = applications.map((application) => {
    const toolId = toolForApplication(application, input.queryState);
    const manifest = input.catalog.byTool.get(toolId);
    if (!manifest) throw new Error(`Director Copilot V2 manifest is missing ${toolId}.`);
    const granularity = granularityForManifest(input.queryState, input.context, application, manifest);
    const access = directorCopilotV2AccessFor(
      input.context,
      application,
      manifest,
      granularity,
      now.getTime(),
    );
    const toolCallId = directorCopilotV2StableId("call", {
      plan_id: planId,
      application,
      tool_id: toolId,
    });
    const request = access.authorized
      ? requestForNode({
          planId,
          toolCallId,
          toolId,
          actorId: input.context.subjectId,
          queryState: input.queryState,
          message: input.message,
          granularity,
          manifest,
          scopes: access.scopes,
          now,
        })
      : null;
    return {
      node_id: `node_${application}`,
      application,
      tool_id: toolId,
      schema_revision: manifest.schema_revision,
      required_capabilities: requiredCapabilities(manifest, granularity, access.scopes.map((scope) => scope.type)),
      access,
      request,
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
      entity_filters: entityFilters(input.queryState),
      granularity: input.granularity,
      group_by: groupBy(input.queryState, input.granularity, input.manifest),
      scenario: scenarios(input.queryState, input.manifest),
      as_of: input.queryState.period.as_of,
      cursor: null,
      limit: Math.min(100, input.manifest.limits.max_items),
    },
  };
  assertDirectorCopilotV2Request(request);
  return request;
}

function applicationsForIntent(
  intent: DirectorCopilotIntent,
  sources: string[],
): DirectorCopilotV2Application[] {
  if (intent === "portfolio_risk_correlation" || intent === "portfolio_performance_overview") {
    return ["budget", "projectflow"];
  }
  if (intent === "budget_portfolio_status") return ["budget"];
  if (intent === "project_portfolio_status" || intent === "project_access_overview") {
    return ["projectflow"];
  }
  if (intent === "archflow_demand_overview") return ["archflow"];
  if (intent === "aiip_idea_overview") return ["aiip"];
  const selected = sources.filter(
    (source): source is DirectorCopilotV2Application => (
      source === "budget"
      || source === "projectflow"
      || source === "archflow"
      || source === "aiip"
    ),
  );
  return [...new Set(selected)];
}

function toolForApplication(
  application: DirectorCopilotV2Application,
  queryState: ConversationQueryState,
): DirectorCopilotV2ToolId {
  if (application === "budget") {
    return queryState.granularity === "project"
      && queryState.entity_filters.project_ids.length > 0
      ? V2_TOOL_IDS.budgetProject
      : V2_TOOL_IDS.budgetOrganization;
  }
  if (application === "projectflow") return V2_TOOL_IDS.projectflow;
  if (application === "archflow") return V2_TOOL_IDS.archflow;
  return V2_TOOL_IDS.aiip;
}

function granularityForManifest(
  state: ConversationQueryState,
  context: ApiRequestContext,
  application: DirectorCopilotV2Application,
  manifest: DirectorCopilotV2Manifest,
): DirectorCopilotV2Granularity {
  const requested = state.granularity === "authorized_scope"
    ? inferredGranularityFromProjection(context, application)
    : state.granularity;
  if (manifest.granularities.includes(requested)) return requested;
  if (manifest.granularities.includes("item")) return "item";
  if (manifest.granularities.includes("organization")) return "organization";
  return manifest.granularities[0]!;
}

function inferredGranularityFromProjection(
  context: ApiRequestContext,
  application: DirectorCopilotV2Application,
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

function groupBy(
  state: ConversationQueryState,
  granularity: DirectorCopilotV2Granularity,
  manifest: DirectorCopilotV2Manifest,
): string[] {
  const candidates = [
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
