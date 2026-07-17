export type PublicSourceDocumentType =
  | "regulation"
  | "methodology"
  | "policy"
  | "manual"
  | "knowledge_base_article"
  | "other";

export type PublicSourceSyncMode = "crawler" | "fixed" | "open_data";

export interface PublicSourceFixedDocument {
  title: string;
  url: string;
  canonicalUrl?: string;
}

export interface PublicSourceOpenDataAct {
  title: string;
  year: number;
  number: string;
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
  openDataActs?: PublicSourceOpenDataAct[];
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
  ["Rozhodnutí o politickém programu Digitální dekáda 2030", "32022D2481"],
  ["Nařízení o volném pohybu neosobních údajů", "32018R1807"],
  ["Nařízení o evropské statistice", "32009R0223"],
  ["Finanční nařízení EU", "32018R1046"],
  ["Směrnice o přístupnosti webových stránek a mobilních aplikací subjektů veřejného sektoru", "32016L2102"],
  ["Evropský kodex pro elektronické komunikace", "32018L1972"],
];

const eurLexDocuments: PublicSourceFixedDocument[] = eurLexActs.map(([title, celex]) => ({
  title,
  url: `https://publications.europa.eu/resource/celex/${celex}`,
  canonicalUrl: `https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:${celex}`,
}));

