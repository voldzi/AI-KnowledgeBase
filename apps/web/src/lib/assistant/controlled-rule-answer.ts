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

export function currentControlledRuleDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

type ControlledRuleSourceScope = "statutory" | "internal" | "combined";

const PUBLIC_PROCUREMENT_RE = /(?:veřejn(?:á|é|ých|ou)\s+zakáz|verejn(?:a|e|ych|ou)\s+zakaz|\bvzmr\b|zadáván(?:í|i)\s+zakáz|zadavani\s+zakaz|průzkum\s+trhu|pruzkum\s+trhu|elektronick\w*\s+tržišt|elektronick\w*\s+trzist|profil\w*\s+zadavatele|registr\w*\s+smluv|přím\w*\s+nákup|prim\w*\s+nakup|public\s+procurement)/i;
const CONTROLLED_RULE_QUESTION_RE = /(?:limit|částk|castk|hran(?:ice|ičn)|do\s+kolika|od\s+kolika|kolik|povinnost|požad|pozad|musí|musi|stanov|uprav|obsah|schvaluj|výjimk|vyjimk|nabídk|nabidk|doklad|lhůt|lhut|postup|pravidl|režim|rezim|zákon|zakon|legislativ|právn|pravn)/i;
const LEGAL_SOURCE_RE = /(?:zákon|zakon|zákonn|zakonn|legislativ|právn|pravn)/i;
const INTERNAL_SOURCE_RE = /(?:směrnic|smernic|intern\w*(?:\s+(?:pravidl|limit|postup|směrnic|smernic))?|vnitřn|vnitrn)/i;
const EXPLICIT_NON_PROCUREMENT_LEGAL_TOPIC_RE = /(?:\bnis\s*2?\b|\bnis2\b|kybernetick\w*\s+bezpečnost|\bgdpr\b|ochran\w*\s+osobn\w*\s+údaj|\bai\s+act\b|akt\w*\s+o\s+uměl\w*\s+inteligenc)/i;
const INTERNAL_RULE_SOURCE_TYPES = new Set<ControlledRule["source_type"]>([
  "internal_directive",
  "internal_instruction",
]);

const CONSUMER_BLOCKING_WARNINGS = new Set([
  "POTENTIAL_RULE_CONFLICT_REQUIRES_GESTOR_REVIEW",
  "CONTROLLED_RULE_PACKAGE_COORDINATES_MISMATCH",
  "CONTROLLED_RULE_CITATION_OUTSIDE_PACKAGE",
  "CONTROLLED_RULE_EDIT_INVALID",
  "CONTROLLED_RULE_NORMATIVE_KEY_UNKNOWN",
  "CONTROLLED_RULE_NORMATIVE_KEY_CATEGORY_MISMATCH",
  "SOURCE_REVIEW_DATE_INVALID",
]);

const RULE_LABELS_CS: Record<string, string> = {
  "public_procurement.vzmr.supplies_services.threshold": "Limit VZMR pro dodávky a služby",
  "public_procurement.vzmr.works.threshold": "Limit VZMR pro stavební práce",
  "public_procurement.internal_category_1.upper_threshold": "Horní limit interní kategorie VZMR I",
  "public_procurement.direct_purchase.threshold": "Limit přímého nákupu",
  "public_procurement.market_research.threshold": "Limit průzkumu trhu",
  "public_procurement.marketplace.threshold": "Limit elektronického tržiště",
  "public_procurement.central_evidence.threshold": "Limit centrální evidence veřejných zakázek",
  "public_procurement.publication.contract_register.threshold": "Limit zveřejnění v registru smluv",
  "public_procurement.publication.contracting_profile.threshold": "Limit zveřejnění na profilu zadavatele",
  "public_procurement.supplier_quotes.minimum_count": "Minimální počet nabídek",
  "public_procurement.nen.registration.required": "Povinnost použít NEN",
  "public_procurement.contract.written_form.threshold": "Limit písemné smlouvy",
  "public_procurement.contract.amendment.approval_threshold": "Limit schválení dodatku",
  "public_procurement.approval.workflow": "Schvalovací postup",
  "public_procurement.exception.conditions": "Podmínky výjimky",
  "public_procurement.documentation.required": "Povinná dokumentace",
  "public_procurement.retention.period": "Doba uchování dokumentace",
};

