import type { AnswerMode } from "@/lib/types";
import { semanticRegistryRetrievalHintsForText } from "@/lib/director-copilot/semantic-registry";

import {
  answerModeForAssistantGoal,
  resolveAssistantUserGoal,
} from "./user-goal";

export const DOCUMENT_KNOWLEDGE_INTENT_VERSION = "document-knowledge-intent-1" as const;

export type DocumentKnowledgeIntent =
  | "general"
  | "procedure"
  | "resource"
  | "support_channel"
  | "owner"
  | "responsibility"
  | "deadline"
  | "obligation"
  | "policy";

export interface DocumentKnowledgeIntentResolution {
  version: typeof DOCUMENT_KNOWLEDGE_INTENT_VERSION;
  intent: DocumentKnowledgeIntent;
  answerMode: AnswerMode;
  taskOriented: boolean;
  explicit: boolean;
  inherited: boolean;
  retrievalHints: string[];
}

const INTENT_ANSWER_MODES: Record<Exclude<DocumentKnowledgeIntent, "general">, AnswerMode> = {
  procedure: "find_procedure",
  resource: "find_procedure",
  support_channel: "find_procedure",
  owner: "find_owner",
  responsibility: "find_responsibility",
  deadline: "extract_deadlines",
  obligation: "extract_obligations",
  policy: "normative_with_citations",
};

const INTENT_RETRIEVAL_HINTS: Record<Exclude<DocumentKnowledgeIntent, "general">, string[]> = {
  procedure: ["postup", "návod", "kroky", "podmínky"],
  resource: ["formulář", "žádost", "šablona", "vzor", "umístění"],
  support_channel: ["IT podpora", "hlášení problému", "incident", "servisní požadavek", "kontakt"],
  owner: ["gestor", "vlastník", "odpovědná role", "schvalovatel", "kontakt"],
  responsibility: ["odpovědnost", "kompetence", "role", "působnost"],
  deadline: ["lhůta", "termín", "doba", "účinnost", "periodicita"],
  obligation: ["povinnost", "požadavek", "doklady", "náležitosti", "podmínky"],
  policy: ["pravidlo", "interní předpis", "směrnice", "metodika", "platné znění"],
};

const SUPPORT_SIGNAL = /\b(problem\w*|nefung\w*|poruch\w*|chyb\w*|incident\w*|podpor\w*|helpdesk|service\s*desk)\b/;
const SUPPORT_CHANNEL_SIGNAL = /\b(kde|kam|komu|naps\w*|nahlas\w*|hlasi\w*|obrat\w*|kontakt\w*|podpor\w*|helpdesk|service\s*desk)\b/;
const RESOURCE_SIGNAL = /\b(formular\w*|sablon\w*|vzor\w*|zadost\w*|tiskopis\w*|manual\w*|priruck\w*|napoved\w*|odkaz\w*|soubor\w*|dokument\w*)\b/;
const RESOURCE_ACTION_SIGNAL = /\b(kde|najd\w*|stahn\w*|otevr\w*|zisk\w*|vypln\w*)\b/;
const OWNER_SIGNAL = /\b(?:komu|kam\s+se|na\s+koho|kontakt\w*|gestor\w*|vlastnik\w*|schvaluj\w*|odpovid\w*|resi\w*|spravuj\w*)\b|\bkdo\s+(?:je\s+)?(?:gestor\w*|vlastnik\w*|odpovedn\w*|schvaluj\w*|resi\w*|spravuj\w*)\b/;
const RESPONSIBILITY_SIGNAL = /\b(odpovednost\w*|kompetenc\w*|pusobnost\w*|za\s+co\s+odpovid\w*|co\s+ma\s+na\s+starost)\b/;
const DEADLINE_SIGNAL = /\b(?:do\s+kdy|od\s+kdy|jak\s+dlouho)\b|\bkdy\s+(?:musim|mame|ma|je|jsou|se)\b|\b(?:jaka|jaky|jake)\s+(?:je|jsou\s+)?(?:lhut\w*|termin\w*|periodicit\w*|platnost\w*|ucinnost\w*)\b/;
const OBLIGATION_SIGNAL = /\b(co\s+musim|kdo\s+mus\w*|kdo\s+je\s+povinen|co\s+je\s+treba|co\s+potrebuj\w*|jake\s+doklad\w*|jake\s+nalezitost\w*|povinnost\w*|pozadavk\w*)\b/;
const PROCEDURE_SIGNAL = /\b(postup\w*|navod\w*|krok\w*|(?:jak|kde|kam)\s+(?:(?:se|si|mam)\s+)?(?:nastav\w*|vypln\w*|pozad\w*|zaloz\w*|zmen\w*|udel\w*|zarid\w*|odevzd\w*|nahlas\w*|vyuct\w*|objedn\w*|zisk\w*|prihlas\w*|odhlas\w*|evid\w*|zapis\w*|odesl\w*|posl\w*|pouz\w*|rezerv\w*))\b/;
const POLICY_SIGNAL = /\b(co\s+plati|jake\s+pravidl\w*|podle\s+(?:smernic\w*|predpis\w*|metodik\w*|zakon\w*)|co\s+(?:stanovi|uklada)\s+(?:smernic\w*|predpis\w*|metodik\w*|zakon\w*))\b/;
const REFERENTIAL_FOLLOW_UP_SIGNAL = /^(?:a\s+(?:co|jak|kde|kdo|komu|kam|kdy|proc|ktery|ktera|ktere|kolik)|co\s+(?:s\s+tim|to|dale)|jak\s+(?:je\s+)?to)\b|\b(?:to|toho|tomu|tento|tato|teto|ten|jeho|jeji|jejich|nich)\b/;

