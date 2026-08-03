import type {
  AssistantChatResponse,
  Citation,
  ControlledRule,
  ControlledRuleList,
  ResponseLanguage,
} from "@/lib/types";

export const CONTROLLED_RULE_DOMAIN_PUBLIC_PROCUREMENT = "public_procurement";

export interface ControlledRuleIntent {
  domain: typeof CONTROLLED_RULE_DOMAIN_PUBLIC_PROCUREMENT;
  validOn: string | null;
}

const PUBLIC_PROCUREMENT_RE = /(?:veřejn(?:á|é|ých|ou)\s+zakáz|verejn(?:a|e|ych|ou)\s+zakaz|\bvzmr\b|zadáván(?:í|i)\s+zakáz|zadavani\s+zakaz|public\s+procurement)/i;
const CONTROLLED_RULE_QUESTION_RE = /(?:limit|částk|castk|hran(?:ice|ičn)|do\s+kolika|od\s+kolika|kolik|povinnost|schvaluj|výjimk|vyjimk|nabídk|nabidk|doklad|lhůt|lhut|postup|pravidl|režim|rezim)/i;

const CZECH_STOP_WORDS = new Set([
  "a", "ale", "co", "do", "je", "jaky", "jake", "jakou", "kdo", "ma",
  "na", "nebo", "od", "podle", "pro", "se", "smernice", "ve", "verejna",
  "verejne", "verejnych", "verejnou", "zakazka", "zakazky", "zakazek",
]);

export function controlledRuleIntentFromMessage(
  message: string,
  context: Record<string, unknown> = {},
): ControlledRuleIntent | null {
  const contextDomain = contextString(
    context,
    "controlled_rule_domain",
    "controlledRuleDomain",
  );
  const continuingControlledRules =
    contextString(context, "answer_source") === "controlled_rules"
    && contextDomain === CONTROLLED_RULE_DOMAIN_PUBLIC_PROCUREMENT;
  const hasDomain = PUBLIC_PROCUREMENT_RE.test(message) || continuingControlledRules;
  if (!hasDomain || !CONTROLLED_RULE_QUESTION_RE.test(message)) {
    return null;
  }
  return {
    domain: CONTROLLED_RULE_DOMAIN_PUBLIC_PROCUREMENT,
    validOn: explicitValidOn(message) ?? contextString(context, "controlled_rule_valid_on"),
  };
}

export function buildControlledRuleAssistantResponse(input: {
  message: string;
  conversationId: string | null;
  context: Record<string, unknown>;
  language: ResponseLanguage;
  result: ControlledRuleList;
}): AssistantChatResponse {
  const eligible = input.result.rules.filter(
    (rule) => rule.consumer_eligible
      && ["accepted", "edited"].includes(rule.verification_status)
      && ["authoritative", "supplemental"].includes(rule.precedence_status),
  );
  const matchingConflicts = rankedRules(input.message, input.result.rules.filter(
    (rule) => rule.precedence_status === "conflict",
  ));
  const matching = rankedRules(input.message, eligible).slice(0, 6);
  const baseContext = {
    ...input.context,
    answer_source: "controlled_rules",
    controlled_rule_domain: input.result.domain,
    controlled_rule_valid_on: input.result.valid_on,
  };

  if (matchingConflicts.length > 0) {
    return emptyResponse({
      conversationId: input.conversationId,
      language: input.language,
      context: baseContext,
      confidence: "conflicting_sources",
      warnings: [...input.result.warnings, "CONTROLLED_RULE_CONFLICT"],
      message: input.language === "en"
        ? "The applicable controlled sources contain a conflict that must be resolved by the document owner."
        : "Použitelné řízené zdroje obsahují rozpor, který musí posoudit gestor dokumentace.",
      missingInformation: input.language === "en"
        ? "No unambiguous governed rule is available."
        : "Není k dispozici jednoznačné ověřené pravidlo.",
    });
  }

  if (matching.length === 0) {
    return emptyResponse({
      conversationId: input.conversationId,
      language: input.language,
      context: baseContext,
      confidence: "insufficient_source",
      warnings: [...input.result.warnings, "NO_MATCHING_CONTROLLED_RULE"],
      message: input.language === "en"
        ? "No verified rule matching this question is effective for the selected date."
        : "K vybranému datu není účinné ověřené pravidlo, které by přesně odpovídalo tomuto dotazu.",
      missingInformation: input.language === "en"
        ? "A matching verified rule is missing."
        : "Chybí odpovídající ověřené pravidlo.",
    });
  }

  const citations = matching.map((item) => citationForRule(item.rule, input.result));
  const answer = controlledRuleAnswerText(matching.map((item) => item.rule), input.result, input.language);
  return {
    response_type: "answer",
    conversation_id: input.conversationId ?? `conv_controlled_${crypto.randomUUID().replaceAll("-", "")}`,
    answer,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      ...baseContext,
      controlled_rule_ids: matching.map((item) => item.rule.proposal.rule_id),
      controlled_rule_count: matching.length,
    },
    citations,
    follow_up_questions: input.language === "en"
      ? ["Which evidence is required?", "Which exceptions apply?"]
      : ["Jaké doklady jsou vyžadovány?", "Jaké výjimky se uplatní?"],
    suggested_actions: [],
    report_artifacts: [],
    confidence: matching.every((item) => item.rule.proposal.confidence >= 0.85) ? "high" : "medium",
    warnings: input.result.warnings,
    missing_information: null,
    recommended_action: null,
  };
}

