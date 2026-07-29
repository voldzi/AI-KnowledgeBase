import "server-only";

import { createHash } from "node:crypto";

import type { AklConfig } from "@/lib/api/config";
import { getDirectorCopilotConfig } from "@/lib/api/config";
import { resolveConversationQuery } from "@/lib/director-copilot/query-state";
import { classifyDirectorCopilotV2Intent } from "@/lib/director-copilot-v2/intent-router";
import { pinnedDirectorCopilotV2Catalog } from "@/lib/director-copilot-v2/manifest-catalog";
import { buildDirectorCopilotV2Plan } from "@/lib/director-copilot-v2/planner";
import type { DirectorCopilotIntent } from "@/lib/director-copilot-v2/shared";
import type { AklLanguage } from "@/lib/language";
import type {
  ApiRequestContext,
  AssistantConversationListItem,
  AssistantSuggestionsResponse,
} from "@/lib/types";

const MAX_SUGGESTIONS = 4;
const MAX_HISTORY_CONVERSATIONS = 50;
const HISTORY_LOOKBACK_DAYS = 180;
const RECENT_PROMPT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1_000;

type SuggestionCadence =
  | "neutral"
  | "week_start"
  | "week_end"
  | "month_start"
  | "month_end"
  | "quarter_end";

interface SuggestionTemplate {
  id: string;
  kind: "director_copilot_v2" | "registry_documents";
  intent: DirectorCopilotIntent | null;
  label: string;
  prompt: string;
  domain: string;
  baseScore: number;
  cadence: SuggestionCadence[];
}

interface SuggestionHistoryProfile {
  intentWeights: Map<DirectorCopilotIntent, number>;
  documentWeight: number;
  recentPromptKeys: Set<string>;
}

export interface PersonalizedSuggestionInput {
  context: ApiRequestContext;
  config: AklConfig;
  conversations?: AssistantConversationListItem[];
  language?: AklLanguage;
  now?: Date;
  limit?: number;
}

/**
 * Builds start-of-thread suggestions from the current access projection and
 * privacy-bounded features derived from the subject's own conversation history.
 * It does not call an LLM or treat a suggestion as an authorization claim;
 * execution always revalidates the current access projection.
 */
export async function personalizedAssistantSuggestions(
  input: PersonalizedSuggestionInput,
): Promise<AssistantSuggestionsResponse> {
  const language = input.language ?? "cs";
  const now = input.now ?? new Date();
  const profile = historyProfile(
    input.conversations ?? [],
    input.context.subjectId,
    now,
  );
  const directorEnabled = getDirectorCopilotConfig(input.config).enabled;
  const catalog = pinnedDirectorCopilotV2Catalog();
  const candidates = suggestionTemplates(language, now)
    .filter((template) => (
      template.kind === "registry_documents"
        ? canQueryDocuments(input.context)
        : directorEnabled && directorTemplateAuthorized(
            template,
            input.context,
            catalog,
            now,
            language,
          )
    ))
    .map((template) => ({
      template,
      score: scoreTemplate(template, profile, now),
    }))
    .sort((left, right) => (
      right.score - left.score
      || left.template.id.localeCompare(right.template.id)
    ));

  return {
    suggestions: diversifiedSuggestions(
      candidates,
      Math.min(Math.max(input.limit ?? MAX_SUGGESTIONS, 1), MAX_SUGGESTIONS),
    ).map(({ template }) => ({
      label: template.label,
      prompt: template.prompt,
      domain: template.domain,
      audience: "authorized_user",
    })),
  };
}

export function suggestionTemplatesForTesting(
  language: AklLanguage = "cs",
  now = new Date(),
): ReadonlyArray<SuggestionTemplate> {
  return suggestionTemplates(language, now);
}

function historyProfile(
  conversations: AssistantConversationListItem[],
  subjectId: string,
  now: Date,
): SuggestionHistoryProfile {
  const intentWeights = new Map<DirectorCopilotIntent, number>();
  const recentPromptKeys = new Set<string>();
  let documentWeight = 0;

  const selected = conversations
    .filter((conversation) => conversation.user_id === subjectId)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, MAX_HISTORY_CONVERSATIONS);
  for (const conversation of selected) {
    for (const signal of conversation.suggestion_signals ?? []) {
      const ageDays = ageInDays(signal.created_at, now);
      if (ageDays > HISTORY_LOOKBACK_DAYS) continue;
      if (ageDays <= RECENT_PROMPT_DAYS) {
        recentPromptKeys.add(signal.prompt_fingerprint);
      }
      const weight = historyEventWeight(ageDays, signal.feedback_rating);
      if (signal.source_kind === "director_copilot_v2" && isDirectorIntent(signal.intent)) {
        intentWeights.set(
          signal.intent,
          (intentWeights.get(signal.intent) ?? 0) + weight,
        );
      } else if (signal.source_kind === "documents") {
        documentWeight += weight;
      }
    }
  }
  return { intentWeights, documentWeight, recentPromptKeys };
}

