import type { ApiRequestContext, ResponseLanguage } from "@/lib/types";

import { accessProjectionHash, domainAccessFor } from "./access";
import {
  DIRECTOR_COPILOT_QUERY_PLAN_VERSION,
  DOMAIN_TOOL_IDS,
  parseScopeString,
  stableId,
  type DirectorQueryPlan,
} from "./contracts";

const BUDGET_SIGNAL = /(rozpo[cč]t|budget|finan|odchyl|forecast|pl[aá]n|skute[cč]nost)/i;
const DELIVERY_SIGNAL = /(projekt|project|miln[ií]k|milestone|zpo[zž]d|delay|term[ií]n)/i;
const CONTRACT_SIGNAL = /(smlouv|contract|dodavatel|supplier|rizik|risk)/i;

export function isDirectorCopilotRiskQuery(message: string): boolean {
  return BUDGET_SIGNAL.test(message) && DELIVERY_SIGNAL.test(message) && CONTRACT_SIGNAL.test(message);
}

export function buildDirectorQueryPlan(input: {
  message: string;
  language: ResponseLanguage;
  context: ApiRequestContext;
  now?: Date;
  timeoutMs?: number;
}): DirectorQueryPlan {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const projectionHash = accessProjectionHash(input.context);
  const budget = domainAccessFor(input.context, "budget", now.getTime());
  const projectflow = domainAccessFor(input.context, "projectflow", now.getTime());
  const timeoutMs = Math.max(500, Math.min(input.timeoutMs ?? 8_000, 30_000));
  const planId = stableId("plan", {
    version: DIRECTOR_COPILOT_QUERY_PLAN_VERSION,
    message: input.message.replace(/\s+/g, " ").trim().toLowerCase(),
    language: input.language,
    as_of: createdAt,
    projection_hash: projectionHash,
  });
  return {
    schema_version: DIRECTOR_COPILOT_QUERY_PLAN_VERSION,
    plan_id: planId,
    intent: "portfolio_risk_correlation",
    language: input.language,
    created_at: createdAt,
    as_of: createdAt,
    projection_hash: projectionHash,
    nodes: [
      {
        node_id: "node_budget",
        tool_id: DOMAIN_TOOL_IDS.budget,
        source_application: "budget",
        required_capability: "budget:read",
        requested_scopes: budget.authorized ? budget.scopes : [],
        depends_on: [],
        timeout_ms: timeoutMs,
      },
      {
        node_id: "node_projectflow",
        tool_id: DOMAIN_TOOL_IDS.projectflow,
        source_application: "projectflow",
        required_capability: "projectflow:read",
        requested_scopes: projectflow.authorized ? projectflow.scopes : [],
        depends_on: [],
        timeout_ms: timeoutMs,
      },
      {
        node_id: "node_akb_contracts",
        tool_id: "akb.contract_risk_retrieval.v1",
        source_application: "akb",
        required_capability: "akb:chat",
        requested_scopes: (input.context.scopes ?? []).flatMap((scope) => {
          const parsed = parseScopeString(scope);
          return parsed ? [parsed] : [];
        }),
        depends_on: ["node_budget", "node_projectflow"],
        timeout_ms: timeoutMs,
      },
    ],
    output: {
      kind: "answer",
      four_layer_answer: true,
      artifact_contract_version: "report.v2",
    },
    quality_gates: {
      structured_facts_required: true,
      document_citations_required: true,
      partial_must_be_visible: true,
      no_scope_expansion: true,
    },
  };
}

export function toolCallId(planId: string, nodeId: string): string {
  return stableId("call", { plan_id: planId, node_id: nodeId });
}
