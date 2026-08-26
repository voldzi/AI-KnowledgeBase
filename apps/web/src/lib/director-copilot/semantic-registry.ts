import snapshotJson from "./data/ssp-cs.snapshot.json";
import type {
  StratosSemanticMetric,
  StratosSemanticSource,
} from "./semantic-types";

export const SEMANTIC_REGISTRY_SNAPSHOT_VERSION =
  "stratos-semantic-registry-snapshot-1" as const;

type SemanticRegistryTarget =
  | { kind: "source"; id: StratosSemanticSource }
  | { kind: "metric"; id: StratosSemanticMetric };

interface SemanticRegistryConcept {
  uri: string;
  pref_label: string;
  alt_labels: string[];
  definition: string | null;
  broader_uris: string[];
  related_uris: string[];
}

interface SemanticRegistryBinding {
  concept_uri: string;
  targets: SemanticRegistryTarget[];
  approved_at: string;
  approved_by: string;
  note: string;
}

interface SemanticRegistrySnapshot {
  schema_version: typeof SEMANTIC_REGISTRY_SNAPSHOT_VERSION;
  snapshot_id: string;
  generated_at: string;
  source: {
    id: "ssp-cz";
    name: string;
    endpoint: string;
    documentation: string;
    license: string;
    attribution: string;
  };
  concept_count: number;
  binding_count: number;
  content_sha256: string;
  concepts: SemanticRegistryConcept[];
  bindings: SemanticRegistryBinding[];
}

export interface SemanticRegistryMatch {
  concept_uri: string;
  matched_label: string;
  targets: SemanticRegistryTarget[];
}

interface SemanticRegistryRetrievalTerm {
  label: string;
  normalized_label: string;
  label_tokens: string[];
  acronym: boolean;
  alternatives: string[];
}

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
const AMBIGUOUS_RETRIEVAL_LABELS = new Set([
  "akce",
  "aplikace",
  "datum",
  "dokument",
  "druh",
  "informace",
  "kategorie",
  "objekt",
  "platnost",
  "polozka",
  "projekt",
  "role",
  "sluzba",
  "stav",
  "typ",
  "udaj",
  "udalost",
  "vlastnost",
  "vztah",
]);

const snapshot = parseSnapshot(snapshotJson);
const conceptByUri = new Map(snapshot.concepts.map((concept) => [concept.uri, concept]));
const approvedTerms = snapshot.bindings.flatMap((binding) => {
  const concept = conceptByUri.get(binding.concept_uri);
  if (!concept) return [];
  return unique([concept.pref_label, ...concept.alt_labels])
    .map(normalizeRegistryText)
    .filter((label) => label.length >= 4)
    .map((label) => ({
      concept_uri: concept.uri,
      label,
      targets: binding.targets,
    }));
}).sort((left, right) => right.label.length - left.label.length);
const retrievalTerms = buildRetrievalTerms(snapshot.concepts);

