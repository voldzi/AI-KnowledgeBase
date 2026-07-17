export type PublicSourceDocumentType =
  | "regulation"
  | "methodology"
  | "policy"
  | "manual"
  | "knowledge_base_article"
  | "other";

export type PublicSourceSyncMode = "crawler" | "fixed" | "api_required";

export interface PublicSourceFixedDocument {
  title: string;
  url: string;
  canonicalUrl?: string;
}

export interface PublicSourceCollection {
  id: string;
  name: string;
  authority: string;
  description: string;
  homepage: string;
  topic: string;
  documentType: PublicSourceDocumentType;
  targetDocuments: number;
  syncMode: PublicSourceSyncMode;
  allowedHosts: string[];
  seedUrls: string[];
  crawlPathPrefixes: string[];
  maxPages: number;
  maxDocuments: number;
  licenseNote: string;
  fixedDocuments?: PublicSourceFixedDocument[];
}

const eurLexActs: ReadonlyArray<readonly [string, string]> = [
  ["Nařízení o umělé inteligenci (AI Act)", "32024R1689"],
  ["Obecné nařízení o ochraně osobních údajů (GDPR)", "32016R0679"],
  ["Směrnice NIS2", "32022L2555"],
  ["Nařízení DORA", "32022R2554"],
  ["Nařízení o datech (Data Act)", "32023R2854"],
  ["Nařízení o správě dat (Data Governance Act)", "32022R0868"],
  ["Akt o kybernetické bezpečnosti", "32019R0881"],
  ["Nařízení eIDAS", "32014R0910"],
  ["Evropský rámec digitální identity", "32024R1183"],
  ["Směrnice o otevřených datech", "32019L1024"],
  ["Směrnice o zadávání veřejných zakázek", "32014L0024"],
  ["Směrnice o zadávání zakázek v odvětvích vodního hospodářství, energetiky, dopravy a poštovních služeb", "32014L0025"],
  ["Směrnice o udělování koncesí", "32014L0023"],
  ["Akt o kybernetické odolnosti", "32024R2847"],
  ["Nařízení o digitálních službách", "32022R2065"],
  ["Nařízení o digitálních trzích", "32022R1925"],
  ["Směrnice o odolnosti kritických subjektů", "32022L2557"],
  ["Směrnice o odpovědnosti za vadné výrobky", "32024L2853"],
  ["Nařízení Interoperable Europe Act", "32024R0903"],
  ["Nařízení o evropském prostoru pro zdravotní data", "32025R0327"],
  ["Směrnice o opakovaném použití informací veřejného sektoru", "32003L0098"],
  ["Nařízení o volném pohybu neosobních údajů", "32018R1807"],
  ["Nařízení o evropské statistice", "32009R0223"],
  ["Finanční nařízení EU", "32018R1046"],
  ["Směrnice o přístupnosti webových stránek a mobilních aplikací subjektů veřejného sektoru", "32016L2102"],
  ["Evropský kodex pro elektronické komunikace", "32018L1972"],
];

const eurLexDocuments: PublicSourceFixedDocument[] = eurLexActs.map(([title, celex]) => ({
  title,
  url: `https://eur-lex.europa.eu/legal-content/CS/TXT/PDF/?uri=CELEX:${celex}`,
  canonicalUrl: `https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:${celex}`,
}));