function directorTemplateAuthorized(
  template: SuggestionTemplate,
  context: ApiRequestContext,
  catalog: ReturnType<typeof pinnedDirectorCopilotV2Catalog>,
  now: Date,
  language: AklLanguage,
): boolean {
  if (!template.intent) return false;
  const resolved = resolveConversationQuery({
    message: template.prompt,
    now,
  });
  if (
    !resolved.recognized
    || classifyDirectorCopilotV2Intent(template.prompt) !== template.intent
  ) {
    return false;
  }
  try {
    const plan = buildDirectorCopilotV2Plan({
      message: template.prompt,
      language,
      context,
      intent: template.intent,
      queryState: resolved.state,
      catalog,
      now,
    });
    return plan.nodes.length > 0 && plan.nodes.every((node) => (
      node.access.authorized
      && node.request !== null
      && node.planning_error_code === null
    ));
  } catch {
    return false;
  }
}

function canQueryDocuments(context: ApiRequestContext): boolean {
  return context.identityActive !== false
    && context.membershipActive !== false
    && context.applicationAccessActive !== false
    && context.capabilities?.includes("akb:chat") === true;
}

function scoreTemplate(
  template: SuggestionTemplate,
  profile: SuggestionHistoryProfile,
  now: Date,
): number {
  const affinity = template.intent
    ? Math.min(profile.intentWeights.get(template.intent) ?? 0, 3) * 0.45
    : Math.min(profile.documentWeight, 3) * 0.45;
  const cadence = Math.max(
    0,
    ...template.cadence.map((candidate) => cadenceBoost(candidate, now)),
  );
  const recentPenalty = profile.recentPromptKeys.has(
    promptFingerprint(template.prompt),
  )
    ? 1.25
    : 0;
  return template.baseScore + affinity + cadence - recentPenalty;
}

function diversifiedSuggestions<T extends { template: SuggestionTemplate }>(
  candidates: T[],
  limit: number,
): T[] {
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const domains = new Set<string>();
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (domains.has(candidate.template.domain)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.template.id);
    domains.add(candidate.template.domain);
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.template.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.template.id);
  }
  return selected;
}

function suggestionTemplates(
  language: AklLanguage,
  now: Date,
): SuggestionTemplate[] {
  const year = localCalendar(now).year;
  if (language === "en") {
    return [
      live("budget-plan", "Approved budget", `What is the organization's total approved budget for ${year}?`, "Budget", "budget_portfolio_status", 1.05, ["month_start", "quarter_end"]),
      live("budget-forecast", "Forecast versus plan", "What is this year's financial forecast and variance from the approved plan?", "Budget", "budget_portfolio_status", 1, ["month_end", "quarter_end"]),
      // Item ranking remains routable, but is not proactively suggested until its live response passes contract validation.
      live("projects-status", "Project portfolio", "What is the status of the project portfolio?", "ProjectFlow", "project_portfolio_status", 1.05, ["week_start"]),
      live("projects-delayed", "Delayed projects", "Which projects are delayed?", "ProjectFlow", "project_portfolio_status", 1, ["week_end", "month_end"]),
      live("projects-milestones", "Upcoming milestones", "Which project milestones are due next?", "ProjectFlow", "project_portfolio_status", 0.95, ["week_start"]),
      live("needs-decision", "Needs awaiting decision", "Which business needs are awaiting a decision?", "ArchFlow", "archflow_demand_overview", 1, ["week_start", "month_end"]),
      live("needs-handoff", "Needs not handed over", "Which needs have not yet been handed over from ArchFlow to Budget?", "ArchFlow", "archflow_demand_overview", 0.9, ["month_end"]),
      live("ideas-harmonization", "Ideas awaiting harmonization", "Which AI ideas are awaiting harmonization?", "AIIP", "aiip_idea_overview", 1, ["week_start"]),
      live("ideas-value-risk", "AI value and risk", "Which AI ideas have the highest value and risk scores?", "AIIP", "aiip_idea_overview", 0.9, ["quarter_end"]),
      live("portfolio-variance-delay", "Variance and delay", "Which projects are financially above plan and delayed at the same time?", "STRATOS", "portfolio_performance_overview", 1.1, ["month_end", "quarter_end"]),
      documents("document-overview", "Available documents", "What types of documents are available to me in AKB?", "Documents", 0.9),
    ];
  }
  return [
    live("budget-plan", "Schválený rozpočet", `Jaký je celkový schválený rozpočet organizace na rok ${year}?`, "Budget", "budget_portfolio_status", 1.05, ["month_start", "quarter_end"]),
    live("budget-forecast", "Výhled proti plánu", "Jaký je letošní finanční výhled a odchylka proti schválenému plánu?", "Budget", "budget_portfolio_status", 1, ["month_end", "quarter_end"]),
    // Řazení položek zůstává dostupné v chatu, ale do validace živého kontraktu se aktivně nenabízí.
    live("projects-status", "Projektové portfolio", "Jaký je stav projektového portfolia?", "ProjectFlow", "project_portfolio_status", 1.05, ["week_start"]),
    live("projects-delayed", "Zpožděné projekty", "Které projekty jsou zpožděné?", "ProjectFlow", "project_portfolio_status", 1, ["week_end", "month_end"]),
    live("projects-milestones", "Nejbližší milníky", "Které projektové milníky nás čekají nejdříve?", "ProjectFlow", "project_portfolio_status", 0.95, ["week_start"]),
    live("needs-decision", "Potřeby k rozhodnutí", "Které business potřeby čekají na rozhodnutí?", "ArchFlow", "archflow_demand_overview", 1, ["week_start", "month_end"]),
    live("needs-handoff", "Nepředané potřeby", "Které potřeby ještě nebyly předány z ArchFlow do Budgetu?", "ArchFlow", "archflow_demand_overview", 0.9, ["month_end"]),
    live("ideas-harmonization", "Podněty k harmonizaci", "Které AI podněty čekají na harmonizaci?", "AIIP", "aiip_idea_overview", 1, ["week_start"]),
    live("ideas-value-risk", "Hodnota a riziko AI", "Které AI podněty mají nejvyšší hodnotové a rizikové skóre?", "AIIP", "aiip_idea_overview", 0.9, ["quarter_end"]),
    live("portfolio-variance-delay", "Odchylka a zpoždění", "Které projekty jsou finančně nad plánem a zároveň zpožděné?", "STRATOS", "portfolio_performance_overview", 1.1, ["month_end", "quarter_end"]),
    documents("document-overview", "Dostupné dokumenty", "Jakého typu jsou dokumenty, které mám v AKB k dispozici?", "Dokumenty", 0.9),
  ];
}

