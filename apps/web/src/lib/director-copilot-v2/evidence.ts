import type { ConversationQueryState } from "@/lib/director-copilot/query-state";

import type {
  ActiveDirectorCopilotV2Application,
  DirectorCopilotV2Fact,
  DirectorCopilotV2Item,
} from "./contracts";
import type { DirectorCopilotV2ManifestCatalog } from "./manifest-catalog";
import type {
  DirectorCopilotV2Plan,
} from "./planner";
import type { DirectorCopilotV2SourceOutcome } from "./orchestrator";

export type DirectorCopilotV2EvidenceStatus = "passed" | "partial" | "failed";

export interface DirectorCopilotV2EvidenceIssue {
  code: string;
  severity: "warning" | "error";
  application: ActiveDirectorCopilotV2Application | null;
  canonical_id: string | null;
  fact_key: string | null;
}

export interface DirectorCopilotV2EvidenceGate {
  status: DirectorCopilotV2EvidenceStatus;
  checked_claim_count: number;
  supported_claim_count: number;
  source_versions: Array<{
    application: ActiveDirectorCopilotV2Application;
    source_version: string;
  }>;
  issues: DirectorCopilotV2EvidenceIssue[];
}

const MAX_EVIDENCE_ISSUES = 64;

export function evaluateDirectorCopilotV2Evidence(input: {
  plan: DirectorCopilotV2Plan;
  outcomes: DirectorCopilotV2SourceOutcome[];
  catalog: DirectorCopilotV2ManifestCatalog;
}): DirectorCopilotV2EvidenceGate {
  const issues: DirectorCopilotV2EvidenceIssue[] = [];
  let checkedClaims = 0;
  let supportedClaims = 0;

  for (const outcome of input.outcomes) {
    if (outcome.status === "no_data" || outcome.status === "not_authorized" || outcome.status === "unavailable") {
      continue;
    }
    const manifest = input.catalog.byTool.get(outcome.tool_id);
    const node = input.plan.nodes.find((candidate) => candidate.application === outcome.application);
    if (!manifest || !node?.request) {
      addIssue(issues, "LIVE_DATA_EVIDENCE_MANIFEST_MISSING", "error", outcome.application);
      continue;
    }

    checkedClaims += 1;
    if (outcome.source_version && outcome.as_of && outcome.generated_at) {
      supportedClaims += 1;
    } else {
      addIssue(issues, "LIVE_DATA_EVIDENCE_SOURCE_METADATA_MISSING", "error", outcome.application);
    }

    checkedClaims += 1;
    if (outcome.candidate_count >= outcome.items.length) {
      supportedClaims += 1;
    } else {
      addIssue(issues, "LIVE_DATA_EVIDENCE_CANDIDATE_COUNT_INVALID", "error", outcome.application);
    }

    for (const item of outcome.items) {
      checkedClaims += 1;
      if (validItemEvidence(item, outcome.source_version)) {
        supportedClaims += 1;
      } else {
        addIssue(
          issues,
          "LIVE_DATA_EVIDENCE_ITEM_METADATA_INVALID",
          "error",
          outcome.application,
          item.canonical_id,
        );
      }
      for (const fact of item.facts) {
        checkedClaims += 1;
        if (manifest.metrics.some((metric) => metric.key === fact.key) && validFactEvidence(fact)) {
          supportedClaims += 1;
        } else {
          addIssue(
            issues,
            manifest.metrics.some((metric) => metric.key === fact.key)
              ? "LIVE_DATA_EVIDENCE_FACT_INVALID"
              : "LIVE_DATA_EVIDENCE_UNKNOWN_FACT",
            "error",
            outcome.application,
            item.canonical_id,
            fact.key,
          );
        }
      }
      for (const link of item.links) {
        checkedClaims += 1;
        const relationship = manifest.relationships.find((candidate) => (
          candidate.key === link.key
          && candidate.source_entity_type === item.entity_type
          && candidate.target_entity_type === link.target_entity_type
          && candidate.derivation === link.relation_type
          && candidate.location.kind === "link"
          && candidate.location.key === link.key
          && link.target_canonical_id.startsWith(candidate.target_canonical_id_prefix)
        ));
        if (relationship) {
          supportedClaims += 1;
        } else {
          addIssue(
            issues,
            "LIVE_DATA_EVIDENCE_RELATIONSHIP_INVALID",
            "error",
            outcome.application,
            item.canonical_id,
            link.key,
          );
        }
      }
    }

    const expectedEntityType = entityTypeForGranularity(
      outcome.application,
      node.request.parameters.granularity,
      node.request.parameters.group_by,
    );
    if (expectedEntityType && outcome.items.some((item) => item.entity_type !== expectedEntityType)) {
      addIssue(issues, "LIVE_DATA_ENTITY_TYPE_MISMATCH", "error", outcome.application);
    }

    verifyOperationEvidence({
      state: input.plan.query_state,
      outcome,
      supportsSortMetric: input.plan.query_state.sort
        ? manifest.metrics.some((metric) => metric.key === input.plan.query_state.sort?.metric)
        : false,
      issues,
      addChecked: () => { checkedClaims += 1; },
      addSupported: () => { supportedClaims += 1; },
    });
  }

  const hasError = issues.some((issue) => issue.severity === "error");
  const hasWarning = issues.some((issue) => issue.severity === "warning")
    || input.outcomes.some((outcome) => outcome.status === "partial");
  return {
    status: hasError ? "failed" : hasWarning ? "partial" : "passed",
    checked_claim_count: checkedClaims,
    supported_claim_count: supportedClaims,
    source_versions: input.outcomes.flatMap((outcome) => (
      outcome.source_version
        ? [{ application: outcome.application, source_version: outcome.source_version }]
        : []
    )),
    issues: issues.slice(0, MAX_EVIDENCE_ISSUES),
  };
}

