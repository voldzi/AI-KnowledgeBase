import type { AklLanguage } from "./language";

function locale(language: AklLanguage = "cs") {
  return language === "en" ? "en-US" : "cs-CZ";
}

export function formatDateTime(value: string | null, language: AklLanguage = "cs"): string {
  if (!value) {
    return "n/a";
  }
  return new Intl.DateTimeFormat(locale(language), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Prague"
  }).format(new Date(value));
}

export function formatDate(value: string | null, language: AklLanguage = "cs"): string {
  if (!value) {
    return language === "en" ? "no end date" : "bez konce";
  }
  return new Intl.DateTimeFormat(locale(language), {
    dateStyle: "medium",
    timeZone: "Europe/Prague"
  }).format(new Date(value));
}

export function formatNumber(value: number, language: AklLanguage = "cs"): string {
  return new Intl.NumberFormat(locale(language)).format(value);
}

export function documentTypeLabel(value: string, language: AklLanguage = "cs"): string {
  const labels: Record<AklLanguage, Record<string, string>> = {
    cs: {
      directive: "směrnice",
      regulation: "předpis",
      methodology: "metodika",
      policy: "politika",
      procedure: "postup",
      manual: "manuál",
      knowledge_base_article: "článek znalostní báze",
      project_documentation: "projektová dokumentace",
      meeting_record: "záznam jednání",
      contract: "smlouva",
      attachment: "příloha",
      other: "ostatní"
    },
    en: {}
  };
  if (language === "cs" && labels.cs[value]) {
    return labels.cs[value];
  }
  return value.replaceAll("_", " ");
}
