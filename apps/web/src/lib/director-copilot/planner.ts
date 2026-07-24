import type { ApiRequestContext, ResponseLanguage } from "@/lib/types";

import { accessProjectionHash, domainAccessFor } from "./access";
import {
  DIRECTOR_COPILOT_QUERY_PLAN_VERSION,
  DOMAIN_TOOL_IDS,
  parseScopeString,
  stableId,
  type DirectorCopilotIntent,
  type DirectorQueryPlan,
} from "./contracts";

const BUDGET_SIGNAL = /(rozpoc|budget|finan|odchyl|forecast|plan|skutecnost|cerpan)/i;
const DELIVERY_SIGNAL = /(projectflow|projekt|project|portfolio|milnik|milestone|harmonogram|zpozd|delay|termin|ukol|realizac|plneni)/i;
const CONTRACT_SIGNAL = /(smlouv|contract|dodavatel|supplier|rizik|risk)/i;
const PROJECT_LIVE_SIGNAL = /(stav|prehled|seznam|evid|kolik|ktere|jake|jak je|aktual|zpozd|milnik|harmonogram|termin|ukol|plneni|pokrok|problem|zavislost|kapacit|tym)/i;
const DOCUMENT_SIGNAL = /(dokument|priloh|smernic|metodik|citac|soubor|pdf)/i;
const ACCESS_SIGNAL = /(pristup|opravnen|access|permission)/i;
const ACCESS_MUTATION_SIGNAL = /(pozad|zadat|pridel|nastav|zmen|odebr|zrus|schval|vytvor)/i;
const ACCESS_OVERVIEW_SIGNAL = /(mam|mas|mame|mohu|muz|vidim|dostup|over|zkontrol|k jakym|jaky mam)/i;
const PROJECTFLOW_SIGNAL = /project\s*flow|projectflow/i;

export function isDirectorCopilotRiskQuery(message: string): boolean {
  return classifyDirectorCopilotIntent(message) === "portfolio_risk_correlation";
}

export function classifyDirectorCopilotIntent(
  message: string,
  context: Record<string, unknown> = {},
): DirectorCopilotIntent | null {
  const normalized = normalizeForIntent(message);
  const hasBudget = BUDGET_SIGNAL.test(normalized);
  const hasDelivery = DELIVERY_SIGNAL.test(normalized);
  const hasContract = CONTRACT_SIGNAL.test(normalized);
  if (hasBudget && hasDelivery && hasContract) {
    return "portfolio_risk_correlation";
  }

  const explicitProjectFlow = PROJECTFLOW_SIGNAL.test(normalized);
  const projectDataQuestion = hasDelivery && PROJECT_LIVE_SIGNAL.test(normalized);
  const documentQuestion = DOCUMENT_SIGNAL.test(normalized);
  const accessQuestion = ACCESS_SIGNAL.test(normalized);
  const accessMutation = accessQuestion && ACCESS_MUTATION_SIGNAL.test(normalized);
  const accessOverview = accessQuestion && ACCESS_OVERVIEW_SIGNAL.test(normalized);
  const projectFlowContext = context.answer_source === "director_copilot_projectflow"
    || nestedPlanIntent(context) === "project_portfolio_status";

  if (projectDataQuestion && (!documentQuestion || explicitProjectFlow)) {
    return "project_portfolio_status";
  }
  if (explicitProjectFlow && accessOverview && !accessMutation) {
    return "project_access_overview";
  }
  if (projectFlowContext && PROJECT_LIVE_SIGNAL.test(normalized) && !documentQuestion) {
    return "project_portfolio_status";
  }
  return null;
}

export function buildDirectorQueryPlan(input: {
  message: string;
  language: ResponseLanguage;
  context: ApiRequestContext;
  intent?: DirectorCopilotIntent;
  now?: Date;
  timeoutMs?: number;
}): DirectorQueryPlan {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const intent = input.intent ?? "portfolio_risk_correlation";
  const projectionHash = accessProjectionHash(input.context);
  const budget = domainAccessFor(input.context, "budget", now.getTime());
  const projectflow = domainAccessFor(input.context, "projectflow", now.getTime());
  const timeoutMs = Math.max(500, Math.min(input.timeoutMs ?? 8_000, 30_000));
  const planId = stableId("plan", {
    version: DIRECTOR_COPILOT_QUERY_PLAN_VERSION,
    intent,
    message: input.message.replace(/\s+/g, " ").trim().toLowerCase(),
    language: input.language,
    as_of: createdAt,
    projection_hash: projectionHash,
  });
  return {
    schema_version: DIRECTOR_COPILOT_QUERY_PLAN_VERSION,
    plan_id: planId,
    intent,
    language: input.language,
    created_at: createdAt,
    as_of: createdAt,
    projection_hash: projectionHash,
    nodes: [
      ...(intent === "portfolio_risk_correlation" ? [{
        node_id: "node_budget",
        tool_id: DOMAIN_TOOL_IDS.budget,
        source_application: "budget" as const,
        required_capability: "budget:read" as const,
        requested_scopes: budget.authorized ? budget.scopes : [],
        depends_on: [],
        timeout_ms: timeoutMs,
      }] : []),
      {
        node_id: "node_projectflow",
        tool_id: DOMAIN_TOOL_IDS.projectflow,
        source_application: "projectflow",
        required_capability: "projectflow:read" as const,
        requested_scopes: projectflow.authorized ? projectflow.scopes : [],
        depends_on: [],
        timeout_ms: timeoutMs,
      },
      ...(intent === "portfolio_risk_correlation" ? [{
        node_id: "node_akb_contracts",
        tool_id: "akb.contract_risk_retrieval.v1" as const,
        source_application: "akb" as const,
        required_capability: "akb:chat" as const,
        requested_scopes: (input.context.scopes ?? []).flatMap((scope) => {
          const parsed = parseScopeString(scope);
          return parsed ? [parsed] : [];
        }),
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

function nestedPlanIntent(context: Record<string, unknown>): DirectorCopilotIntent | null {
  const snapshot = context.director_copilot_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const plan = (snapshot as Record<string, unknown>).plan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  const intent = (plan as Record<string, unknown>).intent;
  return intent === "portfolio_risk_correlation"
    || intent === "project_portfolio_status"
    || intent === "project_access_overview"
    ? intent
    : null;
}
