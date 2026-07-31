import type { ControlledRule } from "@/lib/types";

const errorMessages: Record<string, string> = {
  CONTROLLED_DOCUMENT_ACCESS_DENIED:
    "Nemáte oprávnění pracovat se všemi dokumenty a přílohami tohoto vydání. Ověřte jejich přístupová pravidla nebo požádejte gestora dokumentace.",
  CONTROLLED_RULE_EXTRACTION_FORBIDDEN:
    "Pravidla může navrhnout pouze gestor dokumentace.",
  controlled_document_package_rules_not_proposed:
    "Před vyhlášením platnosti nejprve navrhněte pravidla z dokumentu a jeho příloh.",
  controlled_document_package_rules_empty:
    "Z posledního vytěžení nevzniklo žádné pravidlo k posouzení. Zkontrolujte zpracování zdrojů a spusťte návrh znovu.",
  controlled_document_package_rules_pending_review:
    "Před vyhlášením platnosti posuďte všechny navržené hodnoty a pravidla.",
  controlled_document_package_rules_not_verified:
    "Před vyhlášením platnosti musí být alespoň jedno pravidlo potvrzené nebo opravené gestorem.",
  controlled_document_package_member_not_published:
    "Nejprve zveřejněte přesnou verzi hlavního dokumentu i všech příloh.",
  controlled_document_package_member_not_effective:
    "Datum účinnosti některého dokumentu nebo přílohy nepokrývá datum účinnosti tohoto vydání.",
  controlled_document_package_transition_invalid:
    "Tento krok neodpovídá aktuálnímu stavu vydání. Obnovte stránku a pokračujte doporučeným krokem.",
};

const warningMessages: Record<string, string> = {
  SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE:
    "Termín revize zdroje uplynul. Pravidla zůstávají dohledatelná, ale gestor má ověřit jejich aktuálnost.",
  SOURCE_REVIEW_DATE_INVALID:
    "Datum doporučené revize není platné. Gestor má opravit údaje vydání.",
  POTENTIAL_RULE_CONFLICT_REQUIRES_GESTOR_REVIEW:
    "Zdroje obsahují potenciálně rozdílná pravidla. AKB konflikt nerozhodl a vyžaduje posouzení gestora.",
  NO_APPLICABLE_AUTHORIZED_CONTROLLED_DOCUMENT_PACKAGE:
    "K vybranému datu zatím není platné vydání, které by mohlo poskytovat ověřená pravidla aplikacím.",
  CONTROLLED_PACKAGE_SOURCES_NOT_RETRIEVED:
    "Text některého dokumentu nebo přílohy se nepodařilo načíst. Pravidla z tohoto zdroje nelze bezpečně použít.",
  CONTROLLED_RULE_CITATION_OUTSIDE_PACKAGE:
    "Návrh odkazuje mimo zvolené vydání a nebude nabídnut ke schválení.",
  CONTROLLED_RULE_PACKAGE_COORDINATES_MISMATCH:
    "Návrh pravidla neodpovídá zvolenému vydání a nebude použit.",
};

export function controlledDocumentationErrorMessage(
  code: string | undefined,
  fallback: string,
) {
  return (code && errorMessages[code]) || fallback;
}

export function controlledDocumentationWarningLabel(warning: string) {
  return warningMessages[warning] || "Řízené vydání vyžaduje kontrolu gestorem.";
}

export function controlledPackageRuleProgress(
  packageId: string,
  rules: ControlledRule[],
) {
  const packageRules = rules.filter((rule) => rule.package_id === packageId);
  const pending = packageRules.filter(
    (rule) => rule.verification_status === "proposed",
  ).length;
  const verified = packageRules.filter((rule) =>
    ["accepted", "edited"].includes(rule.verification_status),
  ).length;
  const rejected = packageRules.filter(
    (rule) => rule.verification_status === "rejected",
  ).length;

  return {
    total: packageRules.length,
    pending,
    verified,
    rejected,
    readyForPublication:
      packageRules.length > 0 && pending === 0 && verified > 0,
  };
}
