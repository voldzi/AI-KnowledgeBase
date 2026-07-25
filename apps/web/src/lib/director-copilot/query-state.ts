import {
  STRATOS_SEMANTIC_CATALOG_VERSION,
  normalizeSemanticText,
  pendingSemanticSources,
  semanticMetricsForText,
  semanticSourcesForText,
  sourceForMetric,
  type StratosSemanticMetric,
  type StratosSemanticSource,
} from "./semantic-catalog";
import { semanticRegistrySourcesForText } from "./semantic-registry";

export const CONVERSATION_QUERY_STATE_VERSION = "stratos-conversation-query-state-1" as const;

export type QueryGranularity =
  | "authorized_scope"
  | "organization"
  | "organization_unit"
  | "portfolio"
  | "project";

export interface ConversationQueryState {
  schema_version: typeof CONVERSATION_QUERY_STATE_VERSION;
  catalog_version: typeof STRATOS_SEMANTIC_CATALOG_VERSION;
  sources: StratosSemanticSource[];
  metrics: StratosSemanticMetric[];
  period: {
    type: "current" | "fiscal_year";
    fiscal_year: number;
    as_of: string;
  };
  granularity: QueryGranularity;
  scope_label: string | null;
  entity_filters: {
    project_ids: string[];
    portfolio_ids: string[];
  };
  filters: {
    schedule_status: "delayed" | "at_risk" | "on_track" | null;
  };
  sort: {
    metric: StratosSemanticMetric;
    direction: "asc" | "desc";
  } | null;
  document_evidence_requested: boolean;
}

export interface ResolvedConversationQuery {
  state: ConversationQueryState;
  recognized: boolean;
  inherited: boolean;
  pending_sources: StratosSemanticSource[];
}

const DOCUMENT_SIGNAL = /\b(dokument|priloh|smernic|metodik|citac|soubor|pdf)/;
const LIVE_APPLICATION_SIGNAL = /\b(budget\w*|project\s*flow|projectflow|arch\s*flow|archflow|aiip|ai innovation portal)\b/;
const CONTRACT_SIGNAL = /\b(smlouv|contract|dodavatel|supplier|smluvni rizik)\b/;
const FOLLOW_UP_SIGNAL = /\b(a|ale|jen|pouze|celkove|dohromady|vsichni|vsechny|jejich|tento|tahle|tyto|oproti|rozdil|vyvoj|trend|letos|loni|rok|kvartal|mesic|stejne|jinak)\b/;
const OVERALL_SIGNAL = /\b(celkove|dohromady|za celou organizaci|cela organizace|vsechny projekty|vsechny polozky|ne jen)\b/;
const ORGANIZATION_UNIT_SIGNAL = /\b(utvar\w*|odbor\w*|oddeleni|sekce|organizacni jednotk\w*|it|ict|informatik\w*)\b/;
const PORTFOLIO_SIGNAL = /\bportfolio\b/;
const DELAYED_SIGNAL = /\b(zpozden|zpozdeni|v prodleni|po terminu)\b/;
const AT_RISK_SIGNAL = /\b(ohrozen|rizikov[ey]|at risk)\b/;
const ON_TRACK_SIGNAL = /\b(podle planu|v terminu|on track)\b/;
const DESC_SIGNAL = /\b(nejvyssi|nejvetsi|nejvice|top|nejhorsi)\b/;
const ASC_SIGNAL = /\b(nejnizsi|nejmensi|nejmene|nejlepsi)\b/;

const SOURCE_VALUES = new Set<StratosSemanticSource>([
  "budget",
  "projectflow",
  "archflow",
  "aiip",
]);
const METRIC_VALUES = new Set<StratosSemanticMetric>([
  "budget.plan_amount",
  "budget.actual_amount",
  "budget.forecast_amount",
  "budget.commitments_amount",
  "budget.variance_amount",
  "project.status",
  "project.schedule_status",
  "milestone.max_delay_days",
  "milestone.next_due_date",
  "archflow.need.status",
  "archflow.need.readiness_score",
  "archflow.need.impact_score",
  "archflow.need.decision",
  "archflow.need.budget_handoff_status",
  "aiip.idea.status",
  "aiip.idea.value_score",
  "aiip.idea.risk_score",
  "aiip.idea.expected_benefit",
  "aiip.idea.handoff_status",
]);
const GRANULARITY_VALUES = new Set<QueryGranularity>([
  "authorized_scope",
  "organization",
  "organization_unit",
  "portfolio",
  "project",
]);
const LEGACY_CATALOG_VERSIONS = new Set([
  "stratos-semantic-catalog-1",
  STRATOS_SEMANTIC_CATALOG_VERSION,
]);

