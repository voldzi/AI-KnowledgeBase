export type AklLanguage = "cs" | "en";

export const languageLabels: Record<AklLanguage, string> = {
  cs: "Čeština",
  en: "English"
};

export function isAklLanguage(value: unknown): value is AklLanguage {
  return value === "cs" || value === "en";
}