function verifyOperationEvidence(input: {
  state: ConversationQueryState;
  outcome: DirectorCopilotV2SourceOutcome;
  supportsSortMetric: boolean;
  issues: DirectorCopilotV2EvidenceIssue[];
  addChecked: () => void;
  addSupported: () => void;
}): void {
  if (input.state.operation === "count") {
    input.addChecked();
    if (
      input.outcome.authorized_result_complete
      && input.outcome.status === "complete"
      && input.outcome.items.length === input.outcome.candidate_count
    ) {
      input.addSupported();
    } else {
      addIssue(
        input.issues,
        "LIVE_DATA_EVIDENCE_COUNT_INCOMPLETE",
        "error",
        input.outcome.application,
      );
    }
    return;
  }
  if (input.state.operation !== "rank") {
    if (!input.outcome.authorized_result_complete) {
      addIssue(
        input.issues,
        "LIVE_DATA_EVIDENCE_RESULT_PARTIAL",
        "warning",
        input.outcome.application,
      );
    }
    return;
  }
  if (!input.supportsSortMetric) return;

  input.addChecked();
  if (
    !input.outcome.authorized_result_complete
    || input.outcome.status !== "complete"
    || input.outcome.candidate_count > input.outcome.items.length
  ) {
    addIssue(
      input.issues,
      "LIVE_DATA_EVIDENCE_RANK_INCOMPLETE",
      "error",
      input.outcome.application,
    );
    return;
  }
  const metric = input.state.sort?.metric;
  const facts = metric
    ? input.outcome.items.map((item) => item.facts.find(
      (fact) => fact.key === operationFactKey(item, metric),
    ))
    : [];
  if (!metric || facts.some((fact) => typeof fact?.value !== "number")) {
    addIssue(
      input.issues,
      "LIVE_DATA_EVIDENCE_RANK_METRIC_MISSING",
      "error",
      input.outcome.application,
      null,
      metric ?? null,
    );
    return;
  }
  if (!comparableCurrencies(facts.filter((fact): fact is DirectorCopilotV2Fact => Boolean(fact)))) {
    addIssue(
      input.issues,
      "LIVE_DATA_EVIDENCE_RANK_CURRENCY_CONFLICT",
      "error",
      input.outcome.application,
      null,
      metric,
    );
    return;
  }
  input.addSupported();
}

function validItemEvidence(item: DirectorCopilotV2Item, sourceVersion: string | null): boolean {
  if (!item.canonical_id || !item.source_version || item.source_version !== sourceVersion) return false;
  if (!item.as_of || Number.isNaN(Date.parse(item.as_of))) return false;
  if (!item.period?.start || !item.period?.end || item.period.start > item.period.end) return false;
  if (!item.methodology?.name || !item.methodology?.version) return false;
  if (!item.policy?.binding_id || !item.policy?.version) return false;
  try {
    const url = new URL(item.deep_link);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validFactEvidence(fact: DirectorCopilotV2Fact): boolean {
  return Number.isFinite(fact.quality)
    && fact.quality >= 0
    && fact.quality <= 1
    && Boolean(fact.period_start)
    && Boolean(fact.period_end)
    && fact.period_start <= fact.period_end;
}

function comparableCurrencies(facts: DirectorCopilotV2Fact[]): boolean {
  const currencies = new Set(
    facts
      .filter((fact) => fact.value_type === "currency")
      .map((fact) => fact.currency ?? ""),
  );
  return currencies.size <= 1;
}

function entityTypeForGranularity(
  application: ActiveDirectorCopilotV2Application,
  granularity: string,
  groupBy: string[],
): string | null {
  if (granularity === "project") return "project";
  if (granularity === "portfolio") return "portfolio";
  if (granularity !== "item") return null;
  if (application === "budget") {
    return groupBy.includes("procurement_action") ? "procurement_action" : "budget_item";
  }
  if (application === "projectflow") return "project";
  return "need";
}

function operationFactKey(item: DirectorCopilotV2Item, metric: string): string {
  if (item.entity_type === "procurement_action" && metric === "budget.plan_amount") {
    return "procurement_action.planned_amount";
  }
  return metric;
}

function addIssue(
  issues: DirectorCopilotV2EvidenceIssue[],
  code: string,
  severity: DirectorCopilotV2EvidenceIssue["severity"],
  application: ActiveDirectorCopilotV2Application | null,
  canonicalId: string | null = null,
  factKey: string | null = null,
): void {
  if (issues.length >= MAX_EVIDENCE_ISSUES) return;
  issues.push({
    code,
    severity,
    application,
    canonical_id: canonicalId,
    fact_key: factKey,
  });
}