export function resolveConversationQuery(input: {
  message: string;
  context?: Record<string, unknown>;
  now?: Date;
}): ResolvedConversationQuery {
  const now = input.now ?? new Date();
  const normalized = normalizeSemanticText(input.message);
  const previous = conversationQueryState(input.context?.stratos_query_state, now)
    ?? legacyConversationQueryState(input.context ?? {}, now);
  const explicitMetrics = semanticMetricsForText(normalized);
  const metricSources = unique(explicitMetrics.map(sourceForMetric));
  const detectedSemanticSources = semanticSourcesForText(normalized);
  const registrySources = semanticRegistrySourcesForText(normalized);
  const projectFlowIsOnlyEntityMention = detectedSemanticSources.includes("projectflow")
    && !registrySources.includes("projectflow")
    && !metricSources.includes("projectflow")
    && !/\b(project\s*flow|projectflow|portfolio|milnik|harmonogram|zpozd|termin|ukol|realiz|status|otevri|otevrit|detail|konkretni|stav projekt|prehled projekt|seznam projekt|evid.*projekt)/.test(normalized);
  const detectedSources = sourceOwnedHandoffSources(unique([
    ...detectedSemanticSources.filter((source) => (
      source !== "projectflow" || !projectFlowIsOnlyEntityMention
    )),
    ...metricSources,
  ]), explicitMetrics);
  const scopeOnlyFollowUp = previous !== null
    && OVERALL_SIGNAL.test(normalized)
    && explicitMetrics.length === 0
    && !LIVE_APPLICATION_SIGNAL.test(normalized);
  const explicitSources = scopeOnlyFollowUp ? [] : detectedSources;
  const documentQuestion = DOCUMENT_SIGNAL.test(normalized);
  const followUp = FOLLOW_UP_SIGNAL.test(normalized)
    || explicitPeriodYear(normalized, now) !== null
    || OVERALL_SIGNAL.test(normalized);
  const mayInherit = previous !== null
    && followUp
    && !(documentQuestion && explicitSources.length === 0);
  const inherited = explicitSources.length === 0 && mayInherit;
  const sources = explicitSources.length
    ? explicitSources
    : inherited
      ? previous.sources
      : [];
  const metrics = explicitMetrics.length
    ? explicitMetrics
    : inherited
      ? previous.metrics
      : [];
  const period = resolvePeriod(normalized, previous?.period ?? null, now);
  const granularity = resolveGranularity(normalized, previous?.granularity ?? "authorized_scope");
  const scopeLabel = resolveScopeLabel(normalized, granularity, previous?.scope_label ?? null);
  const entityFilters = OVERALL_SIGNAL.test(normalized)
    ? { project_ids: [], portfolio_ids: [] }
    : previous?.entity_filters ?? { project_ids: [], portfolio_ids: [] };
  const scheduleStatus = DELAYED_SIGNAL.test(normalized)
    ? "delayed" as const
    : AT_RISK_SIGNAL.test(normalized)
      ? "at_risk" as const
      : ON_TRACK_SIGNAL.test(normalized)
        ? "on_track" as const
        : inherited
          ? previous.filters.schedule_status
          : null;
  const sortMetric = sortMetricForQuery(metrics, normalized)
    ?? (inherited ? previous.sort?.metric ?? null : null);
  const sortDirection = DESC_SIGNAL.test(normalized)
    ? "desc" as const
    : ASC_SIGNAL.test(normalized)
      ? "asc" as const
      : inherited
        ? previous.sort?.direction ?? "desc"
        : "desc";
  const state: ConversationQueryState = {
    schema_version: CONVERSATION_QUERY_STATE_VERSION,
    catalog_version: STRATOS_SEMANTIC_CATALOG_VERSION,
    sources,
    metrics,
    period,
    granularity,
    scope_label: scopeLabel,
    entity_filters: entityFilters,
    filters: { schedule_status: scheduleStatus },
    sort: sortMetric ? { metric: sortMetric, direction: sortDirection } : null,
    document_evidence_requested: CONTRACT_SIGNAL.test(normalized)
      || (inherited && previous.document_evidence_requested),
  };
  return {
    state,
    recognized: sources.length > 0 && (!documentQuestion || LIVE_APPLICATION_SIGNAL.test(normalized)),
    inherited,
    pending_sources: pendingSemanticSources(sources),
  };
}

