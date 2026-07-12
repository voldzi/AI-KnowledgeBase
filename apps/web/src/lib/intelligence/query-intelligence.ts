import type { AklLanguage } from "@/lib/language";
import type {
  AnalystCase,
  AnalystSearchField,
  AnalystSearchMode,
  Document,
  EntityFacetReport,
  QueryComposerPlan,
  QueryComposerRecoveryAction,
  QueryComposerSuggestion,
  QueryComposerTokenInput,
  QueryComposerValidationIssue,
  QuerySuggestionResponse,
} from "@/lib/types";

const ANALYST_FIELD_ALIASES: Record<Exclude<AnalystSearchField, "all">, string> = {
  title: "title",
  body: "body",
  section: "section",
  entity: "entity",
  source: "source",
};

const FIELD_ALIAS_SET = new Set(Object.values(ANALYST_FIELD_ALIASES));
const BOOLEAN_OPERATORS = new Set(["AND", "OR", "NOT"]);

const queryCopy = {
  cs: {
    builder: "Builder",
    fields: "Pole",
    entities: "Entity",
    dictionary: "Slovník korpusu",
    cases: "Spisy a dotazy",
    operators: "Operátory",
    useText: "Použít jako text",
    usePhrase: "Použít jako frázi",
    tokenTerm: "Text",
    tokenPhrase: "Fráze",
    tokenField: "Pole",
    tokenEntity: "Entita",
    tokenOperator: "Operátor",
    tokenSavedQuery: "Uložený dotaz",
    fieldTitle: "Název",
    fieldBody: "Text",
    fieldSection: "Sekce",
    fieldEntity: "Entity",
    fieldSource: "Zdroj",
    document: "Dokument",
    owners: "Vlastníci a gestoři",
    tag: "Štítek",
    owner: "Vlastník",
    externalSystem: "Externí systém",
    documentNumber: "Číslo dokumentu",
    unbalancedQuotes: "Dotaz má neuzavřenou frázi.",
    unbalancedParentheses: "Dotaz má nevyvážené závorky.",
    leadingWildcard: "Úvodní wildcard není povolený kvůli výkonu vyhledávání.",
    danglingOperator: "Dotaz končí logickým operátorem.",
    repeatedOperator: "Dotaz obsahuje dva logické operátory za sebou.",
    unsupportedField: "Pole není podporované v analytickém vyhledávání.",
    emptyQuery: "Zadejte text nebo vyberte návrh.",
    highCost: "Dotaz je široký; zvažte pole, frázi nebo entitu.",
  },
  en: {
    builder: "Builder",
    fields: "Fields",
    entities: "Entities",
    dictionary: "Corpus dictionary",
    cases: "Cases and queries",
    operators: "Operators",
    useText: "Use as text",
    usePhrase: "Use as phrase",
    tokenTerm: "Text",
    tokenPhrase: "Phrase",
    tokenField: "Field",
    tokenEntity: "Entity",
    tokenOperator: "Operator",
    tokenSavedQuery: "Saved query",
    fieldTitle: "Title",
    fieldBody: "Body",
    fieldSection: "Section",
    fieldEntity: "Entities",
    fieldSource: "Source",
    document: "Document",
    owners: "Owners and stewards",
    tag: "Tag",
    owner: "Owner",
    externalSystem: "External system",
    documentNumber: "Document number",
    unbalancedQuotes: "The query has an unclosed phrase.",
    unbalancedParentheses: "The query has unbalanced parentheses.",
    leadingWildcard: "Leading wildcards are blocked for search performance.",
    danglingOperator: "The query ends with a boolean operator.",
    repeatedOperator: "The query contains two boolean operators in sequence.",
    unsupportedField: "The field is not supported by analyst search.",
    emptyQuery: "Enter text or choose a suggestion.",
    highCost: "The query is broad; consider a field, phrase, or entity.",
  },
} satisfies Record<AklLanguage, Record<string, string>>;

