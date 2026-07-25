import type { ApiRequestContext, ResponseLanguage } from "@/lib/types";

import { accessProjectionHash, domainAccessFor } from "./access";
import {
  DIRECTOR_COPILOT_QUERY_PLAN_VERSION,
  DOMAIN_TOOL_IDS,
  parseScopeString,
  stableId,
  type DirectorCopilotIntent,
  type DirectorQueryPlan,
  type DirectorQueryPlanNode,
  type DomainApplication,
} from "./contracts";
import {
  resolveConversationQuery,
  type ConversationQueryState,
} from "./query-state";

const CONTRACT_SIGNAL = /(smlouv|contract|dodavatel|supplier|rizik|risk)/i;
const DOCUMENT_SIGNAL = /(dokument|priloh|smernic|metodik|citac|soubor|pdf)/i;
const ACCESS_SIGNAL = /(pristup|opravnen|access|permission)/i;
const ACCESS_MUTATION_SIGNAL = /(pozad|zadat|pridel|pridej|nastav|zmen|odebr|zrus|schval|vytvor)/i;
const ACCESS_OVERVIEW_SIGNAL = /(mam|mas|mame|mohu|muz|vidim|dostup|over|zkontrol|k jakym|jaky mam)/i;
const PROJECTFLOW_SIGNAL = /project\s*flow|projectflow/i;
const PROJECT_DATA_SIGNAL = /(stav|prehled|seznam|evid|kolik|ktere|jake|projekt|milnik|harmonogram|termin|zpozd)/i;

export function isDirectorCopilotRiskQuery(message: string): boolean {
  return classifyDirectorCopilotIntent(message) === "portfolio_risk_correlation";
}

export function classifyDirectorCopilotIntent(
  message: string,
  context: Record<string, unknown> = {},
): DirectorCopilotIntent | null {
  const normalized = normalizeForIntent(message);
  const resolved = resolveConversationQuery({ message, context });
  if (!resolved.recognized || resolved.pending_sources.length) return null;
  const explicitProjectFlow = PROJECTFLOW_SIGNAL.test(normalized);
  const documentQuestion = DOCUMENT_SIGNAL.test(normalized);
  const accessQuestion = ACCESS_SIGNAL.test(normalized);
  const accessMutation = accessQuestion && ACCESS_MUTATION_SIGNAL.test(normalized);
  const accessOverview = accessQuestion && ACCESS_OVERVIEW_SIGNAL.test(normalized);
  if (
    explicitProjectFlow
    && accessOverview
    && !accessMutation
    && !PROJECT_DATA_SIGNAL.test(normalized.replace(PROJECTFLOW_SIGNAL, ""))
  ) {
    return "project_access_overview";
  }
  if (accessMutation) return null;
  if (documentQuestion && !explicitProjectFlow) return null;
  const sourceSet = new Set(resolved.state.sources);
  if (
    (sourceSet.has("archflow") || sourceSet.has("aiip"))
    && sourceSet.size > 1
  ) {
    return "innovation_delivery_trace";
  }
  if (sourceSet.has("archflow")) {
    return "archflow_demand_overview";
  }
  if (sourceSet.has("aiip")) {
    return "aiip_idea_overview";
  }
  if (sourceSet.has("budget") && sourceSet.has("projectflow")) {
    return CONTRACT_SIGNAL.test(normalized) || resolved.state.document_evidence_requested
      ? "portfolio_risk_correlation"
      : "portfolio_performance_overview";
  }
  if (sourceSet.has("budget")) {
    return "budget_portfolio_status";
  }
  if (sourceSet.has("projectflow")) {
    return "project_portfolio_status";
  }
  return null;
}

