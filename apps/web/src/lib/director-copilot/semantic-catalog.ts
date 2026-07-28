import {
  semanticRegistryMetricsForText,
  semanticRegistrySourcesForText,
} from "./semantic-registry";
import type {
  StratosSemanticMetric,
  StratosSemanticSource,
} from "./semantic-types";

export const STRATOS_SEMANTIC_CATALOG_VERSION = "stratos-semantic-catalog-2" as const;
export type { StratosSemanticMetric, StratosSemanticSource } from "./semantic-types";

export interface StratosSemanticSourceDefinition {
  id: StratosSemanticSource;
  displayName: string;
  patterns: readonly RegExp[];
}

export interface StratosSemanticMetricDefinition {
  id: StratosSemanticMetric;
  source: StratosSemanticSource;
  description: string;
  patterns: readonly RegExp[];
}

export const STRATOS_SEMANTIC_SOURCES: readonly StratosSemanticSourceDefinition[] = [
  {
    id: "budget",
    displayName: "Budget",
    patterns: [
      /\bbudget\w*/,
      /\brozpoc/,
      /\bfinanc/,
      /\bnaklad/,
      /\bvydaj/,
      /\butrat/,
      /\bvycerp/,
      /\bzaplat/,
      /\bcen[ay]\b/,
      /\bcastk/,
      /\binvestic/,
    ],
  },
  {
    id: "projectflow",
    displayName: "ProjectFlow",
    patterns: [
      /\bproject\s*flow\b/,
      /\bprojectflow\b/,
      /\bprojekt/,
      /\bportfolio\b/,
      /\bmilnik/,
      /\bharmonogram/,
      /\bzpozd/,
      /\btermin/,
      /\bukol/,
      /\brealiz/,
    ],
  },
  {
    id: "archflow",
    displayName: "ArchFlow",
    patterns: [
      /\barch\s*flow\b/,
      /\barchflow\b/,
      /\bpozadav/,
      /\bpotreb/,
      /\barchitektonick/,
      /\bpripravenost/,
      /\bpredani do budget/,
    ],
  },
  {
    id: "aiip",
    displayName: "AI Innovation Portal",
    patterns: [
      /\baiip\b/,
      /\bai innovation portal\b/,
      /\bai podnet/,
      /\bai napad/,
      /\binovacni podnet/,
      /\bnapad na (?:vyuziti )?ai\b/,
    ],
  },
] as const;

