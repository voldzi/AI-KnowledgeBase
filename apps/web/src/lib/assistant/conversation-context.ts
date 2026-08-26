import type { AssistantConversationMessage } from "@/lib/types";

const MAX_CONTEXT_DEPTH = 5;
const MAX_CONTEXT_ENTRIES = 72;
const MAX_CONTEXT_ARRAY_ITEMS = 32;
const MAX_CONTEXT_STRING_LENGTH = 800;
const MAX_CONTEXT_SERIALIZED_LENGTH = 12_000;
const MAX_CONTEXT_MESSAGES = 12;

const FORBIDDEN_KEY = /(?:^|_)(?:access_?token|refresh_?token|bearer|authorization|cookie|credential|password|secret|session_?id|private_?key|api_?key|encryption_?key|signing_?key|key_?material)(?:$|_)/i;
const BULKY_CONTEXT_KEYS = new Set([
  "answer_format_instruction",
  "assistant_query_plan",
  "director_copilot_evidence",
  "director_copilot_v2_snapshot",
  "report_artifacts",
]);
const CONTINUITY_KEYS = new Set([
  "stratos_query_state",
  "controlled_rule_domain",
  "controlled_rule_valid_on",
  "controlled_rule_source_scope",
  "clarification_kind",
  "document_id",
  "document_version_id",
  "document_knowledge_state",
  "registry_report_kind",
]);

interface ContextBudget {
  entries: number;
  characters: number;
}

/**
 * Returns a bounded, JSON-compatible conversation state capsule.
 * This state is a routing aid only; authorization is always re-evaluated.
 */
export function safeAssistantConversationContext(value: unknown): Record<string, unknown> {
  const budget: ContextBudget = { entries: 0, characters: 0 };
  const sanitized = sanitizeValue(value, 0, budget);
  return isRecord(sanitized) ? sanitized : {};
}

/**
 * Rebuilds the latest structured state without reusing assistant prose.
 * Older capsules only fill fields missing from a newer available response.
 */
export function assistantConversationContextFromMessages(
  messages: AssistantConversationMessage[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  let inspected = 0;
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant" || message.availability === "source_access_changed") {
      continue;
    }
    const currentContext = safeAssistantConversationContext(
      isRecord(message.metadata) ? message.metadata.current_context : undefined,
    );
    for (const [key, value] of Object.entries(currentContext)) {
      if (!(key in merged)) merged[key] = value;
    }
    inspected += 1;
    if (inspected >= MAX_CONTEXT_MESSAGES) break;
  }
  return safeAssistantConversationContext(merged);
}

export function mergeAssistantConversationContext(
  persisted: unknown,
  current: unknown,
): Record<string, unknown> {
  return safeAssistantConversationContext({
    ...safeAssistantConversationContext(persisted),
    ...safeAssistantConversationContext(current),
  });
}

export function hasAssistantContinuityContext(context: Record<string, unknown>): boolean {
  return Object.keys(context).some((key) => (
    CONTINUITY_KEYS.has(key)
    || key.startsWith("controlled_rule_")
    || key.startsWith("registry_filter_")
  ));
}

function sanitizeValue(
  value: unknown,
  depth: number,
  budget: ContextBudget,
): unknown {
  if (
    value === null
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "string") {
    const bounded = value.slice(0, MAX_CONTEXT_STRING_LENGTH);
    if (budget.characters + bounded.length > MAX_CONTEXT_SERIALIZED_LENGTH) return undefined;
    budget.characters += bounded.length;
    return bounded;
  }
  if (depth >= MAX_CONTEXT_DEPTH || budget.entries >= MAX_CONTEXT_ENTRIES) return undefined;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value.slice(0, MAX_CONTEXT_ARRAY_ITEMS)) {
      const sanitized = sanitizeValue(item, depth + 1, budget);
      if (sanitized !== undefined) result.push(sanitized);
      if (budget.entries >= MAX_CONTEXT_ENTRIES) break;
    }
    return result;
  }
  if (!isRecord(value)) return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key) || BULKY_CONTEXT_KEYS.has(key)) continue;
    budget.entries += 1;
    if (budget.entries > MAX_CONTEXT_ENTRIES) break;
    const sanitized = sanitizeValue(item, depth + 1, budget);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
