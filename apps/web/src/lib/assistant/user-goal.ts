import type { AnswerMode } from "@/lib/types";
import type { ConversationQueryState } from "@/lib/director-copilot/query-state";
import type { StratosSemanticMetric } from "@/lib/director-copilot/semantic-catalog";

export const ASSISTANT_USER_GOAL_VERSION = "assistant-user-goal-1" as const;

export type AssistantUserGoal =
  | "lookup"
  | "explain"
  | "compare"
  | "diagnose"
  | "recommend"
  | "scenario";

export interface AssistantUserGoalResolution {
  version: typeof ASSISTANT_USER_GOAL_VERSION;
  goal: AssistantUserGoal;
  analytical: boolean;
  explicit: boolean;
}

const SCENARIO_SIGNAL = /\b(co kdyby|kdyby|co se stane kdyz|jak by se zmen\w*|pokud by\w*|scenar\w*|varianta\w*|what if|scenario)\b/;
const RECOMMEND_SIGNAL = /\b(jak (?:je )?mozno|jak lze|jak muzeme|jak bychom mohli|jak zleps\w*|co doporuc\w*|co mam(?:e)? udelat|co bychom meli udelat|navrhni|doporuc\w*|optimaliz\w*|zleps\w*)\b/;
const DIAGNOSE_SIGNAL = /\b(proc|z jakeho duvodu|co zpusob\w*|pricin\w*|kde je problem|co nefung\w*|diagnostik\w*|why|root cause)\b/;
const COMPARE_SIGNAL = /\b(porovnej|srovnej|porovnani|srovnani|jak se lis\w*|oproti|versus|vs\.?|rozdil mezi|compare|comparison)\b/;
const EXPLAIN_SIGNAL = /\b(co znamena|vysvetli|objasni|jak fung\w*|jak se pouziva|k cemu slouzi|explain|how does)\b/;

export function resolveAssistantUserGoal(message: string): AssistantUserGoalResolution {
  const normalized = normalizeGoalText(message);
  const goal = SCENARIO_SIGNAL.test(normalized)
    ? "scenario"
    : RECOMMEND_SIGNAL.test(normalized)
      ? "recommend"
      : DIAGNOSE_SIGNAL.test(normalized)
        ? "diagnose"
        : COMPARE_SIGNAL.test(normalized)
          ? "compare"
          : EXPLAIN_SIGNAL.test(normalized)
            ? "explain"
            : "lookup";
  return {
    version: ASSISTANT_USER_GOAL_VERSION,
    goal,
    analytical: goal !== "lookup",
    explicit: goal !== "lookup",
  };
}

export function isAnalyticalAssistantGoal(goal: AssistantUserGoal): boolean {
  return goal !== "lookup";
}

export function answerModeForAssistantGoal(goal: AssistantUserGoal): AnswerMode {
  if (goal === "compare") return "compare";
  if (goal === "explain") return "explain_process";
  if (goal === "diagnose") return "extract_risks";
  if (goal === "recommend" || goal === "scenario") return "manager_brief";
  return "it_support_answer";
}

const BUDGET_ANALYTICAL_METRICS: StratosSemanticMetric[] = [
  "budget.plan_amount",
  "budget.actual_amount",
  "budget.forecast_amount",
  "budget.commitments_amount",
  "budget.variance_amount",
];

export function queryStateForAssistantGoal(
  state: ConversationQueryState,
  goal: AssistantUserGoal,
): ConversationQueryState {
  if (
    !state.sources.includes("budget")
    || (goal !== "diagnose" && goal !== "recommend" && goal !== "scenario")
  ) {
    return state;
  }
  return {
    ...state,
    metrics: [...new Set([...state.metrics, ...BUDGET_ANALYTICAL_METRICS])],
  };
}

function normalizeGoalText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