export const STRATOS_SEMANTIC_METRICS: readonly StratosSemanticMetricDefinition[] = [
  {
    id: "budget.plan_amount",
    source: "budget",
    description: "Schvaleny financni plan nebo rozpocet.",
    patterns: [/\brozpoc/, /\bplan(?:ovana|ovany|u|em)?\b/, /\bschvalen\w* plan/],
  },
  {
    id: "budget.actual_amount",
    source: "budget",
    description: "Zauctovana skutecnost nebo cerpani.",
    patterns: [/\bskutecnost/, /\bcerpan/, /\bvycerp/, /\buhrazen/, /\butra[ct]/, /\bzaplat/, /\bproplacen/],
  },
  {
    id: "budget.forecast_amount",
    source: "budget",
    description: "Aktualni financni vyhled nebo forecast.",
    patterns: [/\bvyhled/, /\bforecast/, /\bodhad naklad/, /\bocekav/],
  },
  {
    id: "budget.commitments_amount",
    source: "budget",
    description: "Otevrene financni zavazky.",
    patterns: [/\bzavazk/, /\bobjednavk/, /\bsmluvni cashflow/],
  },
  {
    id: "budget.variance_amount",
    source: "budget",
    description: "Odchylka skutecnosti nebo vyhledu proti planu.",
    patterns: [/\bodchyl/, /\brozdil/, /\bprekroc/, /\bprekra/, /\buspor/],
  },
  {
    id: "project.status",
    source: "projectflow",
    description: "Aktualni stav projektu.",
    patterns: [/\bstav projekt/, /\bprojekt.*stav/, /\bproject.*status/, /\bstatus.*project/, /\baktivni projekt/, /\bdokoncen[ey] projekt/, /\bco .*realiz/],
  },
  {
    id: "project.schedule_status",
    source: "projectflow",
    description: "Stav harmonogramu projektu.",
    patterns: [/\bharmonogram/, /\btermin/, /\bpodle planu/, /\bohrozen/],
  },
  {
    id: "milestone.max_delay_days",
    source: "projectflow",
    description: "Nejvyssi zpozdeni projektu nebo milniku.",
    patterns: [/\bzpozd/, /\bprodlen/, /\bkolik dni/],
  },
  {
    id: "milestone.next_due_date",
    source: "projectflow",
    description: "Nejblizsi termin nebo milnik.",
    patterns: [/\bmilnik/, /\bnejblizsi termin/, /\bco nasleduje/],
  },
  {
    id: "archflow.need.status",
    source: "archflow",
    description: "Stav business potreby nebo pozadavku.",
    patterns: [/\bstav pozadav/, /\bstav potreb/],
  },
  {
    id: "archflow.need.readiness_score",
    source: "archflow",
    description: "Pripravenost pozadavku pro dalsi rozhodnuti.",
    patterns: [/\bpripravenost/, /\bpripraven[ey] k rozhodnuti/],
  },
  {
    id: "archflow.need.impact_score",
    source: "archflow",
    description: "Dopad nebo priorita business potreby.",
    patterns: [/\bdopad/, /\bpriorit/],
  },
  {
    id: "archflow.need.decision",
    source: "archflow",
    description: "Aktualni rozhodnuti o business potrebe.",
    patterns: [/\brozhodnut/, /\bschvalen/],
  },
  {
    id: "archflow.need.budget_handoff_status",
    source: "archflow",
    description: "Stav predani pozadavku do Budgetu.",
    patterns: [/\bpredan\w*(?:\s+\w+){0,4}\s+do budget\w*/, /\bpredan[oy] do rozpoctu/],
  },
  {
    id: "aiip.idea.status",
    source: "aiip",
    description: "Stav AI podnetu.",
    patterns: [/\bstav ai podnet/, /\bstav ai napad/],
  },
  {
    id: "aiip.idea.value_score",
    source: "aiip",
    description: "Hodnoceni hodnoty AI podnetu.",
    patterns: [/\bhodnot/, /\bvalue score/],
  },
  {
    id: "aiip.idea.risk_score",
    source: "aiip",
    description: "Hodnoceni rizika AI podnetu.",
    patterns: [/\brizik/],
  },
  {
    id: "aiip.idea.expected_benefit",
    source: "aiip",
    description: "Ocekavany nebo meritelny prinos AI podnetu.",
    patterns: [/\bprinos/, /\bbenefit/, /\buspor/],
  },
  {
    id: "aiip.idea.handoff_status",
    source: "aiip",
    description: "Stav predani AI podnetu do ArchFlow.",
    patterns: [/\bpredani do archflow/, /\bpredan[oy] do archflow/],
  },
] as const;

export function normalizeSemanticText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}:._/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function semanticSourcesForText(
  normalizedText: string,
): StratosSemanticSource[] {
  return unique([
    ...STRATOS_SEMANTIC_SOURCES
      .filter((definition) => definition.patterns.some((pattern) => pattern.test(normalizedText)))
      .map((definition) => definition.id),
    ...semanticRegistrySourcesForText(normalizedText),
  ]);
}

export function semanticMetricsForText(
  normalizedText: string,
): StratosSemanticMetric[] {
  const explicitSources = new Set(semanticSourcesForText(normalizedText));
  return unique([
    ...STRATOS_SEMANTIC_METRICS
      .filter((definition) => (
        (definition.source === "budget"
          || definition.source === "projectflow"
          || explicitSources.has(definition.source))
        && definition.patterns.some((pattern) => pattern.test(normalizedText))
      ))
      .map((definition) => definition.id),
    ...semanticRegistryMetricsForText(normalizedText),
  ]);
}

export function sourceForMetric(
  metric: StratosSemanticMetric,
): StratosSemanticSource {
  return STRATOS_SEMANTIC_METRICS.find((definition) => definition.id === metric)!.source;
}

export function pendingSemanticSources(
  _sources: readonly StratosSemanticSource[],
): StratosSemanticSource[] {
  // Every semantic source is bound to the pinned V2 manifest catalog at runtime.
  return [];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