interface CandidateSignal {
  id: string;
  type: "document_number" | "owner" | "tag" | "external_system";
  label: string;
  count: number;
}

interface BuildQueryIntelligenceOptions {
  input: string;
  tokens: QueryComposerTokenInput[];
  documents: Document[];
  entityFacets: EntityFacetReport;
  cases: AnalystCase[];
  activeCaseId?: string | null;
  language: AklLanguage;
  limit?: number;
  warnings?: string[];
}

export function buildQueryIntelligenceResponse({
  input,
  tokens,
  documents,
  entityFacets,
  cases,
  activeCaseId,
  language,
  limit = 36,
  warnings = [],
}: BuildQueryIntelligenceOptions): QuerySuggestionResponse {
  const safeInput = input.trim().slice(0, 200);
  const copy = queryCopy[language];
  const activeCase = cases.find((analystCase) => analystCase.case_id === activeCaseId) ?? null;
  const suggestions = buildSuggestions({
    input: safeInput,
    documents,
    candidateSignals: deriveCandidateSignals(documents),
    entityFacets,
    cases,
    activeCase,
    language,
    limit,
  });
  const queryText = composeQueryFromTokens(tokens, safeInput);
  const validation = validateQueryText(queryText, tokens, language);
  const plan = buildQueryPlan(queryText, validation);

  if (plan.estimated_cost === "high" && plan.can_run) {
    validation.push({
      severity: "warning",
      code: "HIGH_COST_QUERY",
      message: copy.highCost,
    });
  }

  return {
    status: warnings.length > 0 ? "partial" : "ready",
    input: safeInput,
    suggestions,
    validation,
    plan: {
      ...plan,
      can_run: plan.can_run && !validation.some((issue) => issue.severity === "error"),
    },
    preview: {
      status: "idle",
      total_hits: null,
      query_mode: plan.query_mode,
      recovery_actions: [],
      warnings: [],
    },
    generated_at: new Date().toISOString(),
    warnings,
  };
}

export function buildQueryRecoveryCandidates(
  plan: QueryComposerPlan,
  language: AklLanguage = "cs",
): QueryComposerRecoveryAction[] {
  if (!plan.query_text.trim()) {
    return [];
  }

  const labels = language === "cs"
    ? {
        smart: "Rozšířit na chytré hledání",
        smartDetail: "Odstraní přesnou syntaxi a prohledá všechna pole.",
        any: "Hledat libovolný výraz",
        anyDetail: "Nález může obsahovat alespoň jeden z výrazů.",
      }
    : {
        smart: "Broaden to smart search",
        smartDetail: "Removes exact syntax and searches all fields.",
        any: "Match any term",
        anyDetail: "A result may contain at least one of the terms.",
      };
  const broadText = plainRecoveryText(plan.query_text);
  if (!broadText) {
    return [];
  }

  const candidates: QueryComposerRecoveryAction[] = [];
  if (plan.query_mode !== "smart" || plan.search_fields.some((field) => field !== "all")) {
    candidates.push({
      id: "broaden-smart",
      label: labels.smart,
      detail: labels.smartDetail,
      query_text: broadText,
      query_mode: "smart",
      search_fields: ["all"],
      total_hits: null,
    });
  }

  const terms = uniqueRecoveryTerms(broadText);
  if (terms.length > 1) {
    const anyQuery = terms.map(quoteQueryValue).join(" OR ");
    if (anyQuery !== plan.normalized_query) {
      candidates.push({
        id: "match-any",
        label: labels.any,
        detail: labels.anyDetail,
        query_text: anyQuery,
        query_mode: "boolean",
        search_fields: ["all"],
        total_hits: null,
      });
    }
  }

  return candidates.slice(0, 2);
}

export function composeQueryFromTokens(tokens: QueryComposerTokenInput[], input: string): string {
  const fragments = tokens
    .map((token) => token.query_fragment?.trim() || token.value?.trim() || "")
    .filter(Boolean);
  const trailingInput = input.trim();
  if (trailingInput) {
    fragments.push(trailingInput);
  }
  return fragments.join(" ").replace(/\s+/g, " ").trim().slice(0, 500);
}