const GENERIC_FOLLOW_UP_TERMS = new Set([
  "co", "jak", "jaka", "jake", "jaky", "kam", "kde", "kdo", "kdy", "komu", "mam", "mame", "musim", "potrebuji",
]);
const GENERIC_FOLLOW_UP_TERM_RE = /^(?:doklad|formular|gestor|kontakt|krok|lhut|manual|navod|odpovednost|povinnost|pravidl|priruck|schvalovatel|termin|vlastnik|evid|nastav|nahlas|objedn|odevzd|odesl|odhlas|pouz|pozad|prihlas|rezerv|vypln|vyuct|zaloz|zisk|zmen)\w*$/;

const DOMAIN_RETRIEVAL_HINTS: Array<{ signal: RegExp; hints: string[] }> = [
  {
    signal: /\b(dovolen\w*|voln\w*|nepritomnost\w*)\b/,
    hints: ["dovolená", "čerpání dovolené", "žádost o dovolenou", "nepřítomnost"],
  },
  {
    signal: /\b(zahranicn\w*\s+cest\w*|sluzebn\w*\s+cest\w*|pracovn\w*\s+cest\w*|cestovn\w*\s+prikaz\w*|cestak\w*)\b/,
    hints: ["služební cesta", "zahraniční pracovní cesta", "cestovní příkaz", "vyúčtování cesty"],
  },
  {
    signal: /\b(it|informacn\w*\s+technolog\w*|pocitac\w*|tiskarn\w*|aplikac\w*)\b/,
    hints: ["IT podpora", "hlášení incidentu", "servisní požadavek"],
  },
];

export function resolveDocumentKnowledgeIntent(
  message: string,
  context: Record<string, unknown> = {},
): DocumentKnowledgeIntentResolution {
  const normalized = normalizeDocumentKnowledgeText(message);
  const detectedIntent = explicitDocumentKnowledgeIntent(normalized);
  const previousIntent = documentKnowledgeIntentFromContext(context);
  const inherited = Boolean(previousIntent && isDocumentKnowledgeFollowUp(normalized, detectedIntent));
  const intent = detectedIntent === "general" && inherited
    ? previousIntent ?? "general"
    : detectedIntent;
  const goal = resolveAssistantUserGoal(message).goal;
  const answerMode = intent === "general"
    ? answerModeForAssistantGoal(goal)
    : INTENT_ANSWER_MODES[intent];
  const hints = intent === "general" ? [] : [...INTENT_RETRIEVAL_HINTS[intent]];
  if (inherited && previousIntent && previousIntent !== "general" && previousIntent !== intent) {
    hints.push(...INTENT_RETRIEVAL_HINTS[previousIntent]);
  }
  for (const domain of DOMAIN_RETRIEVAL_HINTS) {
    if (domain.signal.test(normalized)) hints.push(...domain.hints);
  }
  hints.push(...semanticRegistryRetrievalHintsForText(message, 4));
  return {
    version: DOCUMENT_KNOWLEDGE_INTENT_VERSION,
    intent,
    answerMode,
    taskOriented: intent !== "general",
    explicit: detectedIntent !== "general",
    inherited,
    retrievalHints: [...new Set(hints)].slice(0, 12),
  };
}

function explicitDocumentKnowledgeIntent(normalized: string): DocumentKnowledgeIntent {
  if (SUPPORT_SIGNAL.test(normalized) && SUPPORT_CHANNEL_SIGNAL.test(normalized)) return "support_channel";
  if (RESOURCE_SIGNAL.test(normalized) && RESOURCE_ACTION_SIGNAL.test(normalized)) return "resource";
  if (RESPONSIBILITY_SIGNAL.test(normalized)) return "responsibility";
  if (OWNER_SIGNAL.test(normalized)) return "owner";
  if (DEADLINE_SIGNAL.test(normalized)) return "deadline";
  if (OBLIGATION_SIGNAL.test(normalized)) return "obligation";
  if (PROCEDURE_SIGNAL.test(normalized)) return "procedure";
  if (POLICY_SIGNAL.test(normalized)) return "policy";
  return "general";
}

function documentKnowledgeIntentFromContext(
  context: Record<string, unknown>,
): DocumentKnowledgeIntent | null {
  const state = context.document_knowledge_state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const intent = (state as Record<string, unknown>).intent;
  return isDocumentKnowledgeIntent(intent) ? intent : null;
}

function isDocumentKnowledgeFollowUp(
  normalized: string,
  detectedIntent: DocumentKnowledgeIntent,
): boolean {
  if (REFERENTIAL_FOLLOW_UP_SIGNAL.test(normalized)) return true;
  if (detectedIntent === "general") return false;
  const subjectTerms = normalized
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .filter((term) => !GENERIC_FOLLOW_UP_TERMS.has(term))
    .filter((term) => !GENERIC_FOLLOW_UP_TERM_RE.test(term));
  return subjectTerms.length === 0;
}

function isDocumentKnowledgeIntent(value: unknown): value is DocumentKnowledgeIntent {
  return typeof value === "string" && [
    "general",
    "procedure",
    "resource",
    "support_channel",
    "owner",
    "responsibility",
    "deadline",
    "obligation",
    "policy",
  ].includes(value);
}

function normalizeDocumentKnowledgeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