export function buildDirectorQueryPlan(input: {
  message: string;
  language: ResponseLanguage;
  context: ApiRequestContext;
  intent?: DirectorCopilotIntent;
  queryState?: ConversationQueryState;
  now?: Date;
  timeoutMs?: number;
}): DirectorQueryPlan {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const intent = input.intent ?? "portfolio_risk_correlation";
  const queryState = input.queryState
    ?? resolveConversationQuery({
      message: input.message,
      context: {},
      now,
    }).state;
  const asOf = queryState.period.as_of;
  const projectionHash = accessProjectionHash(input.context);
  const timeoutMs = Math.max(500, Math.min(input.timeoutMs ?? 8_000, 30_000));
  const planId = stableId("plan", {
    version: DIRECTOR_COPILOT_QUERY_PLAN_VERSION,
    intent,
    message: input.message.replace(/\s+/g, " ").trim().toLowerCase(),
    query_state: queryState,
    language: input.language,
    as_of: asOf,
    projection_hash: projectionHash,
  });
  return {
    schema_version: DIRECTOR_COPILOT_QUERY_PLAN_VERSION,
    plan_id: planId,
    intent,
    language: input.language,
    created_at: createdAt,
    as_of: asOf,
    projection_hash: projectionHash,
    query_state: queryState,
    nodes: [
      ...domainApplicationsForIntent(intent, queryState)
        .map((application) => domainPlanNode({
          application,
          context: input.context,
          now,
          asOf,
          queryState,
          timeoutMs,
        })),
      ...(intent === "portfolio_risk_correlation" ? [{
        node_id: "node_akb_contracts",
        tool_id: "akb.contract_risk_retrieval.v1" as const,
        source_application: "akb" as const,
        required_capabilities: ["akb:chat"],
        requested_scopes: (input.context.scopes ?? []).flatMap((scope) => {
          const parsed = parseScopeString(scope);
          return parsed ? [parsed] : [];
        }),
        parameters: {
          as_of: asOf,
          project_ids: queryState.entity_filters.project_ids,
          portfolio_ids: queryState.entity_filters.portfolio_ids,
        },
        depends_on: ["node_budget", "node_projectflow"],
        timeout_ms: timeoutMs,
      }] : []),
    ],
    output: {
      kind: "answer",
      four_layer_answer: intent === "portfolio_risk_correlation",
      artifact_contract_version: "report.v2",
    },
    quality_gates: {
      structured_facts_required: true,
      document_citations_required: intent === "portfolio_risk_correlation",
      partial_must_be_visible: true,
      no_scope_expansion: true,
    },
  };
}

function domainApplicationsForIntent(
  intent: DirectorCopilotIntent,
  state: ConversationQueryState,
): DomainApplication[] {
  if (intent === "portfolio_risk_correlation" || intent === "portfolio_performance_overview") {
    return ["budget", "projectflow"];
  }
  if (intent === "budget_portfolio_status") return ["budget"];
  if (intent === "project_portfolio_status" || intent === "project_access_overview") {
    return ["projectflow"];
  }
  if (intent === "archflow_demand_overview") return ["archflow"];
  if (intent === "aiip_idea_overview") return ["aiip"];
  return state.sources.filter(
    (source): source is DomainApplication => (
      source === "budget"
      || source === "projectflow"
      || source === "archflow"
      || source === "aiip"
    ),
  );
}

function domainPlanNode(input: {
  application: DomainApplication;
  context: ApiRequestContext;
  now: Date;
  asOf: string;
  queryState: ConversationQueryState;
  timeoutMs: number;
}): DirectorQueryPlanNode {
  const access = domainAccessFor(input.context, input.application, input.now.getTime());
  return {
    node_id: `node_${input.application}`,
    tool_id: DOMAIN_TOOL_IDS[input.application],
    source_application: input.application,
    required_capabilities: access.requiredCapabilities,
    requested_scopes: access.authorized ? access.scopes : [],
    parameters: {
      as_of: input.asOf,
      project_ids: input.queryState.entity_filters.project_ids,
      portfolio_ids: input.queryState.entity_filters.portfolio_ids,
    },
    depends_on: [],
    timeout_ms: input.timeoutMs,
  };
}

export function toolCallId(planId: string, nodeId: string): string {
  return stableId("call", { plan_id: planId, node_id: nodeId });
}

function normalizeForIntent(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