export const PUBLIC_SOURCE_COLLECTIONS: readonly PublicSourceCollection[] = [
  {
    id: "nukib-support",
    name: "NÚKIB – podpůrné materiály",
    authority: "Národní úřad pro kybernetickou a informační bezpečnost",
    description: "Oficiální doporučení, metodiky, příručky a podpůrné materiály ke kybernetické bezpečnosti.",
    homepage: "https://nukib.gov.cz/cs/infoservis/dokumenty-a-publikace/podpurne-materialy/",
    topic: "kyberneticka-bezpecnost",
    documentType: "methodology",
    targetDocuments: 70,
    syncMode: "crawler",
    allowedHosts: ["nukib.gov.cz", "portal.nukib.gov.cz"],
    seedUrls: [
      "https://nukib.gov.cz/cs/infoservis/dokumenty-a-publikace/podpurne-materialy/",
      "https://nukib.gov.cz/cs/kyberneticka-bezpecnost/regulace-a-kontrola/podpurne-materialy/",
      "https://nukib.gov.cz/cs/infoservis/dokumenty-a-publikace/analyzy/",
      "https://nukib.gov.cz/cs/infoservis/dokumenty-a-publikace/sdileni-informaci/",
    ],
    crawlPathPrefixes: [
      "/cs/infoservis/dokumenty-a-publikace/",
      "/cs/kyberneticka-bezpecnost/",
      "/cs/infoservis/doporuceni/",
    ],
    maxPages: 80,
    maxDocuments: 70,
    licenseNote: "Oficiálně veřejně publikované materiály NÚKIB; AKB uchovává zdroj, hash a kanonický odkaz.",
  },
  {
    id: "public-procurement",
    name: "Veřejné zakázky – metodiky",
    authority: "Ministerstvo pro místní rozvoj a Portál o veřejných zakázkách",
    description: "Aktuální i označené archivní metodiky k zadávání, nákupu, hodnocení a změnám závazků.",
    homepage: "https://portal-vz.cz/metodiky-stanoviska/",
    topic: "verejne-zakazky",
    documentType: "methodology",
    targetDocuments: 82,
    syncMode: "crawler",
    allowedHosts: ["portal-vz.cz", "www.portal-vz.cz", "mmr.gov.cz", "www.mmr.gov.cz"],
    seedUrls: [
      "https://portal-vz.cz/metodiky-stanoviska/metodiky-k-zakonu-c-134-2016-sb-o-zadavani-verejnych-zakazek/metodiky-procesni-k-zadavacim-rizenim/",
      "https://portal-vz.cz/metodiky-stanoviska/archiv-metodiky-k-zakonu-c-134-2016-sb-o-zadavani-verejnych-zakazek-zzvz/",
      "https://portal-vz.cz/metodiky-stanoviska/metodicke-pokyny/metodika-zadavani-verejnych-zakazek-dle-zakona-c-1/",
      "https://mmr.gov.cz/cs/microsites/nsvz/priority/prostredi-pro-efektivni-zadavani-verejnych-zakazek/aktualizace-metodiky-verejneho-nakupovani/metodika-verejneho-nakupovani",
    ],
    crawlPathPrefixes: ["/metodiky-stanoviska/", "/cs/microsites/nsvz/", "/Ministerstvo/"],
    maxPages: 140,
    maxDocuments: 82,
    licenseNote: "Oficiálně zveřejněné metodické materiály veřejné správy; archivní dokumenty zůstávají jako archivní zdroje.",
  },
  {
    id: "dia-architecture",
    name: "DIA – eGovernment a architektura",
    authority: "Digitální a informační agentura",
    description: "Národní architektonický plán a rámec, cloud, digitální služby a metodiky eGovernmentu.",
    homepage: "https://archi.gov.cz/",
    topic: "egovernment-architektura",
    documentType: "methodology",
    targetDocuments: 37,
    syncMode: "crawler",
    allowedHosts: ["archi.gov.cz", "www.dia.gov.cz", "dia.gov.cz"],
    seedUrls: [
      "https://archi.gov.cz/nap:start",
      "https://archi.gov.cz/nar:start",
      "https://archi.gov.cz/znalostni_baze:start",
    ],
    crawlPathPrefixes: ["/nap", "/nar", "/znalostni_baze", "/egovernment/"],
    maxPages: 160,
    maxDocuments: 50,
    licenseNote: "Oficiální veřejné metodiky DIA a veřejná dokumentace archi.gov.cz.",
  },
  {
    id: "eu-law",
    name: "Právo EU – digitální agenda, AI a nákup",
    authority: "Evropská unie – EUR-Lex",
    description: "Vybrané právní akty EU v českém znění s kanonickým CELEX identifikátorem.",
    homepage: "https://eur-lex.europa.eu/",
    topic: "pravo-eu",
    documentType: "regulation",
    targetDocuments: eurLexDocuments.length,
    syncMode: "fixed",
    allowedHosts: ["eur-lex.europa.eu"],
    seedUrls: [],
    crawlPathPrefixes: ["/legal-content/"],
    maxPages: 0,
    maxDocuments: eurLexDocuments.length,
    licenseNote: "Dokumenty EUR-Lex lze znovu použít při uvedení zdroje a bez zkreslení významu.",
    fixedDocuments: eurLexDocuments,
  },
  {
    id: "open-itsm",
    name: "Otevřené řízení IT služeb",
    authority: "FitSM / ITEMO",
    description: "Otevřený standard řízení IT služeb jako legálně použitelná alternativa k proprietárnímu obsahu ITIL.",
    homepage: "https://www.fitsm.eu/downloads/",
    topic: "rizeni-it-sluzeb",
    documentType: "manual",
    targetDocuments: 25,
    syncMode: "crawler",
    allowedHosts: ["fitsm.eu", "www.fitsm.eu"],
    seedUrls: ["https://www.fitsm.eu/downloads/"],
    crawlPathPrefixes: ["/downloads/", "/documents/"],
    maxPages: 30,
    maxDocuments: 25,
    licenseNote: "Pouze otevřeně licencované FitSM materiály; proprietární publikace ITIL se neimportují.",
  },
  {
    id: "cz-statistics",
    name: "Česká statistická služba",
    authority: "Český statistický úřad",
    description: "Právní, metodické a programové dokumenty statistické služby a ochrany statistických údajů.",
    homepage: "https://csu.gov.cz/",
    topic: "statisticka-sluzba",
    documentType: "methodology",
    targetDocuments: 24,
    syncMode: "crawler",
    allowedHosts: ["csu.gov.cz", "www.czso.cz", "apl.czso.cz"],
    seedUrls: [
      "https://csu.gov.cz/statni-statisticka-sluzba-cr",
      "https://csu.gov.cz/metodiky-pro-organy-statni-statisticke-sluzby-a-onas",
      "https://csu.gov.cz/vykazy/program_statistickych_zjistovani",
      "https://csu.gov.cz/vykazy/archiv-programu-statistickych-zjistovani",
      "https://csu.gov.cz/zakon_o_statni_statisticke_sluzbe",
    ],
    crawlPathPrefixes: [
      "/statni-statisticka-sluzba-cr",
      "/metodiky-pro-organy-statni-statisticke-sluzby-a-onas",
      "/vykazy/program",
      "/csu/vykazy/program",
      "/vykazy/archiv-programu",
      "/zakon_o_statni_statisticke_sluzbe",
    ],
    maxPages: 80,
    maxDocuments: 24,
    licenseNote: "Veřejné oficiální dokumenty ČSÚ; u statistických dat se zachovává zdroj a časová verze.",
  },
  {
    id: "czech-law",
    name: "České právní předpisy – e-Sbírka",
    authority: "Ministerstvo vnitra – e-Sbírka",
    description: "Garantovaná aktuální a historická znění právních předpisů. Produkční API vyžaduje registraci provozovatele.",
    homepage: "https://e-sbirka.gov.cz/",
    topic: "pravo-cr",
    documentType: "regulation",
    targetDocuments: 90,
    syncMode: "api_required",
    allowedHosts: ["e-sbirka.gov.cz", "www.e-sbirka.cz"],
    seedUrls: [],
    crawlPathPrefixes: ["/sb/", "/sbr-cache/", "/souborove-sluzby/"],
    maxPages: 0,
    maxDocuments: 90,
    licenseNote: "Zdroj je veřejný; stabilní produkční synchronizace čeká na přidělené přihlašovací údaje veřejného API e-Sbírky.",
  },
] as const;

export function publicSourceCollection(id: string): PublicSourceCollection | null {
  return PUBLIC_SOURCE_COLLECTIONS.find((collection) => collection.id === id) ?? null;
}

export function publicSourceTargetTotal(): number {
  return PUBLIC_SOURCE_COLLECTIONS.reduce(
    (total, collection) => total + collection.targetDocuments,
    0,
  );
}