const czechLawActs: PublicSourceOpenDataAct[] = [
  { title: "Zákon o svobodném přístupu k informacím", year: 1999, number: "106" },
  { title: "Zákon o informačních systémech veřejné správy a o změně některých dalších zákonů", year: 2000, number: "365" },
  { title: "Zákon o elektronických úkonech a autorizované konverzi dokumentů", year: 2008, number: "300" },
  { title: "Zákon o základních registrech", year: 2009, number: "111" },
  { title: "Zákon o právu na digitální služby a o změně některých zákonů", year: 2020, number: "12" },
  { title: "Zákon o elektronické identifikaci", year: 2017, number: "250" },
  { title: "Zákon o službách vytvářejících důvěru pro elektronické transakce", year: 2016, number: "297" },
  { title: "Zákon o přístupnosti internetových stránek a mobilních aplikací a o změně zákona č. 365/2000 Sb., o informačních systémech veřejné správy a o změně některých dalších zákonů, ve znění pozdějších předpisů", year: 2019, number: "99" },
  { title: "Zákon o zpracování osobních údajů", year: 2019, number: "110" },
  { title: "Zákon o archivnictví a spisové službě a o změně některých zákonů", year: 2004, number: "499" },
  { title: "Vyhláška o podrobnostech výkonu spisové služby", year: 2012, number: "259" },
  { title: "Zákon správní řád", year: 2004, number: "500" },
  { title: "Zákon o kontrole (kontrolní řád)", year: 2012, number: "255" },
  { title: "Zákon o státní službě", year: 2014, number: "234" },
  { title: "Zákon o úřednících územních samosprávných celků a o změně některých zákonů", year: 2002, number: "312" },
  { title: "Zákon o obcích (obecní zřízení)", year: 2000, number: "128" },
  { title: "Zákon o krajích (krajské zřízení)", year: 2000, number: "129" },
  { title: "Zákon o hlavním městě Praze", year: 2000, number: "131" },
  { title: "Zákon o odpovědnosti za přestupky a řízení o nich", year: 2016, number: "250" },
  { title: "Zákon o některých přestupcích", year: 2016, number: "251" },
  { title: "Zákon o právu na informace o životním prostředí", year: 1998, number: "123" },
  { title: "Zákon o podpoře výzkumu a vývoje z veřejných prostředků a o změně některých souvisejících zákonů (zákon o podpoře výzkumu a vývoje)", year: 2002, number: "130" },
  { title: "Zákon o zvláštních podmínkách účinnosti některých smluv, uveřejňování těchto smluv a o registru smluv (zákon o registru smluv)", year: 2015, number: "340" },
  { title: "Zákon o ochraně oznamovatelů", year: 2023, number: "171" },
  { title: "Zákon o rovném zacházení a o právních prostředcích ochrany před diskriminací a o změně některých zákonů (antidiskriminační zákon)", year: 2009, number: "198" },
  { title: "Zákon o zadávání veřejných zakázek", year: 2016, number: "134" },
  { title: "Nařízení vlády o stanovení finančních limitů a částek pro účely zákona o zadávání veřejných zakázek", year: 2016, number: "172" },
  { title: "Vyhláška o stanovení rozsahu dokumentace veřejné zakázky na stavební práce a soupisu stavebních prací, dodávek a služeb s výkazem výměr", year: 2016, number: "169" },
  { title: "Vyhláška o stanovení paušální částky nákladů řízení o přezkoumání úkonů zadavatele při zadávání veřejných zakázek", year: 2016, number: "170" },
  { title: "Vyhláška o stanovení podrobnějších podmínek týkajících se elektronických nástrojů, elektronických úkonů při zadávání veřejných zakázek a certifikátu shody", year: 2016, number: "260" },
  { title: "Vyhláška o náležitostech obsahu žádosti o předchozí stanovisko k uzavření smlouvy a ke změně závazku ze smlouvy podle zákona o zadávání veřejných zakázek", year: 2016, number: "248" },
  { title: "Vyhláška o uveřejňování formulářů pro účely zákona o zadávání veřejných zakázek a náležitostech profilu zadavatele", year: 2023, number: "345" },
  { title: "Zákon o podpoře nízkoemisních vozidel prostřednictvím zadávání veřejných zakázek a veřejných služeb v přepravě cestujících", year: 2022, number: "360" },
  { title: "Zákon o podpoře regionálního rozvoje", year: 2000, number: "248" },
  { title: "Zákon o rozpočtových pravidlech a o změně některých souvisejících zákonů (rozpočtová pravidla)", year: 2000, number: "218" },
  { title: "Zákon o rozpočtových pravidlech územních rozpočtů", year: 2000, number: "250" },
  { title: "Zákon o finanční kontrole ve veřejné správě a o změně některých zákonů (zákon o finanční kontrole)", year: 2001, number: "320" },
  { title: "Vyhláška, kterou se provádí zákon č. 320/2001 Sb., o finanční kontrole ve veřejné správě a o změně některých zákonů (zákon o finanční kontrole), ve znění zákona č. 309/2002 Sb., zákona č. 320/2002 Sb. a zákona č. 123/2003 Sb.", year: 2004, number: "416" },
  { title: "Zákon o majetku České republiky a jejím vystupování v právních vztazích", year: 2000, number: "219" },
  { title: "Zákon o účetnictví", year: 1991, number: "563" },
  { title: "Vyhláška, kterou se provádějí některá ustanovení zákona č. 563/1991 Sb., o účetnictví, ve znění pozdějších předpisů, pro některé vybrané účetní jednotky", year: 2009, number: "410" },
  { title: "Vyhláška o rozpočtové skladbě", year: 2021, number: "412" },
  { title: "Zákon o pravidlech rozpočtové odpovědnosti", year: 2017, number: "23" },
  { title: "Zákon, kterým se mění některé zákony v souvislosti s přijetím právní úpravy rozpočtové odpovědnosti", year: 2017, number: "24" },
  { title: "Zákon o rozpočtovém určení výnosů některých daní územním samosprávným celkům a některým státním fondům (zákon o rozpočtovém určení daní)", year: 2000, number: "243" },
  { title: "Vyhláška o stanovení rozsahu a struktury údajů pro vypracování návrhu zákona o státním rozpočtu a návrhu střednědobého výhledu státního rozpočtu a lhůtách pro jejich předkládání", year: 2013, number: "133" },
  { title: "Vyhláška o zásadách a lhůtách finančního vypořádání vztahů se státním rozpočtem, státními finančními aktivy a Národním fondem (vyhláška o finančním vypořádání)", year: 2024, number: "433" },
  { title: "Vyhláška o účetních záznamech v technické formě vybraných účetních jednotek a jejich předávání do centrálního systému účetních informací státu a o požadavcích na technické a smíšené formy účetních záznamů (technická vyhláška o účetních záznamech)", year: 2009, number: "383" },
  { title: "Vyhláška o inventarizaci majetku a závazků", year: 2010, number: "270" },
  { title: "Vyhláška o požadavcích na schvalování účetních závěrek některých vybraných účetních jednotek", year: 2013, number: "220" },
  { title: "Zákon o kybernetické bezpečnosti", year: 2025, number: "264" },
  { title: "Zákon, kterým se mění některé zákony v souvislosti s přijetím zákona o kybernetické bezpečnosti", year: 2025, number: "265" },
  { title: "Zákon o odolnosti subjektů kritické infrastruktury a o změně souvisejících zákonů (zákon o kritické infrastruktuře)", year: 2025, number: "266" },
  { title: "Vyhláška o plánu odolnosti, posouzení rizik, opatřeních k zajištění odolnosti subjektů kritické infrastruktury a o hlášení incidentu", year: 2026, number: "122" },
  { title: "Vyhláška o Portálu Národního úřadu pro kybernetickou a informační bezpečnost a požadavcích na některé úkony", year: 2025, number: "334" },
  { title: "Vyhláška o bezpečnostních pravidlech pro orgány veřejné správy využívající služby poskytovatelů cloud computingu", year: 2025, number: "412" },
  { title: "Vyhláška o některých požadavcích pro zápis do katalogu cloud computingu", year: 2025, number: "505" },
  { title: "Zákon o kybernetické bezpečnosti a o změně souvisejících zákonů (zákon o kybernetické bezpečnosti)", year: 2014, number: "181" },
  { title: "Vyhláška o bezpečnostních opatřeních, kybernetických bezpečnostních incidentech, reaktivních opatřeních, náležitostech podání v oblasti kybernetické bezpečnosti a likvidaci dat (vyhláška o kybernetické bezpečnosti)", year: 2018, number: "82" },
  { title: "Vyhláška o významných informačních systémech a jejich určujících kritériích", year: 2014, number: "317" },
  { title: "Vyhláška o bezpečnostních úrovních pro využívání cloud computingu orgány veřejné moci", year: 2021, number: "315" },
  { title: "Vyhláška o některých požadavcích pro zápis do katalogu cloud computingu", year: 2021, number: "316" },
  { title: "Vyhláška o údajích vedených v katalogu cloud computingu", year: 2020, number: "433" },
  { title: "Vyhláška o bezpečnostních pravidlech pro orgány veřejné moci využívající služby poskytovatelů cloud computingu", year: 2023, number: "190" },
  { title: "Zákon o ochraně utajovaných informací a o bezpečnostní způsobilosti", year: 2005, number: "412" },
  { title: "Vyhláška o bezpečnosti informačních a komunikačních systémů a dalších elektronických zařízení nakládajících s utajovanými informacemi a o některých náležitostech žádosti o uzavření smlouvy o zajištění činnosti (vyhláška o informační bezpečnosti)", year: 2024, number: "479" },
  { title: "Vyhláška o zajištění kryptografické ochrany utajovaných informací a o některých náležitostech žádosti o uzavření smlouvy o zajištění činnosti", year: 2024, number: "447" },
  { title: "Nařízení vlády o katalogu oblastí utajovaných informací", year: 2024, number: "440" },
  { title: "Vyhláška o způsobilosti informačních a komunikačních systémů a samostatných elektronických zařízení, stínicích komor, zabezpečených oblastí a objektů k ochraně před únikem utajovaných informací kompromitujícím vyzařováním a o některých náležitostech žádosti o uzavření smlouvy o zajištění činnosti (vyhláška o kompromitujícím vyzařování)", year: 2024, number: "430" },
  { title: "Vyhláška o provádění certifikace při zabezpečování kryptografické ochrany utajovaných informací a o některých náležitostech žádosti o uzavření smlouvy o zajištění činnosti", year: 2024, number: "431" },
  { title: "Zákon o státní statistické službě", year: 1995, number: "89" },
  { title: "Vyhláška Českého statistického úřadu, kterou se stanoví postup při přípravě Programu statistických zjišťování", year: 2001, number: "394" },
  { title: "Vyhláška o Programu statistických zjišťování na rok 2026", year: 2025, number: "445" },
  { title: "Zákon o sčítání lidu, domů a bytů v roce 2021 a o změně zákona č. 89/1995 Sb., o státní statistické službě, ve znění pozdějších předpisů", year: 2020, number: "332" },
  { title: "Vyhláška, kterou se provádějí některá ustanovení zákona č. 332/2020 Sb., o sčítání lidu, domů a bytů v roce 2021 a o změně zákona č. 89/1995 Sb., o státní statistické službě, ve znění pozdějších předpisů", year: 2020, number: "490" },
  { title: "Vyhláška o Programu statistických zjišťování na rok 2025", year: 2024, number: "325" },
  { title: "Vyhláška o Programu statistických zjišťování na rok 2024", year: 2023, number: "316" },
  { title: "Vyhláška o Programu statistických zjišťování na rok 2022", year: 2021, number: "404" },
  { title: "Vyhláška o Programu statistických zjišťování na rok 2021", year: 2020, number: "466" },
  { title: "Vyhláška o Programu statistických zjišťování na rok 2020", year: 2019, number: "293" },
  { title: "Zákon České národní rady o zřízení ministerstev a jiných ústředních orgánů státní správy České socialistické republiky", year: 1969, number: "2" },
  { title: "Zákon o jednacím řádu Poslanecké sněmovny", year: 1995, number: "90" },
  { title: "Zákon o Sbírce zákonů a mezinárodních smluv a o tvorbě právních předpisů vyhlašovaných ve Sbírce zákonů a mezinárodních smluv (zákon o Sbírce zákonů a mezinárodních smluv)", year: 2016, number: "222" },
  { title: "Zákon, kterým se mění některé zákony v souvislosti s přijetím zákona o elektronických úkonech a autorizované konverzi dokumentů", year: 2008, number: "301" },
  { title: "Zákon, kterým se mění některé zákony v souvislosti s přijetím zákona o základních registrech", year: 2009, number: "227" },
  { title: "Zákon, kterým se mění některé zákony v souvislosti s přijetím zákona o službách vytvářejících důvěru pro elektronické transakce, zákon č. 106/1999 Sb., o svobodném přístupu k informacím, ve znění pozdějších předpisů, a zákon č. 121/2000 Sb., o právu autorském, o právech souvisejících s právem autorským a o změně některých zákonů (autorský zákon), ve znění pozdějších předpisů", year: 2016, number: "298" },
  { title: "Zákon, kterým se mění některé zákony v souvislosti s přijetím zákona o elektronické identifikaci", year: 2017, number: "251" },
  { title: "Zákon, kterým se mění některé zákony v souvislosti s další elektronizací postupů orgánů veřejné moci", year: 2021, number: "261" },
  { title: "Zákon, kterým se mění zákon č. 12/2020 Sb., o právu na digitální služby a o změně některých zákonů, ve znění pozdějších předpisů, a další související zákony", year: 2022, number: "471" },
  { title: "Zákon, kterým se mění zákon č. 12/2020 Sb., o právu na digitální služby a o změně některých zákonů, ve znění pozdějších předpisů, a další související zákony", year: 2024, number: "1" },
];

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
    allowedHosts: ["publications.europa.eu", "eur-lex.europa.eu"],
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
    description: "Vybraná účinná znění právních předpisů z oficiálních otevřených dat e-Sbírky.",
    homepage: "https://e-sbirka.gov.cz/open-data",
    topic: "pravo-cr",
    documentType: "regulation",
    targetDocuments: czechLawActs.length,
    syncMode: "open_data",
    allowedHosts: ["e-sbirka.gov.cz", "opendata.eselpoint.gov.cz"],
    seedUrls: [],
    crawlPathPrefixes: ["/sb/", "/sbr-cache/", "/souborove-sluzby/"],
    maxPages: 0,
    maxDocuments: czechLawActs.length,
    licenseNote: "Oficiální otevřená data e-Sbírky jsou dostupná bez registrace; AKB zachovává účinné znění, kanonický odkaz, datum verze a hash.",
    openDataActs: czechLawActs,
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
