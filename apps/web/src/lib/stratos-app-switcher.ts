export const AKB_STRATOS_APP_IDS = [
  "budget-contract",
  "projectflow",
  "akb",
  "archflow",
] as const;

const allowedSwitcherDestinations = new Set<string>(AKB_STRATOS_APP_IDS);

type AppAvailability = Record<string, {
  visible?: boolean;
  enabled?: boolean;
  disabledReason?: string;
  access?: "granted" | "missing";
  accessLabel?: string;
} | undefined>;

export function applyAkbStratosAppsVisibility(
  availability: AppAvailability,
  directoryIds: readonly string[],
): AppAvailability {
  return directoryIds.reduce<AppAvailability>(
    (result, id) => allowedSwitcherDestinations.has(id)
      ? result
      : {
          ...result,
          [id]: {
            ...result[id],
            visible: false,
          },
        },
    availability,
  );
}