const VZMR_STATUTORY_RULE_KEYS = [
  "public_procurement.vzmr.supplies_services.threshold",
  "public_procurement.vzmr.works.threshold",
] as const;
const VZMR_STATUTORY_RULE_KEY_SET = new Set<string>(VZMR_STATUTORY_RULE_KEYS);
const VZMR_SUPPLEMENTAL_RULE_KEYS = [
  "public_procurement.internal_category_1.upper_threshold",
  "public_procurement.direct_purchase.threshold",
  "public_procurement.market_research.threshold",
  "public_procurement.marketplace.threshold",
  "public_procurement.central_evidence.threshold",
  "public_procurement.publication.contract_register.threshold",
  "public_procurement.publication.contracting_profile.threshold",
  "public_procurement.supplier_quotes.minimum_count",
  "public_procurement.nen.registration.required",
  "public_procurement.contract.written_form.threshold",
  "public_procurement.approval.workflow",
  "public_procurement.documentation.required",
] as const;

const CZECH_STOP_WORDS = new Set([
  "a", "ale", "co", "do", "je", "jaky", "jake", "jakou", "kdo", "ma",
  "na", "nebo", "od", "podle", "pro", "se", "smernice", "ve", "verejna",
  "verejne", "verejnych", "verejnou", "zakazka", "zakazky", "zakazek",
]);

export function controlledRuleIntentFromMessage(
  message: string,
  context: Record<string, unknown> = {},
  now = new Date(),
): ControlledRuleIntent | null {
  const contextDomain = contextString(
    context,
    "controlled_rule_domain",
    "controlledRuleDomain",
  );
  const continuingControlledRules =
    contextString(context, "answer_source") === "controlled_rules"
    && contextDomain === CONTROLLED_RULE_DOMAIN_PUBLIC_PROCUREMENT
    && !hasExplicitNonProcurementLegalTopic(message);
  const hasDomain = PUBLIC_PROCUREMENT_RE.test(message) || continuingControlledRules;
  if (!hasDomain || !CONTROLLED_RULE_QUESTION_RE.test(message)) {
    return null;
  }
  return {
    domain: CONTROLLED_RULE_DOMAIN_PUBLIC_PROCUREMENT,
    validOn: explicitValidOn(message, now) ?? contextString(context, "controlled_rule_valid_on"),
  };
}

export function hasExplicitNonProcurementLegalTopic(message: string): boolean {
  return EXPLICIT_NON_PROCUREMENT_LEGAL_TOPIC_RE.test(message);
}