function rankedRules(message: string, rules: ControlledRule[]) {
  const queryTokens = meaningfulTokens(message);
  return rules
    .map((rule) => ({ rule, score: ruleScore(rule, queryTokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.rule.authority_rank - left.rule.authority_rank);
}

function ruleScore(rule: ControlledRule, queryTokens: string[]) {
  const title = normalized(rule.proposal.title);
  const category = normalized(rule.proposal.category);
  const details = normalized([
    rule.proposal.normative_key,
    ...rule.proposal.conditions,
    ...rule.proposal.exceptions,
    ...rule.proposal.required_evidence,
    ...rule.proposal.responsible_roles,
  ].join(" "));
  let score = 0;
  for (const token of queryTokens) {
    if (title.includes(token)) score += 5;
    else if (category.includes(token)) score += 3;
    else if (details.includes(token)) score += 1;
  }
  if (/limit|castk|kolik|hran/.test(normalized(messageTokenBasis(queryTokens)))
    && /limit|threshold|castk/.test(`${title} ${category} ${details}`)) {
    score += 6;
  }
  return score;
}

function messageTokenBasis(tokens: string[]) {
  return tokens.join(" ");
}

function controlledRuleAnswerText(
  rules: ControlledRule[],
  result: ControlledRuleList,
  language: ResponseLanguage,
) {
  const heading = language === "en"
    ? `Verified rules effective on ${result.valid_on}:`
    : `Ověřená pravidla účinná k ${formatDate(result.valid_on, language)}:`;
  const lines = rules.map((rule) => {
    const value = formattedRuleValue(rule);
    const conditions = rule.proposal.conditions.filter(Boolean).slice(0, 2);
    const detail = conditions.length > 0 ? ` ${conditions.join(" ")}` : "";
    return `- **${rule.proposal.title}**${value ? `: **${value}**` : "."}${detail}`;
  });
  const stale = result.warnings.includes("SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE")
    ? language === "en"
      ? "\nThe source review date has passed; the document owner should confirm that it is still current."
      : "\nTermín revize zdroje uplynul; gestor má potvrdit jeho aktuálnost."
    : "";
  return [heading, ...lines].join("\n") + stale;
}

function formattedRuleValue(rule: ControlledRule) {
  const value = rule.proposal.value;
  if (value === null || value === undefined || value === "") return "";
  const rendered = typeof value === "number"
    ? new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(value)
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
  const suffix = [rule.proposal.currency, rule.proposal.unit]
    .filter((item, index, all): item is string => Boolean(item) && all.indexOf(item) === index)
    .join(" ");
  return `${rendered}${suffix ? ` ${suffix}` : ""}`;
}

function citationForRule(rule: ControlledRule, result: ControlledRuleList): Citation {
  const source = result.packages.find((item) => item.package_id === rule.package_id);
  return {
    document_id: rule.proposal.citation.document_id,
    document_version_id: rule.proposal.citation.document_version_id,
    document_title: source?.title ?? rule.proposal.title,
    version_label: source?.release_label ?? rule.proposal.citation.document_version_id,
    document_version: source?.release_label ?? rule.proposal.citation.document_version_id,
    section_path: rule.proposal.citation.section_path,
    page_number: rule.proposal.citation.page_number,
    chunk_id: rule.proposal.citation.chunk_id,
    valid_from: source?.effective_from ?? null,
    valid_to: source?.effective_to ?? null,
  };
}

function emptyResponse(input: {
  conversationId: string | null;
  language: ResponseLanguage;
  context: Record<string, unknown>;
  confidence: "insufficient_source" | "conflicting_sources";
  warnings: string[];
  message: string;
  missingInformation: string;
}): AssistantChatResponse {
  return {
    response_type: "no_answer",
    conversation_id: input.conversationId ?? `conv_controlled_${crypto.randomUUID().replaceAll("-", "")}`,
    answer: input.message,
    message: null,
    questions: [],
    why_needed: null,
    current_context: input.context,
    citations: [],
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: input.confidence,
    warnings: [...new Set(input.warnings)],
    missing_information: input.missingInformation,
    recommended_action: null,
  };
}

function explicitValidOn(message: string) {
  const iso = message.match(/\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);
  if (iso) return iso[0];
  const czech = message.match(/\b([0-2]?\d|3[01])\.\s*(0?\d|1[0-2])\.\s*(20\d{2})\b/);
  if (czech) {
    return `${czech[3]}-${String(Number(czech[2])).padStart(2, "0")}-${String(Number(czech[1])).padStart(2, "0")}`;
  }
  const year = message.match(/(?:v\s+roce|pro\s+rok|k\s+roku)\s+(20\d{2})\b/i);
  return year ? `${year[1]}-12-31` : null;
}

function meaningfulTokens(value: string) {
  return normalized(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !CZECH_STOP_WORDS.has(token));
}

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function contextString(context: Record<string, unknown>, key: string, alternate?: string) {
  for (const source of [context, objectValue(context.current_context)]) {
    const value = source[key] ?? (alternate ? source[alternate] : undefined);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatDate(value: string, language: ResponseLanguage) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(language === "en" ? "en-GB" : "cs-CZ", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}