export function validateQueryText(
  queryText: string,
  tokens: QueryComposerTokenInput[] = [],
  language: AklLanguage = "cs",
): QueryComposerValidationIssue[] {
  const copy = queryCopy[language];
  const issues: QueryComposerValidationIssue[] = [];
  const query = queryText.trim();

  if (!query) {
    issues.push({
      severity: "info",
      code: "EMPTY_QUERY",
      message: copy.emptyQuery,
    });
    return issues;
  }

  if (countUnescaped(query, '"') % 2 !== 0) {
    issues.push({
      severity: "error",
      code: "UNBALANCED_QUOTES",
      message: copy.unbalancedQuotes,
      position: query.lastIndexOf('"'),
    });
  }

  const parenBalance = parenthesesBalance(query);
  if (parenBalance !== 0) {
    issues.push({
      severity: "error",
      code: "UNBALANCED_PARENTHESES",
      message: copy.unbalancedParentheses,
    });
  }

  const terms = tokenizeQuery(query);
  const firstTerm = terms[0]?.value ?? "";
  const lastTerm = terms[terms.length - 1]?.value ?? "";
  if (/^[*?]/.test(firstTerm) || /\s[*?][^\s)]*/.test(query)) {
    issues.push({
      severity: "error",
      code: "LEADING_WILDCARD",
      message: copy.leadingWildcard,
      position: query.search(/(^|\s)[*?]/),
    });
  }
  if (BOOLEAN_OPERATORS.has(lastTerm.toUpperCase())) {
    issues.push({
      severity: "error",
      code: "DANGLING_OPERATOR",
      message: copy.danglingOperator,
      position: terms[terms.length - 1]?.position,
    });
  }
  for (let index = 1; index < terms.length; index += 1) {
    const previous = terms[index - 1].value.toUpperCase();
    const current = terms[index].value.toUpperCase();
    if (BOOLEAN_OPERATORS.has(previous) && BOOLEAN_OPERATORS.has(current) && current !== "NOT") {
      issues.push({
        severity: "error",
        code: "REPEATED_OPERATOR",
        message: copy.repeatedOperator,
        position: terms[index].position,
      });
    }
  }

  for (const match of query.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{1,30}):/g)) {
    const field = match[1].toLowerCase();
    if (!FIELD_ALIAS_SET.has(field)) {
      issues.push({
        severity: "warning",
        code: "UNSUPPORTED_FIELD",
        message: `${copy.unsupportedField}: ${field}`,
        position: match.index,
      });
    }
  }

  for (const token of tokens) {
    if (token.type === "field" && token.field && token.field !== "all" && !ANALYST_FIELD_ALIASES[token.field]) {
      issues.push({
        severity: "warning",
        code: "UNSUPPORTED_TOKEN_FIELD",
        message: `${copy.unsupportedField}: ${token.field}`,
        token_id: token.id,
      });
    }
  }

  return issues;
}

