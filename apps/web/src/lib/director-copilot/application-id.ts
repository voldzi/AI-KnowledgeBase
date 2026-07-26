import type { DomainApplication } from "./contracts";

const APPLICATION_ALIASES: Readonly<Record<string, DomainApplication>> = {
  budget: "budget",
  "budget-contract": "budget",
  projectflow: "projectflow",
  "project-flow": "projectflow",
  archflow: "archflow",
  "arch-flow": "archflow",
  aiip: "aiip",
  "ai-innovation-portal": "aiip",
};

export function canonicalDirectorCopilotApplication(
  value: string,
): DomainApplication | null {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return APPLICATION_ALIASES[normalized] ?? null;
}
