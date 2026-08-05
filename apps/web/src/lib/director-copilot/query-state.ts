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
import { matchesSemanticConcept } from "./semantic-matcher";

export const CONVERSATION_QUERY_STATE_VERSION = "stratos-conversation-query-state-4" as const;
const LEGACY_QUERY_STATE_VERSIONS = new Set([
  "stratos-conversation-query-state-1",
  "stratos-conversation-query-state-2",
  "stratos-conversation-query-state-3",
]);

export type QueryGranularity =
  | "authorized_scope"
  | "organization"
  | "organization_unit"
  | "portfolio"
  | "project"
  | "item";

export type QueryOperation = "summary" | "list" | "count" | "rank";

export type QueryGrouping =
  | "organization"
  | "organization_unit"
  | "portfolio"
  | "project"
  | "item"
  | "schedule_status";

export interface QueryClarification {
  kind: "plan_meaning";
}

export interface ConversationQueryState {
  schema_version: typeof CONVERSATION_QUERY_STATE_VERSION;
  catalog_version: typeof STRATOS_SEMANTIC_CATALOG_VERSION;
  sources: StratosSemanticSource[];
  metrics: StratosSemanticMetric[];
  period: {
    type: "current" | "fiscal_year";
    fiscal_year: number;
    as_of: string;
    interval: {
      start: string;
      end: string;
    } | null;
  };
  granularity: QueryGranularity;
  operation: QueryOperation;
  group_by: QueryGrouping[];
  scope_label: string | null;
  entity_filters: {
    project_ids: string[];
    portfolio_ids: string[];
    organization_unit_ids: string[];
    budget_scope_ids: string[];
    need_ids: string[];
    idea_ids: string[];
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
  clarification: QueryClarification | null;
}

const DOCUMENT_SIGNAL = /\b(dokument|priloh|smernic|metodik|citac|soubor|pdf)/;
const LIVE_APPLICATION_SIGNAL = /\b(budget\w*|project\s*flow|projectflow|arch\s*flow|archflow)\b/;
const CONTRACT_SIGNAL = /\b(smlouv|contract|dodavatel|supplier|smluvni rizik)\b/;
const FOLLOW_UP_SIGNAL = /\b(a|ale|jen|pouze|celkove|dohromady|vsichni|vsechny|jejich|tento|tahle|tyto|oproti|rozdil|vyvoj|trend|letos|loni|rok|kvartal|mesic|stejne|jinak)\b/;
const OVERALL_SIGNAL = /\b(celkove|dohromady|za celou organizaci|cela organizace|vsechny projekty|vsechny polozky|ne jen)\b/;
const ORGANIZATION_UNIT_SIGNAL = /\b(utvar\w*|odbor\w*|oddeleni|sekce|organizac\w*\s+jednot\w*|it|ict|informatik\w*)\b/;
const PORTFOLIO_SIGNAL = /\bportfoli\w*/;
const PROJECT_GRANULARITY_SIGNAL = /\bprojekt\w*/;
const ITEM_GRANULARITY_SIGNAL = /\b(poloz\w*|budget item\w*|akc\w*|nakup\w*|porizen\w*|zakaz\w*|radk\w*|potreb\w*|pozadav\w*|podnet\w*)\b/;
const DELAYED_SIGNAL = /\b(zpozden\w*|v prodleni|po terminu)\b/;
const AT_RISK_SIGNAL = /\b(ohrozen|rizikov[ey]|at risk)\b/;
const ON_TRACK_SIGNAL = /\b(podle planu|v terminu|on track)\b/;
const DESC_SIGNAL = /\b(nejvyssi|nejvetsi|nejvice|top|nejhorsi)\b/;
const ASC_SIGNAL = /\b(nejnizsi|nejmensi|nejmene|nejlepsi)\b/;
const COUNT_SIGNAL = /\b(kolik|pocet|how many|number of)\b/;
const LIST_SIGNAL = /\b(ktere|jake|vypis\w*|seznam\w*|ukaz\w*|eviduj\w*|what are|which)\b/;
const GROUP_BY_SIGNAL = /\b(podle|po|za|seskup\w*|rozdel\w*|clen\w*)\b/;
const PLAN_SIGNAL = /\bplan\w*\b/;
const FINANCIAL_PLAN_SIGNAL = /\b(rozpoct\w*|financ\w*|castk\w*|korun\w*|k[cč]|naklad\w*|vydaj\w*|budget\w*|poloz\w*|akci|akce|nakup\w*|porizen\w*)\b/;
const DELIVERY_PLAN_SIGNAL = /\b(harmonogram\w*|termin\w*|milnik\w*|zpozden\w*|skluz\w*|realiz\w*|project\s*flow|projectflow)\b/;
const FOLLOW_UP_TERMS = [
  "a co", "a jak", "a ktery", "ale", "jen", "pouze", "celkove",
  "dohromady", "oproti", "rozdil", "vyvoj", "trend", "stejne", "jinak",
] as const;
const OVERALL_TERMS = [
  "celkove", "dohromady", "cela organizace", "vsechny projekty",
  "vsechny polozky", "souhrnne", "organizacni souhrn",
] as const;
const ORGANIZATION_UNIT_TERMS = [
  "organizacni jednotka", "utvar", "odbor", "oddeleni", "sekce",
  "informatika", "ict",
] as const;
const PORTFOLIO_TERMS = ["portfolio", "program projektu"] as const;
const PROJECT_TERMS = ["projekt", "projektova akce"] as const;
const ITEM_TERMS = [
  "polozka", "rozpoctova polozka", "nakladova polozka", "rozpoctova kapitola",
  "radek rozpoctu", "akce", "planovana akce", "nakup", "porizeni", "zakazka",
  "potreba", "business potreba", "pozadavek", "podnet",
] as const;
const DELAYED_TERMS = ["zpozdeni", "prodleni", "po terminu", "skluz"] as const;
const AT_RISK_TERMS = ["ohrozeny", "rizikovy", "at risk"] as const;
const ON_TRACK_TERMS = ["podle planu", "v terminu", "on track"] as const;
const DESC_TERMS = [
  "nejvyssi", "nejvetsi", "nejvice", "maximum", "top", "nejhorsi",
  "nejdrazsi", "nejnakladnejsi", "maximalni",
] as const;
const ASC_TERMS = [
  "nejnizsi", "nejmensi", "nejmene", "minimum", "nejlepsi", "nejlevnejsi",
] as const;

const SOURCE_VALUES = new Set<StratosSemanticSource>([
  "budget",
  "projectflow",
  "archflow",
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
]);
const GRANULARITY_VALUES = new Set<QueryGranularity>([
  "authorized_scope",
  "organization",
  "organization_unit",
  "portfolio",
  "project",
  "item",
]);
const OPERATION_VALUES = new Set<QueryOperation>([
  "summary",
  "list",
  "count",
  "rank",
]);
const GROUPING_VALUES = new Set<QueryGrouping>([
  "organization",
  "organization_unit",
  "portfolio",
  "project",
  "item",
  "schedule_status",
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
  const detectedMetrics = unique(
    semanticMetricsForText(normalized),
  );
  const explicitMetrics = hasAmbiguousPlanMeaning(normalized)
    && previous?.sources.length === 1
    && previous.sources[0] !== "budget"
    ? detectedMetrics.filter((metric) => metric !== "budget.plan_amount")
    : detectedMetrics;
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
  const overallSignal = OVERALL_SIGNAL.test(normalized)
    || matchesSemanticConcept(normalized, OVERALL_TERMS);
  const portfolioSignal = PORTFOLIO_SIGNAL.test(normalized)
    || matchesSemanticConcept(normalized, PORTFOLIO_TERMS);
  const scopeOnlyFollowUp = previous !== null
    && (overallSignal || portfolioSignal)
    && explicitMetrics.length === 0
    && !LIVE_APPLICATION_SIGNAL.test(normalized);
  const explicitSources = scopeOnlyFollowUp ? [] : detectedSources;
  const documentQuestion = DOCUMENT_SIGNAL.test(normalized);
  const followUp = FOLLOW_UP_SIGNAL.test(normalized)
    || matchesSemanticConcept(normalized, FOLLOW_UP_TERMS)
    || explicitPeriodYear(normalized, now) !== null
    || explicitDateInterval(normalized) !== null
    || overallSignal
    || portfolioSignal;
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
  const explicitGranularity = explicitGranularityForText(normalized);
  const granularity = explicitGranularity
    ?? previous?.granularity
    ?? "authorized_scope";
  const scopeLabel = resolveScopeLabel(normalized, granularity, previous?.scope_label ?? null);
  const entityFilters = explicitGranularity === "organization"
    || explicitGranularity === "organization_unit"
    || explicitGranularity === "portfolio"
    || explicitGranularity === "item"
    ? emptyEntityFilters()
    : previous?.entity_filters ?? emptyEntityFilters();
  const scheduleStatus = DELAYED_SIGNAL.test(normalized)
    || matchesSemanticConcept(normalized, DELAYED_TERMS)
    ? "delayed" as const
    : AT_RISK_SIGNAL.test(normalized)
      || matchesSemanticConcept(normalized, AT_RISK_TERMS)
      ? "at_risk" as const
      : ON_TRACK_SIGNAL.test(normalized)
        || matchesSemanticConcept(normalized, ON_TRACK_TERMS)
        ? "on_track" as const
        : inherited
          ? previous.filters.schedule_status
          : null;
  const explicitSortMetric = sortMetricForQuery(metrics, normalized);
  const sortMetric = explicitSortMetric
    ?? (inherited && explicitMetrics.length === 0 ? previous.sort?.metric ?? null : null);
  const sortDirection = DESC_SIGNAL.test(normalized)
    || matchesSemanticConcept(normalized, DESC_TERMS)
    ? "desc" as const
    : ASC_SIGNAL.test(normalized)
      || matchesSemanticConcept(normalized, ASC_TERMS)
      ? "asc" as const
      : inherited
        ? previous.sort?.direction ?? "desc"
        : "desc";
  const explicitOperation = explicitOperationForText(
    normalized,
    granularity,
    sortMetric,
  );
  const operation = explicitOperation
    ?? (
      inherited && explicitMetrics.length === 0 && explicitGranularity === null
        ? previous?.operation ?? "summary"
        : "summary"
    );
  const explicitGrouping = explicitGroupingForText(normalized);
  const groupBy = explicitGrouping.length
    ? explicitGrouping
    : inherited
      ? previous?.group_by ?? []
      : [];
  const state: ConversationQueryState = {
    schema_version: CONVERSATION_QUERY_STATE_VERSION,
    catalog_version: STRATOS_SEMANTIC_CATALOG_VERSION,
    sources,
    metrics,
    period,
    granularity,
    operation,
    group_by: groupBy,
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
    clarification: planMeaningClarification(normalized, previous),
  };
}

export function conversationQueryState(
  value: unknown,
  now = new Date(),
): ConversationQueryState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    (
      record.schema_version !== CONVERSATION_QUERY_STATE_VERSION
      && !LEGACY_QUERY_STATE_VERSIONS.has(String(record.schema_version))
    )
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
  const intervalRecord = objectValue(periodRecord?.interval);
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
  const operation = typeof record.operation === "string"
    && OPERATION_VALUES.has(record.operation as QueryOperation)
    ? record.operation as QueryOperation
    : sortMetric
      ? "rank"
      : "summary";
  const groupBy = boundedStringArray(record.group_by, 10, 40)
    .filter((group): group is QueryGrouping => GROUPING_VALUES.has(group as QueryGrouping));
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
      interval: validDateInterval(intervalRecord),
    },
    granularity,
    operation,
    group_by: unique(groupBy),
    scope_label: boundedNullableString(record.scope_label, 120),
    entity_filters: {
      project_ids: boundedIds(entityFilters?.project_ids),
      portfolio_ids: boundedIds(entityFilters?.portfolio_ids),
      organization_unit_ids: boundedIds(entityFilters?.organization_unit_ids),
      budget_scope_ids: boundedIds(entityFilters?.budget_scope_ids),
      need_ids: boundedIds(entityFilters?.need_ids),
      idea_ids: boundedIds(entityFilters?.idea_ids),
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
  return sources.filter((source) => {
    if (
      source === "budget"
      && metricSet.has("archflow.need.budget_handoff_status")
      && !hasBudgetMetric
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
      interval: null,
    },
    granularity: "authorized_scope",
    operation: "summary",
    group_by: [],
    scope_label: null,
    entity_filters: emptyEntityFilters(),
    filters: { schedule_status: null },
    sort: null,
    document_evidence_requested: false,
  };
}

function explicitGroupingForText(normalized: string): QueryGrouping[] {
  if (!GROUP_BY_SIGNAL.test(normalized)) return [];
  const groups: QueryGrouping[] = [];
  if (ORGANIZATION_UNIT_SIGNAL.test(normalized)) groups.push("organization_unit");
  if (PORTFOLIO_SIGNAL.test(normalized)) groups.push("portfolio");
  if (PROJECT_GRANULARITY_SIGNAL.test(normalized)) groups.push("project");
  if (ITEM_GRANULARITY_SIGNAL.test(normalized)) groups.push("item");
  if (/\b(stav\w*|harmonogram\w*)\b/.test(normalized)) groups.push("schedule_status");
  if (/\b(organizac\w*|organizace)\b/.test(normalized) && groups.length === 0) {
    groups.push("organization");
  }
  return unique(groups);
}

function planMeaningClarification(
  normalized: string,
  previous: ConversationQueryState | null,
): QueryClarification | null {
  if (!hasAmbiguousPlanMeaning(normalized)) return null;
  if (previous?.sources.length === 1) return null;
  return { kind: "plan_meaning" };
}

function hasAmbiguousPlanMeaning(normalized: string): boolean {
  return PLAN_SIGNAL.test(normalized)
    && !FINANCIAL_PLAN_SIGNAL.test(normalized)
    && !DELIVERY_PLAN_SIGNAL.test(normalized);
}

function resolvePeriod(
  normalized: string,
  previous: ConversationQueryState["period"] | null,
  now: Date,
): ConversationQueryState["period"] {
  const explicitInterval = explicitDateInterval(normalized);
  const explicitYear = explicitPeriodYear(normalized, now);
  if (explicitInterval) {
    return {
      type: "fiscal_year",
      fiscal_year: Number(explicitInterval.start.slice(0, 4)),
      as_of: `${explicitInterval.end}T23:59:59.999Z`,
      interval: explicitInterval,
    };
  }
  if (explicitYear !== null) {
    return {
      type: explicitYear === now.getUTCFullYear() ? "current" : "fiscal_year",
      fiscal_year: explicitYear,
      as_of: explicitYear === now.getUTCFullYear()
        ? now.toISOString()
        : asOfForFiscalYear(explicitYear, now),
      interval: null,
    };
  }
  if (previous) {
    return previous.type === "current"
      ? {
          type: "current",
          fiscal_year: now.getUTCFullYear(),
          as_of: now.toISOString(),
          interval: null,
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
    interval: null,
  };
}

function explicitDateInterval(normalized: string): { start: string; end: string } | null {
  const dates = [...normalized.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)]
    .map((match) => match[1]!);
  if (dates.length < 2 || dates[0]! > dates[1]!) return null;
  return { start: dates[0]!, end: dates[1]! };
}

function explicitPeriodYear(normalized: string, now: Date): number | null {
  const yearMatch = normalized.match(/\b(20\d{2}|21\d{2}|2200)\b/);
  if (yearMatch) return Number(yearMatch[1]);
  if (/\b(letos|tento rok|aktualni rok)\b/.test(normalized)) return now.getUTCFullYear();
  if (/\b(loni|minuly rok|predchozi rok)\b/.test(normalized)) return now.getUTCFullYear() - 1;
  if (/\b(pristi rok|budouci rok|nasledujici rok)\b/.test(normalized)) return now.getUTCFullYear() + 1;
  return null;
}

function explicitGranularityForText(
  normalized: string,
): QueryGranularity | null {
  if (
    ITEM_GRANULARITY_SIGNAL.test(normalized)
    || matchesSemanticConcept(normalized, ITEM_TERMS)
  ) return "item";
  if (
    OVERALL_SIGNAL.test(normalized)
    || matchesSemanticConcept(normalized, OVERALL_TERMS)
  ) return "organization";
  if (
    ORGANIZATION_UNIT_SIGNAL.test(normalized)
    || matchesSemanticConcept(normalized, ORGANIZATION_UNIT_TERMS)
  ) return "organization_unit";
  if (
    PORTFOLIO_SIGNAL.test(normalized)
    || matchesSemanticConcept(normalized, PORTFOLIO_TERMS)
  ) return "portfolio";
  if (
    PROJECT_GRANULARITY_SIGNAL.test(normalized)
    || matchesSemanticConcept(normalized, PROJECT_TERMS)
  ) return "project";
  return null;
}

function explicitOperationForText(
  normalized: string,
  granularity: QueryGranularity,
  sortMetric: StratosSemanticMetric | null,
): QueryOperation | null {
  if (sortMetric !== null) return "rank";
  const countableGranularity = granularity === "item"
    || granularity === "project"
    || granularity === "portfolio";
  if (countableGranularity && COUNT_SIGNAL.test(normalized)) return "count";
  if (countableGranularity && LIST_SIGNAL.test(normalized)) return "list";
  return null;
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
  if (
    !DESC_SIGNAL.test(normalized)
    && !ASC_SIGNAL.test(normalized)
    && !matchesSemanticConcept(normalized, DESC_TERMS)
    && !matchesSemanticConcept(normalized, ASC_TERMS)
  ) return null;
  return metrics.find((metric) => (
    metric === "budget.variance_amount"
    || metric === "milestone.max_delay_days"
    || metric === "archflow.need.impact_score"
  )) ?? metrics[0] ?? null;
}

function asOfForFiscalYear(year: number, now: Date): string {
  if (year === now.getUTCFullYear()) return now.toISOString();
  return new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)).toISOString();
}

function validDateInterval(
  value: Record<string, unknown> | null,
): ConversationQueryState["period"]["interval"] {
  const start = typeof value?.start === "string" ? value.start : "";
  const end = typeof value?.end === "string" ? value.end : "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start)
    || !/^\d{4}-\d{2}-\d{2}$/.test(end)
    || start > end
  ) {
    return null;
  }
  return { start, end };
}

function emptyEntityFilters(): ConversationQueryState["entity_filters"] {
  return {
    project_ids: [],
    portfolio_ids: [],
    organization_unit_ids: [],
    budget_scope_ids: [],
    need_ids: [],
    idea_ids: [],
  };
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