function buildSuggestions({
  input,
  documents,
  candidateSignals,
  entityFacets,
  cases,
  activeCase,
  language,
  limit,
}: {
  input: string;
  documents: Document[];
  candidateSignals: CandidateSignal[];
  entityFacets: EntityFacetReport;
  cases: AnalystCase[];
  activeCase: AnalystCase | null;
  language: AklLanguage;
  limit: number;
}): QueryComposerSuggestion[] {
  const copy = queryCopy[language];
  const rawInput = input.trim();
  const normalizedInput = normalizeSuggestionText(rawInput);
  const suggestions: QueryComposerSuggestion[] = [];
  const seen = new Set<string>();
  const addSuggestion = (suggestion: QueryComposerSuggestion) => {
    const key = `${suggestion.type}:${suggestion.query_fragment}:${suggestion.label}`.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    suggestions.push(suggestion);
  };

  if (rawInput) {
    addSuggestion({
      id: `builder:term:${rawInput}`,
      type: "term",
      source: "builder",
      group: copy.builder,
      label: `${copy.useText}: ${rawInput}`,
      detail: copy.tokenTerm,
      value: rawInput,
      query_fragment: rawInput,
      score: 100,
    });
    addSuggestion({
      id: `builder:phrase:${rawInput}`,
      type: "phrase",
      source: "builder",
      group: copy.builder,
      label: `${copy.usePhrase}: ${rawInput}`,
      detail: copy.tokenPhrase,
      value: rawInput,
      query_fragment: quoteQueryValue(rawInput),
      mode: "phrase",
      score: 98,
    });
    for (const field of Object.keys(ANALYST_FIELD_ALIASES) as Array<Exclude<AnalystSearchField, "all">>) {
      addSuggestion({
        id: `field:${field}:${rawInput}`,
        type: "field",
        source: "field",
        group: copy.fields,
        label: `${fieldLabel(field, language)}: ${rawInput}`,
        detail: `${copy.tokenField} · ${ANALYST_FIELD_ALIASES[field]}:`,
        value: rawInput,
        query_fragment: `${ANALYST_FIELD_ALIASES[field]}:${quoteQueryValue(rawInput)}`,
        field,
        mode: "fielded",
        score: 92,
      });
    }
  }

  for (const operator of ["AND", "OR", "NOT"]) {
    if (!rawInput || operator.toLowerCase().startsWith(normalizedInput)) {
      addSuggestion({
        id: `operator:${operator}`,
        type: "operator",
        source: "operator",
        group: copy.operators,
        label: operator,
        detail: copy.tokenOperator,
        value: operator,
        query_fragment: operator,
        mode: "boolean",
        score: 80,
      });
    }
  }

  const savedQueries = [...(activeCase?.saved_queries ?? []), ...cases.flatMap((analystCase) => analystCase.saved_queries)];
  for (const savedQuery of savedQueries.slice(0, 32)) {
    if (!rawInput || suggestionMatches(savedQuery.title, normalizedInput) || suggestionMatches(savedQuery.query_text, normalizedInput)) {
      addSuggestion({
        id: `saved:${savedQuery.saved_query_id}`,
        type: "saved_query",
        source: "case",
        group: copy.cases,
        label: savedQuery.title,
        detail: savedQuery.query_mode,
        value: savedQuery.query_text,
        query_fragment: savedQuery.query_text,
        mode: savedQuery.query_mode,
        score: activeCase?.case_id === savedQuery.case_id ? 95 : 72,
      });
    }
  }

  for (const group of entityFacets.entity_groups.slice(0, 16)) {
    for (const value of group.values.slice(0, 12)) {
      const label = value.label || value.key;
      if (!rawInput || suggestionMatches(label, normalizedInput) || suggestionMatches(group.label, normalizedInput)) {
        addSuggestion({
          id: `entity:${group.entity_type}:${value.key}`,
          type: "entity",
          source: "entity",
          group: copy.entities,
          label,
          detail: entityTypeLabel(group.entity_type, language),
          value: value.key,
          query_fragment: `entity:${quoteQueryValue(value.key)}`,
          entity_type: group.entity_type,
          entity_value: value.key,
          field: "entity",
          mode: "fielded",
          score: Math.min(94, 65 + value.count),
        });
      }
    }
  }

  for (const candidate of candidateSignals.slice(0, 48)) {
    if (!rawInput || suggestionMatches(candidate.label, normalizedInput)) {
      addSuggestion({
        id: `candidate:${candidate.id}`,
        type: candidate.type === "document_number" ? "entity" : "term",
        source: "dictionary",
        group: copy.dictionary,
        label: candidate.label,
        detail: candidateTypeLabel(candidate.type, language),
        value: candidate.label,
        query_fragment:
          candidate.type === "document_number"
            ? `entity:${quoteQueryValue(candidate.label)}`
            : quoteQueryValue(candidate.label),
        entity_type: candidate.type === "document_number" ? "document_number" : undefined,
        entity_value: candidate.type === "document_number" ? candidate.label : undefined,
        mode: candidate.type === "document_number" ? "fielded" : "phrase",
        score: Math.min(90, 55 + candidate.count),
      });
    }
  }

  for (const document of documents.slice(0, 80)) {
    const values = [
      {
        label: document.title,
        detail: copy.fieldTitle,
        fragment: `title:${quoteQueryValue(document.title)}`,
        field: "title" as const,
        score: 86,
      },
      {
        label: document.document_id,
        detail: copy.document,
        fragment: quoteQueryValue(document.document_id),
        field: undefined,
        score: 68,
      },
      {
        label: document.gestor_unit ?? document.owner,
        detail: copy.owners,
        fragment: quoteQueryValue(document.gestor_unit ?? document.owner),
        field: undefined,
        score: 64,
      },
      ...document.tags.slice(0, 5).map((tag) => ({
        label: tag,
        detail: copy.tag,
        fragment: quoteQueryValue(tag),
        field: undefined,
        score: 62,
      })),
    ];
    for (const value of values) {
      if (value.label && (!rawInput || suggestionMatches(value.label, normalizedInput))) {
        addSuggestion({
          id: `document:${document.document_id}:${value.detail}:${value.label}`,
          type: value.field ? "field" : "term",
          source: "dictionary",
          group: copy.dictionary,
          label: value.label,
          detail: value.detail,
          value: value.label,
          query_fragment: value.fragment,
          field: value.field,
          mode: value.field ? "fielded" : "phrase",
          score: value.score,
        });
      }
    }
  }

  return suggestions.sort((left, right) => right.score - left.score).slice(0, Math.max(1, Math.min(limit, 50)));
}