export function buildControlledRuleAssistantResponse(input: {
  message: string;
  conversationId: string | null;
  context: Record<string, unknown>;
  language: ResponseLanguage;
  result: ControlledRuleList;
}): AssistantChatResponse {
  const sourceScope = controlledRuleSourceScope(input.message);
  const blockingWarnings = input.result.warnings.filter((warning) =>
    CONSUMER_BLOCKING_WARNINGS.has(warning)
  );
  if (blockingWarnings.length > 0) {
    return emptyResponse({
      conversationId: input.conversationId,
      language: input.language,
      context: {
        ...input.context,
        answer_source: "controlled_rules",
        controlled_rule_domain: input.result.domain,
        controlled_rule_valid_on: input.result.valid_on,
      },
      confidence: "conflicting_sources",
      warnings: [...input.result.warnings, "CONTROLLED_RULE_CONFLICT"],
      message: input.language === "en"
        ? "The governed rule set is not decision-ready and must be reviewed by the document owner."
        : "Ověřená pravidla nejsou v rozhodnutelném stavu a musí je posoudit gestor dokumentace.",
      missingInformation: input.language === "en"
        ? "A conflict-free governed rule set is unavailable."
        : "Chybí bezrozporná sada ověřených pravidel.",
    });
  }
  const eligible = input.result.rules.filter(
    (rule) => rule.consumer_eligible
      && ["accepted", "edited"].includes(rule.verification_status)
      && ["authoritative", "supplemental"].includes(rule.precedence_status)
      && ruleMatchesNormativeAuthority(rule)
      && ruleMatchesSourceScope(rule, sourceScope),
  );
  const matchingConflicts = rankedRules(input.message, input.result.rules.filter(
    (rule) => rule.precedence_status === "conflict"
      && ruleMatchesSourceScope(rule, sourceScope),
  ));
  const matching = selectMatchingRules(input.message, eligible, sourceScope);
  const baseContext = {
    ...input.context,
    answer_source: "controlled_rules",
    controlled_rule_domain: input.result.domain,
    controlled_rule_valid_on: input.result.valid_on,
    controlled_rule_source_scope: sourceScope,
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

  const requiredStatutoryKeys = requiredStatutoryKeysForQuestion(
    input.message,
    sourceScope,
  );
  const availableStatutoryKeys = new Set(
    eligible
      .filter(isStatutoryRule)
      .map((rule) => rule.proposal.normative_key),
  );
  const missingStatutoryKeys = [...requiredStatutoryKeys].filter(
    (key) => !availableStatutoryKeys.has(key),
  );
  if (missingStatutoryKeys.length > 0) {
    return emptyResponse({
      conversationId: input.conversationId,
      language: input.language,
      context: {
        ...baseContext,
        controlled_rule_missing_statutory_keys: missingStatutoryKeys,
      },
      confidence: "insufficient_source",
      warnings: [
        ...input.result.warnings,
        "REQUIRED_STATUTORY_RULE_COVERAGE_MISSING",
      ],
      message: input.language === "en"
        ? "The authoritative statutory rules required for this question are not complete for the selected date. Internal rules were not used as a substitute."
        : "Pro vybrané datum není úplná sada závazných zákonných pravidel potřebná pro tento dotaz. Interní pravidla jsem nepoužil jako náhradu.",
      missingInformation: input.language === "en"
        ? "One or more required statutory rules are missing."
        : "Chybí jedno nebo více požadovaných zákonných pravidel.",
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
  const answer = controlledRuleAnswerText(
    matching.map((item) => item.rule),
    input.result,
    input.language,
    sourceScope,
    input.message,
  );
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
      controlled_rule_normative_keys: matching.map((item) => item.rule.proposal.normative_key),
      controlled_rule_source_types: [...new Set(matching.map((item) => item.rule.source_type))],
      controlled_rule_count: matching.length,
    },
    citations,
    follow_up_questions: controlledRuleFollowUps(matching.map((item) => item.rule), input.language),
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
  const preferredKeys = targetedNormativeKeys(message);
  return rules
    .map((rule) => ({
      rule,
      score: ruleScore(rule, queryTokens)
        + (preferredKeys.has(rule.proposal.normative_key) ? 40 : 0),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.rule.authority_rank - left.rule.authority_rank);
}

function selectMatchingRules(
  message: string,
  rules: ControlledRule[],
  sourceScope: ControlledRuleSourceScope,
) {
  const preferredKeys = targetedNormativeKeys(message);
  const normalizedMessage = normalized(message);
  const allLimits = /\b(?:jake|ktere|vsechny|prehled|seznam)\b/.test(normalizedMessage)
    && /\b(?:limit|castk|hranic)\w*\b/.test(normalizedMessage);
  const candidates = preferredKeys.size > 0
    ? rules.filter((rule) => preferredKeys.has(rule.proposal.normative_key))
    : allLimits
      ? rules.filter((rule) => rule.proposal.category === "financial_limit")
      : rules;
  const ranked = uniqueRankedRules(rankedRules(message, candidates));
  const sourceOrdered = sourceScope === "combined"
    ? [
        ...ranked.filter((item) => isStatutoryRule(item.rule)),
        ...ranked.filter((item) => !isStatutoryRule(item.rule)),
      ]
    : ranked;
  if (allLimits) return sourceOrdered.slice(0, sourceScope === "combined" ? 14 : 10);
  if (preferredKeys.size > 0) {
    const limit = isBroadVzmrOverview(message) || isTransactionalVzmrAssessment(message) ? 14 : 4;
    return sourceOrdered.slice(0, Math.min(preferredKeys.size, limit));
  }
  const topScore = sourceOrdered[0]?.score ?? 0;
  return sourceOrdered
    .filter((item) => item.score >= Math.max(4, Math.ceil(topScore * 0.65)))
    .slice(0, 4);
}

function uniqueRankedRules<T extends { rule: ControlledRule }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.rule.proposal.normative_key;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function targetedNormativeKeys(message: string) {
  const value = normalized(message);
  const keys = new Set<string>();
  const asksForLaw = LEGAL_SOURCE_RE.test(message);
  const asksForInternalRule = INTERNAL_SOURCE_RE.test(message);
  const asksForBroadLimits = isBroadLimitOverview(message);
  if (/pruzkum\w*\s+trh/.test(value)) {
    keys.add("public_procurement.market_research.threshold");
    if (/nabid|dodavatel|kolik/.test(value)) {
      keys.add("public_procurement.supplier_quotes.minimum_count");
    }
    if (/vyjim/.test(value)) keys.add("public_procurement.exception.conditions");
    if (/kdy|postup|schval/.test(value)) keys.add("public_procurement.approval.workflow");
  }
  if (/nabid|dodavatel/.test(value)) {
    keys.add("public_procurement.supplier_quotes.minimum_count");
  }
  if (/elektronick\w*\s+trzist/.test(value)) {
    keys.add("public_procurement.marketplace.threshold");
  }
  if (/\bnen\b/.test(value)) keys.add("public_procurement.nen.registration.required");
  if (/centraln\w*\s+evidenc/.test(value)) {
    keys.add("public_procurement.central_evidence.threshold");
  }
  if (/registr\w*\s+smluv/.test(value)) {
    keys.add("public_procurement.publication.contract_register.threshold");
  }
  if (/profil\w*\s+zadavatel/.test(value)) {
    keys.add("public_procurement.publication.contracting_profile.threshold");
  }
  if (/pisemn\w*\s+smlouv|najemn\w*\s+smlouv/.test(value)) {
    keys.add("public_procurement.contract.written_form.threshold");
  }
  if (/dodat\w*.*schval|schval\w*.*dodat/.test(value)) {
    keys.add("public_procurement.contract.amendment.approval_threshold");
  }
  if (/uchov|archiv|retenc/.test(value)) {
    keys.add("public_procurement.retention.period");
  }
  if (/prim\w*\s+nakup/.test(value)) {
    keys.add("public_procurement.direct_purchase.threshold");
  }
  if (/prvn\w*\s+kategor|(?:^|\s)1\.?(?:\s+|$)kategor/.test(value)) {
    keys.add("public_procurement.internal_category_1.upper_threshold");
  }
  const broadVzmrOverview = isBroadVzmrOverview(message);
  const namesVzmrInFull = /verejn\w*\s+zakaz\w*\s+maleh\w*\s+rozsah/.test(value);
  if (((/\bvzmr\b/.test(value) || namesVzmrInFull) && !asksForInternalRule) || asksForLaw) {
    const asksForWorks = /stavebn/.test(value);
    const asksForSuppliesOrServices = /dodav|sluzb/.test(value);
    if (asksForWorks) {
      keys.add("public_procurement.vzmr.works.threshold");
    }
    if (asksForSuppliesOrServices) {
      keys.add("public_procurement.vzmr.supplies_services.threshold");
    }
    if (!asksForWorks && !asksForSuppliesOrServices) {
      for (const key of VZMR_STATUTORY_RULE_KEYS) keys.add(key);
    }
  }
  if (isTransactionalVzmrAssessment(message)) {
    if (/stavebn/.test(value)) {
      keys.add("public_procurement.vzmr.works.threshold");
    } else {
      keys.add("public_procurement.vzmr.supplies_services.threshold");
    }
  }
  if (isTransactionalVzmrAssessment(message) && /krok|postup|smernic|intern/.test(value)) {
    keys.add("public_procurement.market_research.threshold");
    keys.add("public_procurement.supplier_quotes.minimum_count");
    keys.add("public_procurement.marketplace.threshold");
    keys.add("public_procurement.central_evidence.threshold");
    keys.add("public_procurement.contract.written_form.threshold");
    keys.add("public_procurement.approval.workflow");
    keys.add("public_procurement.documentation.required");
  }
  if ((broadVzmrOverview && !asksForLaw)
    || (asksForInternalRule && /\bvzmr\b/.test(value))
    || (asksForLaw && asksForInternalRule && asksForBroadLimits)) {
    for (const key of VZMR_SUPPLEMENTAL_RULE_KEYS) keys.add(key);
  }
  if (/vyjim/.test(value)) keys.add("public_procurement.exception.conditions");
  if (/povinn\w*\s+dokument|jake\s+doklad/.test(value)) {
    keys.add("public_procurement.documentation.required");
  }
  return keys;
}

function isBroadLimitOverview(message: string): boolean {
  const value = normalized(message);
  return /\b(?:jake|ktere|vsechny|prehled|seznam)\b/.test(value)
    && /\b(?:limit|castk|hranic)\w*\b/.test(value);
}

function isBroadVzmrOverview(message: string): boolean {
  const value = normalized(message);
  if (!/\bvzmr\b/.test(value)) return false;
  if (LEGAL_SOURCE_RE.test(message) || INTERNAL_SOURCE_RE.test(message)) return false;
  const specificTopic = /stavebn|dodav|sluzb|pruzkum|nabid|dodavatel|trzist|\bnen\b|centraln\w*\s+evidenc|registr\w*\s+smluv|profil\w*\s+zadavatel|pisemn\w*\s+smlouv|dodat|uchov|archiv|retenc|prim\w*\s+nakup|vyjim|doklad/.test(value);
  return !specificTopic;
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
  sourceScope: ControlledRuleSourceScope,
  message: string,
) {
  const statutoryRules = rules.filter(isStatutoryRule);
  const internalRules = rules.filter((rule) => !isStatutoryRule(rule));
  const sections: string[] = [];
  const assessment = controlledRuleScenarioAssessment(rules, message, language);
  if (assessment) sections.push(assessment, "");
  if (statutoryRules.length > 0) {
    sections.push(
      language === "en"
        ? `Statutory limits effective on ${result.valid_on}:`
        : `Zákonné limity účinné k ${formatDate(result.valid_on, language)}:`,
      ...statutoryRules.map((rule) => controlledRuleLine(rule, language)),
    );
  }
  if (internalRules.length > 0) {
    if (sections.length > 0) sections.push("");
    sections.push(
      sourceScope === "internal"
        ? language === "en"
          ? `Internal rules effective on ${result.valid_on}:`
          : `Interní pravidla účinná k ${formatDate(result.valid_on, language)}:`
        : language === "en"
          ? "Supplementary internal rules:"
          : "Doplňující interní pravidla:",
      ...internalRules.map((rule) => controlledRuleLine(rule, language)),
    );
  }
  const stale = result.warnings.includes("SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE")
    ? language === "en"
      ? "\nThe source review date has passed; the document owner should confirm that it is still current."
      : "\nTermín revize zdroje uplynul; gestor má potvrdit jeho aktuálnost."
    : "";
  return sections.join("\n") + stale;
}

function controlledRuleLine(rule: ControlledRule, language: ResponseLanguage) {
  const value = formattedRuleValue(rule);
  const title = ruleTitle(rule, language);
  const fallback = conciseText(rule.proposal.conditions[0] ?? rule.proposal.title);
  return `- **${title}:** ${value ? `**${value}**` : fallback}`;
}

function isStatutoryRule(rule: ControlledRule) {
  return rule.source_type === "law"
    || rule.source_type === "implementing_regulation";
}

function ruleMatchesNormativeAuthority(rule: ControlledRule): boolean {
  if (!VZMR_STATUTORY_RULE_KEY_SET.has(rule.proposal.normative_key)) return true;
  return isStatutoryRule(rule);
}

function requiredStatutoryKeysForQuestion(
  message: string,
  sourceScope: ControlledRuleSourceScope,
): Set<string> {
  if (sourceScope === "internal") return new Set();
  return new Set(
    [...targetedNormativeKeys(message)].filter((key) =>
      VZMR_STATUTORY_RULE_KEY_SET.has(key)
    ),
  );
}

function controlledRuleSourceScope(message: string): ControlledRuleSourceScope {
  const asksForLaw = LEGAL_SOURCE_RE.test(message);
  const asksForInternalRule = INTERNAL_SOURCE_RE.test(message);
  if (asksForInternalRule && isTransactionalVzmrAssessment(message)) return "combined";
  if (asksForLaw && !asksForInternalRule) return "statutory";
  if (asksForInternalRule && !asksForLaw) return "internal";
  return "combined";
}

function ruleMatchesSourceScope(
  rule: ControlledRule,
  sourceScope: ControlledRuleSourceScope,
): boolean {
  if (sourceScope === "statutory") return isStatutoryRule(rule);
  if (sourceScope === "internal") return INTERNAL_RULE_SOURCE_TYPES.has(rule.source_type);
  return true;
}

function controlledRuleFollowUps(rules: ControlledRule[], language: ResponseLanguage) {
  const hasStatutoryRule = rules.some(isStatutoryRule);
  if (language === "en") {
    return hasStatutoryRule
      ? ["Which internal procedures supplement these limits?", "Which evidence is required?"]
      : ["Which statutory VZMR limits apply?", "Which exceptions apply?"];
  }
  return hasStatutoryRule
    ? ["Jaké interní postupy tyto limity doplňují?", "Jaké doklady jsou vyžadovány?"]
    : ["Jaké zákonné limity VZMR platí?", "Jaké výjimky se uplatní?"];
}

function formattedRuleValue(rule: ControlledRule) {
  const value = rule.proposal.value;
  if (value === null || value === undefined || value === "") return "";
  const key = rule.proposal.normative_key;
  if (typeof value === "number" && key === "public_procurement.supplier_quotes.minimum_count") {
    return `nejméně ${value} ${czechOfferUnit(value)}`;
  }
  if (typeof value === "number" && key === "public_procurement.retention.period") {
    return `${value} ${czechYearUnit(value)}`;
  }
  const rendered = typeof value === "number"
    ? new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(value)
    : typeof value === "string"
      ? conciseText(value)
      : JSON.stringify(value);
  const currency = normalizedCurrency(rule.proposal.currency, rule.proposal.unit);
  const unit = humanUnit(rule.proposal.unit, rule.proposal.currency);
  const vat = vatLabel(rule.proposal.vat_basis);
  return [rendered, currency, unit, vat].filter(Boolean).join(" ");
}

function ruleTitle(rule: ControlledRule, language: ResponseLanguage) {
  if (language === "cs") {
    return RULE_LABELS_CS[rule.proposal.normative_key] ?? conciseText(rule.proposal.title, 120);
  }
  return conciseText(rule.proposal.title, 120);
}

function normalizedCurrency(currency: string | null, unit: string | null) {
  const value = normalized(currency ?? "");
  const unitValue = normalized(unit ?? "");
  return value === "czk" || value === "kc" || unitValue === "czk" ? "Kč" : currency ?? "";
}

function humanUnit(unit: string | null, currency: string | null) {
  if (!unit) return "";
  const value = normalized(unit);
  if (["currency", "czk", "count", "let", "year", "years"].includes(value)) return "";
  if (currency && normalized(currency) === value) return "";
  return unit;
}

function vatLabel(value: string) {
  if (["including_vat", "with_vat"].includes(value)) return "včetně DPH";
  if (["excluding_vat", "without_vat"].includes(value)) return "bez DPH";
  return "";
}

function czechOfferUnit(value: number) {
  if (value === 1) return "nabídku";
  if (value >= 2 && value <= 4) return "nabídky";
  return "nabídek";
}

function czechYearUnit(value: number) {
  if (value === 1) return "rok";
  if (value >= 2 && value <= 4) return "roky";
  return "let";
}

function conciseText(value: string, limit = 320) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1).trimEnd()}…`;
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

function explicitValidOn(message: string, now: Date) {
  const iso = message.match(/\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);
  if (iso) return iso[0];
  const czech = message.match(/\b([0-2]?\d|3[01])\.\s*(0?\d|1[0-2])\.\s*(20\d{2})\b/);
  if (czech) {
    return `${czech[3]}-${String(Number(czech[2])).padStart(2, "0")}-${String(Number(czech[1])).padStart(2, "0")}`;
  }
  const year = message.match(/(?:v\s+roce|pro\s+rok|k\s+roku)\s+(20\d{2})\b/i);
  if (!year) return null;
  const currentDate = currentControlledRuleDate(now);
  return year[1] === currentDate.slice(0, 4) ? currentDate : `${year[1]}-12-31`;
}

function isTransactionalVzmrAssessment(message: string): boolean {
  const value = normalized(message);
  return /\bvzmr\b|verejn\w*\s+zakaz\w*\s+maleh\w*\s+rozsah/.test(value)
    && /(?:\d|milion|tisic)/.test(value)
    && /(?:nakup|dodav|sluzb|stavebn|porizeni|zakazk)/.test(value);
}

function controlledRuleScenarioAssessment(
  rules: ControlledRule[],
  message: string,
  language: ResponseLanguage,
): string | null {
  if (language !== "cs") return null;
  const amount = monetaryAmountFromMessage(message);
  if (amount === null) return null;
  const query = normalized(message);
  const key = /stavebn/.test(query)
    ? "public_procurement.vzmr.works.threshold"
    : /dodav|sluzb|nakup|porizeni/.test(query)
      ? "public_procurement.vzmr.supplies_services.threshold"
      : null;
  if (!key) return null;
  const threshold = rules.find((rule) => (
    rule.proposal.normative_key === key
    && isStatutoryRule(rule)
    && typeof rule.proposal.value === "number"
  ));
  if (!threshold || typeof threshold.proposal.value !== "number") return null;
  const amountText = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(amount);
  const thresholdText = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(
    threshold.proposal.value,
  );
  const category = key.endsWith("works.threshold") ? "stavební práce" : "dodávky a služby";
  const comparison = amount <= threshold.proposal.value
    ? `nepřekračuje zákonný limit ${thresholdText} Kč a z hlediska tohoto limitu spadá do VZMR`
    : `překračuje zákonný limit ${thresholdText} Kč a z hlediska tohoto limitu nespadá do VZMR`;
  return `**Posouzení uvedené hodnoty:** ${amountText} Kč pro ${category} ${comparison}. `
    + "Jde o posouzení podle finančního limitu; konkrétní postup mohou ovlivnit další zákonné podmínky a výjimky.";
}

function monetaryAmountFromMessage(message: string): number | null {
  const value = normalized(message).replaceAll("\u00a0", " ");
  const match = value.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(milionu|miliony|milion|mil\.?|tisice|tisicu|tisic|tis\.?)?\s*kc\b/);
  if (!match) return null;
  const raw = match[1]!.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const multiplier = match[2]?.startsWith("mil") ? 1_000_000
    : match[2]?.startsWith("tis") ? 1_000
    : 1;
  return parsed * multiplier;
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
