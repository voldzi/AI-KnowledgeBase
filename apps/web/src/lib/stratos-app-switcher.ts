const retiredSwitcherDestinations = [
  "security-preflight",
  "aiip",
  "processforge",
] as const;

type AppAvailability = Record<string, {
  visible?: boolean;
  enabled?: boolean;
  disabledReason?: string;
  access?: "granted" | "missing";
  accessLabel?: string;
} | undefined>;

export function applyAkbStratosAppsVisibility(
  availability: AppAvailability,
): AppAvailability {
  return retiredSwitcherDestinations.reduce<AppAvailability>(
    (result, application) => ({
      ...result,
      [application]: {
        ...result[application],
        visible: false,
      },
    }),
    availability,
  );
}