function buildQueryPlan(queryText: string, validation: QueryComposerValidationIssue[]): QueryComposerPlan {
  const normalizedQuery = queryText.replace(/\s+/g, " ").trim();
  const detectedFields = detectedSearchFields(normalizedQuery);
  const hasBoolean = /\b(AND|OR|NOT)\b/.test(normalizedQuery) || /[()]/.test(normalizedQuery);
  const hasField = detectedFields.length > 0;
  const hasPhrase = /"[^"]+"/.test(normalizedQuery);
  const clauseCount = Math.max(0, tokenizeQuery(normalizedQuery).filter((token) => !BOOLEAN_OPERATORS.has(token.value.toUpperCase())).length);
  const wildcardCount = (normalizedQuery.match(/[*?]/g) ?? []).length;
  const queryMode: AnalystSearchMode = hasField
    ? "fielded"
    : hasBoolean
      ? "boolean"
      : hasPhrase
        ? "phrase"
        : "smart";
  const estimatedCost =
    clauseCount > 12 || wildcardCount > 3 || normalizedQuery.length > 300
      ? "high"
      : clauseCount > 6 || wildcardCount > 0 || queryMode === "fielded"
        ? "medium"
        : "low";

  return {
    query_text: normalizedQuery,
    normalized_query: normalizedQuery,
    query_mode: queryMode,
    search_fields: detectedFields.length > 0 ? detectedFields : ["all"],
    proximity_slop: 5,
    detected_fields: detectedFields,
    clause_count: clauseCount,
    estimated_cost: estimatedCost,
    can_run: normalizedQuery.length > 0 && !validation.some((issue) => issue.severity === "error"),
  };
}

function detectedSearchFields(query: string): AnalystSearchField[] {
  const fields: AnalystSearchField[] = [];
  for (const match of query.matchAll(/\b(title|body|section|entity|source):/gi)) {
    const field = match[1].toLowerCase() as AnalystSearchField;
    if (!fields.includes(field)) {
      fields.push(field);
    }
  }
  return fields;
}