export function conversationQueryState(
  value: unknown,
  now = new Date(),
): ConversationQueryState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schema_version !== CONVERSATION_QUERY_STATE_VERSION
    || typeof record.catalog_version !== "string"
    || !LEGACY_CATALOG_VERSIONS.has(record.catalog_version)
  ) {
    return null;
  }
  const sources = boundedStringArray(record.sources, 4, 40)
    .filter((source): source is StratosSemanticSource => SOURCE_VALUES.has(source as StratosSemanticSource));
  const metrics = boundedStringArray(record.metrics, 20, 100)
    .filter((metric): metric is StratosSemanticMetric => METRIC_VALUES.has(metric as StratosSemanticMetric));
  const periodRecord = objectValue(record.period);
  const fiscalYear = integerValue(periodRecord?.fiscal_year);
  const periodType = periodRecord?.type === "fiscal_year" ? "fiscal_year" : "current";
  const validFiscalYear = fiscalYear !== null && fiscalYear >= 2000 && fiscalYear <= 2200
    ? fiscalYear
    : now.getUTCFullYear();
  const granularity = typeof record.granularity === "string"
    && GRANULARITY_VALUES.has(record.granularity as QueryGranularity)
    ? record.granularity as QueryGranularity
    : "authorized_scope";
  const entityFilters = objectValue(record.entity_filters);
  const filters = objectValue(record.filters);
  const sort = objectValue(record.sort);
  const sortMetric = typeof sort?.metric === "string"
    && METRIC_VALUES.has(sort.metric as StratosSemanticMetric)
    ? sort.metric as StratosSemanticMetric
    : null;
  const sortDirection = sort?.direction === "asc" ? "asc" : "desc";
  return {
    schema_version: CONVERSATION_QUERY_STATE_VERSION,
    catalog_version: STRATOS_SEMANTIC_CATALOG_VERSION,
    sources: unique(sources),
    metrics: unique(metrics),
    period: {
      type: periodType,
      fiscal_year: periodType === "current" ? now.getUTCFullYear() : validFiscalYear,
      as_of: periodType === "current"
        ? now.toISOString()
        : asOfForFiscalYear(validFiscalYear, now),
    },
    granularity,
    scope_label: boundedNullableString(record.scope_label, 120),
    entity_filters: {
      project_ids: boundedIds(entityFilters?.project_ids),
      portfolio_ids: boundedIds(entityFilters?.portfolio_ids),
    },
    filters: {
      schedule_status:
        filters?.schedule_status === "delayed"
        || filters?.schedule_status === "at_risk"
        || filters?.schedule_status === "on_track"
          ? filters.schedule_status
          : null,
    },
    sort: sortMetric ? { metric: sortMetric, direction: sortDirection } : null,
    document_evidence_requested: record.document_evidence_requested === true,
  };
}

function sourceOwnedHandoffSources(
  sources: StratosSemanticSource[],
  metrics: StratosSemanticMetric[],
): StratosSemanticSource[] {
  const metricSet = new Set(metrics);
  const hasBudgetMetric = metrics.some((metric) => metric.startsWith("budget."));
  const hasArchFlowMetric = metrics.some((metric) => metric.startsWith("archflow."));
  return sources.filter((source) => {
    if (
      source === "budget"
      && metricSet.has("archflow.need.budget_handoff_status")
      && !hasBudgetMetric
    ) {
      return false;
    }
    if (
      source === "archflow"
      && metricSet.has("aiip.idea.handoff_status")
      && !hasArchFlowMetric
    ) {
      return false;
    }
    return true;
  });
}