export function semanticRegistryMatches(
  normalizedText: string,
): SemanticRegistryMatch[] {
  const boundedText = normalizeRegistryText(normalizedText).slice(0, 4_000);
  const paddedText = ` ${boundedText} `;
  const matches: SemanticRegistryMatch[] = [];
  const seen = new Set<string>();
  for (const term of approvedTerms) {
    if (!paddedText.includes(` ${term.label} `)) continue;
    const key = `${term.concept_uri}:${term.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      concept_uri: term.concept_uri,
      matched_label: term.label,
      targets: term.targets,
    });
    if (matches.length >= 16) break;
  }
  return matches;
}

export function semanticRegistrySourcesForText(
  normalizedText: string,
): StratosSemanticSource[] {
  return unique(
    semanticRegistryMatches(normalizedText)
      .flatMap((match) => match.targets)
      .filter((target): target is Extract<SemanticRegistryTarget, { kind: "source" }> => (
        target.kind === "source"
      ))
      .map((target) => target.id),
  );
}

export function semanticRegistryMetricsForText(
  normalizedText: string,
): StratosSemanticMetric[] {
  return unique(
    semanticRegistryMatches(normalizedText)
      .flatMap((match) => match.targets)
      .filter((target): target is Extract<SemanticRegistryTarget, { kind: "metric" }> => (
        target.kind === "metric"
      ))
      .map((target) => target.id),
  );
}

/**
 * Return bounded, retrieval-only lexical equivalents from the complete SSP
 * snapshot. These hints improve document recall, but never create source
 * bindings, capabilities, scopes, facts, or answers.
 */
export function semanticRegistryRetrievalHintsForText(
  text: string,
  limit = 6,
): string[] {
  const boundedLimit = Math.max(0, Math.min(limit, 12));
  if (boundedLimit === 0) return [];
  const normalizedText = normalizeRegistryText(text).slice(0, 4_000);
  if (!normalizedText) return [];
  const queryTokens = registryTokens(normalizedText);
  const hints: string[] = [];
  const seen = new Set<string>();
  for (const term of retrievalTerms) {
    if (!registryRetrievalTermMatches(normalizedText, queryTokens, term)) continue;
    for (const alternative of term.alternatives) {
      const normalizedAlternative = normalizeRegistryText(alternative);
      if (!normalizedAlternative || seen.has(normalizedAlternative)) continue;
      seen.add(normalizedAlternative);
      hints.push(alternative);
      if (hints.length >= boundedLimit) return hints;
    }
  }
  return hints;
}

export function semanticRegistryStatus() {
  return {
    schema_version: snapshot.schema_version,
    snapshot_id: snapshot.snapshot_id,
    generated_at: snapshot.generated_at,
    source_id: snapshot.source.id,
    concept_count: snapshot.concept_count,
    binding_count: snapshot.binding_count,
    retrieval_term_count: retrievalTerms.length,
    content_sha256: snapshot.content_sha256,
  };
}

function buildRetrievalTerms(
  concepts: SemanticRegistryConcept[],
): SemanticRegistryRetrievalTerm[] {
  const conceptsWithLabels = concepts.map((concept) => ({
    labels: unique([concept.pref_label, ...concept.alt_labels])
      .map((label) => label.trim().slice(0, 160))
      .filter(Boolean),
  }));
  const labelUseCount = new Map<string, number>();
  for (const entry of conceptsWithLabels) {
    for (const normalizedLabel of unique(entry.labels.map(normalizeRegistryText))) {
      labelUseCount.set(normalizedLabel, (labelUseCount.get(normalizedLabel) ?? 0) + 1);
    }
  }

  return conceptsWithLabels
    .flatMap(({ labels }) => {
      const safeLabels = labels.filter((label) => {
        const normalizedLabel = normalizeRegistryText(label);
        return labelUseCount.get(normalizedLabel) === 1
          && safeRegistryRetrievalLabel(label, normalizedLabel);
      });
      if (safeLabels.length < 2) return [];
      return safeLabels.map((label) => {
        const normalizedLabel = normalizeRegistryText(label);
        return {
          label,
          normalized_label: normalizedLabel,
          label_tokens: registryTokens(normalizedLabel),
          acronym: isRegistryAcronym(label),
          alternatives: safeLabels.filter(
            (alternative) => normalizeRegistryText(alternative) !== normalizedLabel,
          ),
        } satisfies SemanticRegistryRetrievalTerm;
      });
    })
    .sort((left, right) => (
      right.label_tokens.length - left.label_tokens.length
      || right.normalized_label.length - left.normalized_label.length
    ));
}

function safeRegistryRetrievalLabel(label: string, normalizedLabel: string): boolean {
  if (!normalizedLabel || normalizedLabel.length > 160) return false;
  if (AMBIGUOUS_RETRIEVAL_LABELS.has(normalizedLabel)) return false;
  if (isRegistryAcronym(label)) return normalizedLabel.length >= 3;
  const tokens = registryTokens(normalizedLabel);
  if (tokens.length >= 2) return normalizedLabel.length >= 8;
  return normalizedLabel.length >= 8;
}

function isRegistryAcronym(label: string): boolean {
  return /^[\p{Lu}\p{N}][\p{Lu}\p{N}.-]{2,15}$/u.test(label.trim());
}

function registryRetrievalTermMatches(
  normalizedText: string,
  queryTokens: string[],
  term: SemanticRegistryRetrievalTerm,
): boolean {
  const paddedText = ` ${normalizedText} `;
  if (paddedText.includes(` ${term.normalized_label} `)) return true;
  if (term.acronym || term.label_tokens.length === 0) return false;
  if (term.label_tokens.length > queryTokens.length) return false;
  for (let start = 0; start <= queryTokens.length - term.label_tokens.length; start += 1) {
    const window = queryTokens.slice(start, start + term.label_tokens.length);
    if (window.every((token, index) => registryTokensShareStem(token, term.label_tokens[index]!))) {
      return true;
    }
  }
  return false;
}

function registryTokensShareStem(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 4) return false;
  const requiredPrefix = Math.max(4, Math.max(left.length, right.length) - 3);
  return Math.min(left.length, right.length) >= requiredPrefix
    && left.slice(0, requiredPrefix) === right.slice(0, requiredPrefix);
}

function registryTokens(value: string): string[] {
  return value.match(/[\p{Letter}\p{Number}]+/gu) ?? [];
}

function parseSnapshot(value: unknown): SemanticRegistrySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SEMANTIC_REGISTRY_SNAPSHOT_INVALID");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema_version !== SEMANTIC_REGISTRY_SNAPSHOT_VERSION
    || !Array.isArray(record.concepts)
    || !Array.isArray(record.bindings)
  ) {
    throw new Error("SEMANTIC_REGISTRY_SNAPSHOT_INVALID");
  }
  const parsed = record as unknown as SemanticRegistrySnapshot;
  if (
    parsed.concept_count !== parsed.concepts.length
    || parsed.binding_count !== parsed.bindings.length
  ) {
    throw new Error("SEMANTIC_REGISTRY_SNAPSHOT_COUNT_MISMATCH");
  }
  for (const binding of parsed.bindings) {
    if (!parsed.concepts.some((concept) => concept.uri === binding.concept_uri)) {
      throw new Error("SEMANTIC_REGISTRY_BINDING_CONCEPT_MISSING");
    }
    for (const target of binding.targets) {
      const valid = target.kind === "source"
        ? SOURCE_VALUES.has(target.id)
        : target.kind === "metric"
          ? METRIC_VALUES.has(target.id)
          : false;
      if (!valid) throw new Error("SEMANTIC_REGISTRY_BINDING_TARGET_INVALID");
    }
  }
  return parsed;
}

function normalizeRegistryText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}:._/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