function plainRecoveryText(query: string): string {
  return query
    .replace(/\b(?:title|body|section|entity|source):/gi, "")
    .replace(/~\d{1,2}\b/g, "")
    .replace(/\b(?:AND|OR|NOT)\b/gi, " ")
    .replace(/[()]/g, " ")
    .replace(/\\"/g, '"')
    .replace(/"/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function uniqueRecoveryTerms(value: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of value.split(/\s+/)) {
    const normalized = normalizeSuggestionText(term);
    if (normalized.length < 2 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    terms.push(term);
    if (terms.length >= 8) {
      break;
    }
  }
  return terms;
}

function tokenizeQuery(query: string): Array<{ value: string; position: number }> {
  const tokens: Array<{ value: string; position: number }> = [];
  for (const match of query.matchAll(/"[^"]*"|\S+/g)) {
    tokens.push({ value: match[0], position: match.index ?? 0 });
  }
  return tokens;
}

function countUnescaped(value: string, char: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === char && value[index - 1] !== "\\") {
      count += 1;
    }
  }
  return count;
}

function parenthesesBalance(value: string): number {
  let balance = 0;
  let inQuote = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"' && value[index - 1] !== "\\") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (char === "(") balance += 1;
    if (char === ")") balance -= 1;
  }
  return balance;
}

export function quoteQueryValue(value: string): string {
  const escaped = value.trim().replaceAll('"', '\\"');
  if (!escaped) {
    return "";
  }
  return /[\s:/()]/.test(escaped) ? `"${escaped}"` : escaped;
}

function normalizeSuggestionText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function suggestionMatches(value: string | null | undefined, normalizedInput: string): boolean {
  if (!normalizedInput) {
    return true;
  }
  return normalizeSuggestionText(value ?? "").includes(normalizedInput);
}

function fieldLabel(field: Exclude<AnalystSearchField, "all">, language: AklLanguage): string {
  const copy = queryCopy[language];
  if (field === "title") return copy.fieldTitle;
  if (field === "body") return copy.fieldBody;
  if (field === "section") return copy.fieldSection;
  if (field === "entity") return copy.fieldEntity;
  return copy.fieldSource;
}

function entityTypeLabel(entityType: string, language: AklLanguage): string {
  const labels: Record<string, Record<AklLanguage, string>> = {
    document_number: { cs: "Číslo dokumentu", en: "Document number" },
    date: { cs: "Datum", en: "Date" },
    email: { cs: "E-mail", en: "Email" },
    url: { cs: "URL", en: "URL" },
    ipv4: { cs: "IPv4", en: "IPv4" },
    phone: { cs: "Telefon", en: "Phone" },
  };
  return labels[entityType]?.[language] ?? entityType;
}

function candidateTypeLabel(type: CandidateSignal["type"], language: AklLanguage): string {
  const copy = queryCopy[language];
  if (type === "document_number") return copy.documentNumber;
  if (type === "owner") return copy.owner;
  if (type === "external_system") return copy.externalSystem;
  return copy.tag;
}

function deriveCandidateSignals(documents: Document[]): CandidateSignal[] {
  const counts = new Map<string, CandidateSignal>();
  const add = (type: CandidateSignal["type"], label: string | null | undefined) => {
    const normalized = label?.trim();
    if (!normalized) return;
    const key = `${type}:${normalized.toLowerCase()}`;
    const current = counts.get(key);
    if (current) {
      current.count += 1;
    } else {
      counts.set(key, { id: key, type, label: normalized, count: 1 });
    }
  };

  for (const document of documents) {
    add("owner", document.owner);
    add("owner", document.gestor_unit);
    for (const tag of document.tags) {
      add("tag", tag);
    }
    const metadata = document.metadata ?? {};
    add("external_system", nestedString(metadata, ["stratos", "external_system"]) ?? stringValue(metadata.external_system));
    for (const match of document.title.matchAll(/\b[A-ZČŘŠŽ]{2,}[- ]?\d{1,5}\/\d{4}\b/g)) {
      add("document_number", match[0].replace(/\s+/g, ""));
    }
  }

  return [...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function nestedString(value: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return stringValue(current);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