function legacyConversationQueryState(
  context: Record<string, unknown>,
  now: Date,
): ConversationQueryState | null {
  const source = context.active_source_application === "budget"
    || context.answer_source === "director_copilot_budget"
      ? "budget"
      : context.active_source_application === "projectflow"
        || context.answer_source === "director_copilot_projectflow"
        ? "projectflow"
        : context.active_source_application === "archflow"
          || context.answer_source === "director_copilot_archflow"
          ? "archflow"
          : context.active_source_application === "aiip"
            || context.answer_source === "director_copilot_aiip"
            ? "aiip"
            : null;
  if (!source) return null;
  return {
    schema_version: CONVERSATION_QUERY_STATE_VERSION,
    catalog_version: STRATOS_SEMANTIC_CATALOG_VERSION,
    sources: [source],
    metrics: [],
    period: {
      type: "current",
      fiscal_year: now.getUTCFullYear(),
      as_of: now.toISOString(),
    },
    granularity: "authorized_scope",
    scope_label: null,
    entity_filters: { project_ids: [], portfolio_ids: [] },
    filters: { schedule_status: null },
    sort: null,
    document_evidence_requested: false,
  };
}

function resolvePeriod(
  normalized: string,
  previous: ConversationQueryState["period"] | null,
  now: Date,
): ConversationQueryState["period"] {
  const explicitYear = explicitPeriodYear(normalized, now);
  if (explicitYear !== null) {
    return {
      type: explicitYear === now.getUTCFullYear() ? "current" : "fiscal_year",
      fiscal_year: explicitYear,
      as_of: explicitYear === now.getUTCFullYear()
        ? now.toISOString()
        : asOfForFiscalYear(explicitYear, now),
    };
  }
  if (previous) {
    return previous.type === "current"
      ? {
          type: "current",
          fiscal_year: now.getUTCFullYear(),
          as_of: now.toISOString(),
        }
      : {
          ...previous,
          as_of: asOfForFiscalYear(previous.fiscal_year, now),
        };
  }
  return {
    type: "current",
    fiscal_year: now.getUTCFullYear(),
    as_of: now.toISOString(),
  };
}

function explicitPeriodYear(normalized: string, now: Date): number | null {
  const yearMatch = normalized.match(/\b(20\d{2}|21\d{2}|2200)\b/);
  if (yearMatch) return Number(yearMatch[1]);
  if (/\b(letos|tento rok|aktualni rok)\b/.test(normalized)) return now.getUTCFullYear();
  if (/\b(loni|minuly rok|predchozi rok)\b/.test(normalized)) return now.getUTCFullYear() - 1;
  if (/\b(pristi rok|budouci rok|nasledujici rok)\b/.test(normalized)) return now.getUTCFullYear() + 1;
  return null;
}

function resolveGranularity(
  normalized: string,
  previous: QueryGranularity,
): QueryGranularity {
  if (OVERALL_SIGNAL.test(normalized)) return "organization";
  if (ORGANIZATION_UNIT_SIGNAL.test(normalized)) return "organization_unit";
  if (PORTFOLIO_SIGNAL.test(normalized)) return "portfolio";
  return previous;
}

function resolveScopeLabel(
  normalized: string,
  granularity: QueryGranularity,
  previous: string | null,
): string | null {
  if (granularity === "organization") return null;
  if (granularity !== "organization_unit") return previous;
  if (/\b(odbor informatiky|informatika|it|ict)\b/.test(normalized)) return "IT";
  const match = normalized.match(/\b(?:utvar\w*|odbor\w*|oddeleni|sekce)\s+([a-z0-9._/-]{2,80})\b/);
  return match?.[1] ?? previous;
}

function sortMetricForQuery(
  metrics: StratosSemanticMetric[],
  normalized: string,
): StratosSemanticMetric | null {
  if (!DESC_SIGNAL.test(normalized) && !ASC_SIGNAL.test(normalized)) return null;
  return metrics.find((metric) => (
    metric === "budget.variance_amount"
    || metric === "milestone.max_delay_days"
    || metric === "archflow.need.impact_score"
    || metric === "aiip.idea.value_score"
    || metric === "aiip.idea.risk_score"
  )) ?? metrics[0] ?? null;
}

function asOfForFiscalYear(year: number, now: Date): string {
  if (year === now.getUTCFullYear()) return now.toISOString();
  return new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)).toISOString();
}

function boundedIds(value: unknown): string[] {
  return unique(
    boundedStringArray(value, 100, 180)
      .filter((item) => /^[A-Za-z0-9._:/-]+$/.test(item)),
  );
}

function boundedStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= maxLength);
}

function boundedNullableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
