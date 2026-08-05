export type AssistantLiveSourceStatus =
  | "complete"
  | "partial"
  | "no_data"
  | "not_authorized"
  | "unavailable";

export interface AssistantLiveSource {
  application: "budget" | "projectflow" | "archflow";
  status: AssistantLiveSourceStatus;
  as_of: string | null;
  generated_at: string | null;
  item_count: number;
}

const APPLICATIONS = new Set<AssistantLiveSource["application"]>([
  "budget",
  "projectflow",
  "archflow",
]);

const STATUSES = new Set<AssistantLiveSourceStatus>([
  "complete",
  "partial",
  "no_data",
  "not_authorized",
  "unavailable",
]);

export function assistantLiveSources(
  currentContext: Record<string, unknown> | null | undefined,
): AssistantLiveSource[] {
  if (!currentContext) return [];
  const persisted = arrayValue(currentContext.live_sources);
  if (persisted.length > 0) return parseSources(persisted);

  const snapshot = objectValue(currentContext.director_copilot_v2_snapshot);
  return parseSources(arrayValue(snapshot?.outcomes));
}

export function assistantLiveSourcesFromOutcomes(
  outcomes: unknown,
): AssistantLiveSource[] {
  return parseSources(arrayValue(outcomes));
}

export function assistantLiveSourceApplicationLabel(
  source: AssistantLiveSource,
): string {
  const labels: Record<AssistantLiveSource["application"], string> = {
    budget: "Budget",
    projectflow: "ProjectFlow",
    archflow: "ArchFlow",
  };
  return labels[source.application];
}

export function assistantLiveSourceStatusLabel(
  source: AssistantLiveSource,
  language: "cs" | "en",
): string {
  const labels: Record<AssistantLiveSourceStatus, [string, string]> = {
    complete: ["Aktuální data", "Current data"],
    partial: ["Částečná data", "Partial data"],
    no_data: ["Bez odpovídajících dat", "No matching data"],
    not_authorized: ["Zdroj není oprávněn", "Source not authorized"],
    unavailable: ["Dočasně nedostupné", "Temporarily unavailable"],
  };
  return labels[source.status][language === "en" ? 1 : 0];
}

export function assistantLiveSourceTimestamp(
  source: AssistantLiveSource,
): string | null {
  return source.as_of ?? source.generated_at;
}

function parseSources(values: unknown[]): AssistantLiveSource[] {
  return values.flatMap((value) => {
    const item = objectValue(value);
    if (!item) return [];
    const application = item?.application;
    const status = item?.status;
    if (
      typeof application !== "string"
      || !APPLICATIONS.has(application as AssistantLiveSource["application"])
      || typeof status !== "string"
      || !STATUSES.has(status as AssistantLiveSourceStatus)
    ) {
      return [];
    }
    const rawItems = arrayValue(item.items);
    const persistedCount = finiteNonNegativeNumber(item.item_count);
    return [{
      application: application as AssistantLiveSource["application"],
      status: status as AssistantLiveSourceStatus,
      as_of: nullableString(item.as_of),
      generated_at: nullableString(item.generated_at),
      item_count: persistedCount ?? rawItems.length,
    }];
  });
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
