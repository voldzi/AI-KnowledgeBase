export type ApplicationDocumentationTopic = "overview" | "infrastructure" | "security" | "operations" | "manual";

export interface ApplicationDocumentationRequest {
  topic: ApplicationDocumentationTopic;
  documentMessage: string;
  liveMessage: string | null;
}

const APPLICATION = /\b(?:akb|akl|stratos|budget|project\s*flow|arch\s*flow|aplikac\w*|system\w*|platform\w*|software|chat)\b/;
const MANUAL = /\b(?:manual\w*|priruck\w*|dokumentac\w*|navod\w*|uzivatelsk\w*\s+postup\w*|documentation|handbook|guide)\b/;
const INFRASTRUCTURE = /\b(?:infrastruktur\w*|hardwar\w*|sizing|dimenzov\w*|architektur\w*|instalac\w*|instaluj\w*|nainstal\w*|nasazeni|deployment|instal\w*\s+pozadav\w*|porty|firewall|dns|cpu|ram|gpu|tls|certifikat\w*|architecture|infrastructure|installation)\b/;
const SECURITY = /\b(?:bezpecn\w*|zabezpec\w*|sifrov\w*|autentiz\w*|autoriz\w*|oidc|sso|keycloak|antivir\w*|security|encrypt\w*|authentication|authorization)\b/;
const OPERATIONS = /\b(?:zaloh\w*|obnov\w*|monitoring|dohled|retenc\w*|rpo|rto|disaster\s+recovery|backup\w*|restore|retention)\b/;
const EXPLANATION = /\b(?:co\s+(?:je|jsou|umi|umoznuje|znamena|obsahuje|dela)|jak\s+(?:funguje|pracuje|odpovida)|k\s+cemu\s+slouzi|jake\s+(?:(?:ma|jsou|nabizi|poskytuje)\s+)?(?:funkce|funkcionality|moznosti|vyhody|omezeni)|popis\w*|vysvetl\w*|what\s+(?:is|are|does|can)|how\s+does|explain|describe|capabilities|features)\b/;
const APPLICATION_EXPLANATION = /\b(?:jak|how)\b.{0,100}\b(?:funguje|pracuje|odpovida|works|answers)\b|\bco\b.{0,80}\b(?:umi|umoznuje|nabizi|poskytuje)\b/;
const PROCEDURE = /\b(?:jak|kde|how)\b.*\b(?:nastav\w*|zaloz\w*|vytvor\w*|prihlas\w*|odhlas\w*|pouz\w*|schvaluj\w*|configure|create|use|log\s+in)\b/;
const LIVE_FACT = /\b(?:kolik\s+(?:mame|mam|je|jsou|ma|akci|projekt\w*|potreb\w*)|(?:jaky|jaka|jake)\s+(?:je|jsou|mame|mam)\s+(?:aktualni\s+)?(?:stav|rozpocet|financni\s+plan)|(?:ktere|jake)\s+(?:projekt\w*|akce|potreb\w*)\s+(?:jsou|mame|cekaji)|(?:vypis|ukaz|zobraz|spocitej|porovnej)\s+(?:mi\s+)?(?:aktualni\s+)?(?:projekt\w*|rozpoc\w*|plan\w*|akce|potreb\w*)|how\s+many|current\s+(?:budget|project\s+status))\b/;
const CLAUSE_SEPARATOR = /[?;]\s*|\s+(?:a|and)\s+(?=(?:kolik|jak[áéý]?|kde|co|kter[éýá]|popiš|popis|vysvětli|vysvetli|vypiš|vypis|ukaž|ukaz|zobraz|spočítej|spocitej|what|how|describe|show)\b)/iu;
const LIVE_RECORDS = /\b(?:(?:ktere|jake)\s+projekty|(?:nejdrazsi|nejvyssi|nejvetsi|nejlevnejsi)\s+(?:planovan\w*\s+)?(?:akce|polozk\w*|projekt\w*))\b/;

/** Describes the requested source, never the caller's rights or document status. */
export function resolveApplicationDocumentationRequest(
  message: string,
  context: Record<string, unknown> = {},
): ApplicationDocumentationRequest | null {
  const clauses = message.split(CLAUSE_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  const classified = clauses.map((text) => ({ text, topic: documentationTopic(normalize(text)) }));
  const documentClauses = classified.filter((clause) => clause.topic !== null);
  if (documentClauses.length) {
    const liveClauses = classified.filter((clause) => clause.topic === null && isLiveFact(normalize(clause.text)));
    return {
      topic: documentClauses[0].topic!,
      documentMessage: classified.filter((clause) => !liveClauses.includes(clause)).map((clause) => clause.text).join("? "),
      liveMessage: liveClauses.length ? liveClauses.map((clause) => clause.text).join("? ") : null,
    };
  }
  const previous = context.document_knowledge_state;
  const topic = previous && typeof previous === "object" && !Array.isArray(previous)
    ? (previous as Record<string, unknown>).application_topic
    : null;
  const normalized = normalize(message);
  if (
    isTopic(topic)
    && /^(?:a\s+)?(?:jak\s+(?:to|se)|kde\s+(?:to|je)|co\s+(?:to|dal)|and\s+how)\b/.test(normalized)
    && !isLiveFact(normalized)
    && !/\b(?:rozpocet|financni\s+plan|projekt\w*|akci|potreb\w*)\b/.test(normalized)
  ) return { topic, documentMessage: message, liveMessage: null };
  return null;
}

export function applicationDocumentationHints(topic: ApplicationDocumentationTopic): string[] {
  return {
    overview: ["funkce aplikace", "katalog funkcí", "účel systému"],
    infrastructure: ["infrastrukturní požadavky", "instalace", "síťové prostupy", "dimenzování"],
    security: ["bezpečnost", "identity a oprávnění", "ochrana dat"],
    operations: ["provozní příručka", "zálohování a obnova", "provozní omezení"],
    manual: ["uživatelská příručka", "manuál", "postup"],
  }[topic];
}

function documentationTopic(text: string): ApplicationDocumentationTopic | null {
  if (MANUAL.test(text)) return "manual";
  // A request for measured live facts remains live even if it names a system.
  if (isLiveFact(text)) return null;
  if (INFRASTRUCTURE.test(text)) return "infrastructure";
  if (SECURITY.test(text)) return "security";
  if (OPERATIONS.test(text)) return "operations";
  if (APPLICATION.test(text) && (EXPLANATION.test(text) || APPLICATION_EXPLANATION.test(text) || PROCEDURE.test(text))) return "overview";
  return null;
}

function isLiveFact(text: string): boolean {
  const datedFinancialQuestion = /\b(?:budget|forecast|financni\s+plan|rozpocet)\b/.test(text)
    && /\b(?:20\d{2}|(?:this|last|next)\s+year|letos|loni|pristi\s+rok)\b/.test(text)
    && /\b(?:what|how\s+much|show|compare|jaky|jaka|kolik|ukaz|porovnej)\b/.test(text);
  const financialAnalysis = /\b(?:rozpoc\w*|vydaj\w*|financni\s+plan|cerpani|forecast|naklad\w*)\b/.test(text)
    && /\b(?:zvys\w*|sniz\w*|optimaliz\w*|zleps\w*|vyleps\w*|zhodnot\w*)\b/.test(text);
  return LIVE_FACT.test(text) || LIVE_RECORDS.test(text) || datedFinancialQuestion || financialAnalysis;
}

function isTopic(value: unknown): value is ApplicationDocumentationTopic {
  return typeof value === "string" && ["overview", "infrastructure", "security", "operations", "manual"].includes(value);
}

function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}