function live(
  id: string,
  label: string,
  prompt: string,
  domain: string,
  intent: DirectorCopilotIntent,
  baseScore: number,
  cadence: SuggestionCadence[],
): SuggestionTemplate {
  return {
    id,
    kind: "director_copilot_v2",
    intent,
    label,
    prompt,
    domain,
    baseScore,
    cadence,
  };
}

function documents(
  id: string,
  label: string,
  prompt: string,
  domain: string,
  baseScore: number,
): SuggestionTemplate {
  return {
    id,
    kind: "registry_documents",
    intent: null,
    label,
    prompt,
    domain,
    baseScore,
    cadence: ["neutral"],
  };
}

function cadenceBoost(cadence: SuggestionCadence, now: Date): number {
  const calendar = localCalendar(now);
  if (cadence === "week_start") return calendar.weekday === "Mon" ? 0.35 : 0;
  if (cadence === "week_end") return calendar.weekday === "Fri" ? 0.3 : 0;
  if (cadence === "month_start") return calendar.day <= 3 ? 0.35 : 0;
  if (cadence === "month_end") return calendar.day >= 25 ? 0.4 : 0;
  if (cadence === "quarter_end") {
    return [3, 6, 9, 12].includes(calendar.month) && calendar.day >= 20 ? 0.45 : 0;
  }
  return 0;
}

function localCalendar(now: Date): {
  year: number;
  month: number;
  day: number;
  weekday: string;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((candidate) => candidate.type === type)?.value ?? ""
  );
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    weekday: part("weekday"),
  };
}

function historyEventWeight(
  ageDays: number,
  feedback: "helpful" | "not_helpful" | null | undefined,
): number {
  const decay = Math.exp(-Math.max(ageDays, 0) / 45);
  if (feedback === "helpful") return decay * 1.25;
  if (feedback === "not_helpful") return decay * 0.4;
  return decay;
}

function ageInDays(createdAt: string, now: Date): number {
  const parsed = Date.parse(createdAt);
  if (Number.isNaN(parsed)) return HISTORY_LOOKBACK_DAYS + 1;
  return Math.max(0, (now.getTime() - parsed) / DAY_MS);
}

export function promptFingerprint(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("cs-CZ")
    .replace(/\s+/gu, " ")
    .trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function isDirectorIntent(value: unknown): value is DirectorCopilotIntent {
  return value === "portfolio_risk_correlation"
    || value === "portfolio_performance_overview"
    || value === "project_portfolio_status"
    || value === "budget_portfolio_status"
    || value === "project_access_overview"
    || value === "archflow_demand_overview"
    || value === "aiip_idea_overview"
    || value === "innovation_delivery_trace";
}
