export type CoreDependencyStatus = "ready" | "not_ready" | "mock";
export type DirectorCopilotReadiness = "disabled" | "ready" | "degraded";
export type ContentSecurityReadiness = "disabled" | "ready" | "not_ready";

export function evaluateWebReadiness(input: {
  dependencies: Record<string, CoreDependencyStatus>;
  directorCopilotV2: DirectorCopilotReadiness;
  documentIntake: ContentSecurityReadiness;
}): { ready: boolean; degradedDependencies: string[] } {
  const dependenciesReady = Object.values(input.dependencies)
    .every((status) => status === "ready" || status === "mock");
  return {
    ready: dependenciesReady && input.documentIntake !== "not_ready",
    degradedDependencies: input.directorCopilotV2 === "degraded"
      ? ["director_copilot_v2"]
      : [],
  };
}
