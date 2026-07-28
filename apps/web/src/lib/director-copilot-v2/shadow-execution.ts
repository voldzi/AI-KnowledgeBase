export function scheduleIndependentShadowExecution(input: {
  execute: () => Promise<void>;
  onFailure: (error: unknown) => Promise<void>;
  schedule: (task: () => Promise<void>) => void;
}): void {
  const execution = input.execute().catch(input.onFailure);
  input.schedule(() => execution);
}
