import {
  semanticRegistryMetricsForText,
  semanticRegistrySourcesForText,
} from "./semantic-registry";
import type {
  StratosSemanticMetric,
  StratosSemanticSource,
} from "./semantic-types";
import { matchesSemanticConcept } from "./semantic-matcher";

export const STRATOS_SEMANTIC_CATALOG_VERSION = "stratos-semantic-catalog-2" as const;
export type { StratosSemanticMetric, StratosSemanticSource } from "./semantic-types";

export interface StratosSemanticSourceDefinition {
  id: StratosSemanticSource;
  displayName: string;
  terms: readonly string[];
  patterns: readonly RegExp[];
}

export interface StratosSemanticMetricDefinition {
  id: StratosSemanticMetric;
  source: StratosSemanticSource;
  description: string;
  terms: readonly string[];
  patterns: readonly RegExp[];
}

export const STRATOS_SEMANTIC_SOURCES: readonly StratosSemanticSourceDefinition[] = [
  {
    id: "budget",
    displayName: "Budget",
    terms: [
      "rozpocet", "finance", "financni hospodareni", "naklady", "vydaje",
      "cerpani", "cena", "castka", "investice", "zavazky",
    ],
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
    terms: [
      "projekt", "projektove portfolio", "milnik", "harmonogram", "termin",
      "ukol", "realizace", "dodavka",
    ],
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
    terms: [
      "business pozadavek", "business potreba", "architektonicky pozadavek",
      "pripravenost potreby", "predani do budgetu",
    ],
    patterns: [
      /\barch\s*flow\b/,
      /\barchflow\b/,
      /\bpozadav/,
      /\bpotreb(?:a|y|e|u|ou|ami|ach)\b/,
      /\barchitektonick/,
      /\bpripravenost/,
      /\bpredani do budget/,
    ],
  },
  {
    id: "aiip",
    displayName: "AI Innovation Portal",
    terms: [
      "ai podnet", "ai napad", "inovacni podnet", "inovacni napad",
      "umela inteligence", "vyuziti ai",
    ],
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
    terms: [
      "schvaleny plan", "financni plan", "rozpoctovy plan", "rozpocet",
      "planovana castka", "alokace",
    ],
    patterns: [/\brozpoc/, /\bplan(?:ovana|ovany|u|em)?\b/, /\bschvalen\w* plan/],
  },
  {
    id: "budget.actual_amount",
    source: "budget",
    description: "Zauctovana skutecnost nebo cerpani.",
    terms: [
      "skutecnost", "cerpani", "vycerpano", "utraceno", "zaplaceno",
      "uhrazeno", "proplaceno",
    ],
    patterns: [/\bskutecnost/, /\bcerpan/, /\bvycerp/, /\buhrazen/, /\butra[ct]/, /\bzaplat/, /\bproplacen/],
  },
  {
    id: "budget.forecast_amount",
    source: "budget",
    description: "Aktualni financni vyhled nebo forecast.",
    terms: [
      "financni vyhled", "forecast", "ocekavana castka", "odhad nakladu",
      "predpoklad nakladu",
    ],
    patterns: [/\bvyhled/, /\bforecast/, /\bodhad naklad/, /\bocekav/],
  },
  {
    id: "budget.commitments_amount",
    source: "budget",
    description: "Otevrene financni zavazky.",
    terms: [
      "financni zavazky", "otevrene zavazky", "objednavky",
      "smluvni cashflow", "zasmluvneno",
    ],
    patterns: [/\bzavaz[ck]/, /\bobjednavk/, /\bsmluvni cashflow/],
  },
  {
    id: "budget.variance_amount",
    source: "budget",
    description: "Odchylka skutecnosti nebo vyhledu proti planu.",
    terms: [
      "financni odchylka", "rozdil proti planu", "prekroceni planu",
      "uspora proti planu", "nad planem", "pod planem",
    ],
    patterns: [/\bodchyl/, /\brozdil/, /\bprekroc/, /\bprekra/, /\buspor/],
  },
  {
    id: "project.status",
    source: "projectflow",
    description: "Aktualni stav projektu.",
    terms: [
      "stav projektu", "status projektu", "aktivni projekty",
      "dokoncene projekty", "projektovy prehled",
    ],
    patterns: [/\bstav projekt/, /\bprojekt.*stav/, /\bproject.*status/, /\bstatus.*project/, /\baktivni projekt/, /\bdokoncen[ey] projekt/, /\bco .*realiz/],
  },
  {
    id: "project.schedule_status",
    source: "projectflow",
    description: "Stav harmonogramu projektu.",
    terms: [
      "stav harmonogramu", "plneni terminu", "terminovy stav",
      "ohrozeny termin",
    ],
    patterns: [/\bharmonogram/, /\btermin/, /\bpodle planu/, /\bohrozen/],
  },
  {
    id: "milestone.max_delay_days",
    source: "projectflow",
    description: "Nejvyssi zpozdeni projektu nebo milniku.",
    terms: [
      "zpozdeni", "prodleni", "skluz", "dny zpozdeni",
    ],
    patterns: [/\bzpozd/, /\bprodlen/, /\bkolik dni/],
  },
  {
    id: "milestone.next_due_date",
    source: "projectflow",
    description: "Nejblizsi termin nebo milnik.",
    terms: [
      "nejblizsi milnik", "nasledujici milnik", "nejblizsi termin",
      "dalsi termin", "co nasleduje",
    ],
    patterns: [/\bmilnik/, /\bnejblizsi termin/, /\bco nasleduje/],
  },
  {
    id: "archflow.need.status",
    source: "archflow",
    description: "Stav business potreby nebo pozadavku.",
    terms: [
      "stav potreby", "stav pozadavku", "status pozadavku",
      "prehled potreb",
    ],
    patterns: [/\bstav pozadav/, /\bstav potreb/],
  },
  {
    id: "archflow.need.readiness_score",
    source: "archflow",
    description: "Pripravenost pozadavku pro dalsi rozhodnuti.",
    terms: [
      "pripravenost pozadavku", "pripravenost potreby",
      "pripraveno k rozhodnuti",
    ],
    patterns: [/\bpripravenost/, /\bpripraven[ey] k rozhodnuti/],
  },
  {
    id: "archflow.need.impact_score",
    source: "archflow",
    description: "Dopad nebo priorita business potreby.",
    terms: [
      "dopad potreby", "dopad pozadavku", "priorita potreby",
      "priorita pozadavku",
    ],
    patterns: [/\bdopad/, /\bpriorit/],
  },
  {
    id: "archflow.need.decision",
    source: "archflow",
    description: "Aktualni rozhodnuti o business potrebe.",
    terms: [
      "rozhodnuti o potrebe", "rozhodnuti o pozadavku",
      "schvaleni potreby", "schvaleni pozadavku",
    ],
    patterns: [/\brozhodnut/, /\bschvalen/],
  },
  {
    id: "archflow.need.budget_handoff_status",
    source: "archflow",
    description: "Stav predani pozadavku do Budgetu.",
    terms: [
      "predani potreby do budgetu", "predani pozadavku do budgetu",
      "predani do rozpoctu",
    ],
    patterns: [/\bpredan\w*(?:\s+\w+){0,4}\s+do budget\w*/, /\bpredan[oy] do rozpoctu/],
  },
  {
    id: "aiip.idea.status",
    source: "aiip",
    description: "Stav AI podnetu.",
    terms: [
      "stav ai podnetu", "stav ai napadu", "status inovacniho podnetu",
    ],
    patterns: [/\bstav ai podnet/, /\bstav ai napad/],
  },
  {
    id: "aiip.idea.value_score",
    source: "aiip",
    description: "Hodnoceni hodnoty AI podnetu.",
    terms: [
      "hodnota ai podnetu", "hodnota ai napadu", "value score",
      "hodnoceni prinosu",
    ],
    patterns: [/\bhodnot/, /\bvalue score/],
  },
  {
    id: "aiip.idea.risk_score",
    source: "aiip",
    description: "Hodnoceni rizika AI podnetu.",
    terms: [
      "riziko ai podnetu", "riziko ai napadu", "rizikove skore",
      "zvladnutelnost rizika",
    ],
    patterns: [/\brizik/],
  },
  {
    id: "aiip.idea.expected_benefit",
    source: "aiip",
    description: "Ocekavany nebo meritelny prinos AI podnetu.",
    terms: [
      "ocekavany prinos", "meritelny prinos", "prinos ai podnetu",
      "benefit ai napadu",
    ],
    patterns: [/\bprinos/, /\bbenefit/, /\buspor/],
  },
  {
    id: "aiip.idea.handoff_status",
    source: "aiip",
    description: "Stav predani AI podnetu do ArchFlow.",
    terms: [
      "predani ai podnetu do archflow", "predani ai napadu do archflow",
      "handoff do archflow",
    ],
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
      .filter((definition) => (
        definition.patterns.some((pattern) => pattern.test(normalizedText))
        || matchesSemanticConcept(normalizedText, definition.terms)
      ))
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
        && (
          definition.patterns.some((pattern) => pattern.test(normalizedText))
          || matchesSemanticConcept(normalizedText, definition.terms)
        )
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
