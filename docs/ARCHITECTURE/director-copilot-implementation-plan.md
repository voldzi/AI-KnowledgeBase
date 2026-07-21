# AKB Chat jako Copilot ředitele - realizační plán

Stav: schválený návrh k realizaci, bez produktových změn v tomto commitu.

Baseline: AKB `786bc2bd7c7a964efd3c078d930eebbba06209c7`, produkčně ověřeno
2026-07-21.

Vstupní analýza: `STRATOS_AKB_Chat_Copilot_reditele_analyza.docx`, STRATOS,
2026-07-20.

## 1. Závazné produktové rozhodnutí

Copilot ředitele vznikne jako nejvyšší schopnostní profil stávajícího AKB Chatu,
nikoli jako nová aplikace, druhá historie nebo paralelní AI vrstva.

- Uživatel zůstává ve stejném chatu, se stejnou historií, citacemi, auditem a
  source viewerem.
- Profil nikdy neuděluje oprávnění. Pouze zpřístupní nástroje, které odpovídají
  aktuálním capabilities a scopes uživatele ve zdrojových aplikacích.
- AKB smí federovat a vysvětlovat data, ale nepřebírá vlastnictví rozpočtů,
  projektů, potřeb, AI podnětů ani portfoliových agregací.
- První produkční režim je výhradně read-only. Zápisové akce zůstávají ve
  zdrojových aplikacích a později budou možné jen s explicitním potvrzením.
- Každý výsledek oddělí ověřená strukturovaná fakta, dokumentová zjištění, AI
  interpretaci a nejistoty.

## 2. Dnešní připravenost a skutečná mezera

### Již použitelné základy

- permission-aware hybridní retrieval nad OpenSearch/Qdrant, reranking a
  no-answer policy;
- Registry dokumentů, neměnné verze, source opening, citace a audit;
- serverová historie chatu, retence, sdílení s osobami a reautorizace historie;
- aktuální STRATOS access projection, capabilities, scopes a Information Policy
  V2;
- jednoduchý auditovatelný router se dvěma nástroji:
  `registry_document_report` a `rag_document_answer`;
- deterministický `assistant_query_plan`, avšak pouze pro jeden nástroj;
- `report.v2`, řádkové citace, `chart.v1` a bezpečný export XLSX/PDF;
- entity a vztahy z dokumentových chunků v Intelligence Workbench;
- řízené extrakční profily pro Budget a ArchFlow.

### Co dnes chybí

1. AKB nemá read-only klienty pro živá data AIIP, ArchFlow, Budget,
   ProjectFlow a Executive Center.
2. Současný plánovač neumí více nástrojů, závislosti, kanonické entity,
   paralelní běh, částečný výsledek ani časový snapshot.
3. Současné reporty rozlišují Registry metadata a dokumentové citace, ale nemají
   společný důkazní kontrakt pro živé strukturované hodnoty.
4. `AnalystEvidenceItem` je dokumentový záznam analytického spisu; není
   neměnným mezidoménovým důkazem a nesmí být bez změny významu použit jako
   kontrakt Copilota.
5. AKB umí XLSX/PDF tabulku, ale ne jednotný analytický snapshot pro PPTX,
   DOCX, XLSX, PDF a briefing.
6. RAG assistant má výchozí `classification_max=internal`. Cílový limit musí být
   serverově odvozen z aktuální access projection a policy každého zdroje, nikdy
   z browseru nebo statické role.
7. Stávající AI endpointy Budgetu a ProjectFlow nelze zpětně použít jako nástroje
   Copilota, protože samy volají AKB a vytvořily by AI/RAG cyklus. Zdrojové
   aplikace musí vystavit čisté deterministické read-modely bez dalšího LLM.

## 3. Cílová architektura

```text
AKB Chat / stejné vlákno
        |
        v
AKB web BFF + Assistant Orchestrator
        |
        +--> Query Plan v2 + canonical entity resolution
        |
        +--> čerstvá STRATOS access projection + OBO/delegovaný token
        |
        +--> read-only domain tools
        |      AIIP | ArchFlow | Budget | ProjectFlow | Executive | AKB
        |
        +--> Evidence normalizer + strictest policy derivation
        |
        +--> immutable AnalysisSnapshot
        |
        +--> syntéza odpovědi / Artifact Engine
               chat | tabulka | graf | briefing | XLSX | PDF | DOCX | PPTX
```

Browser nikdy nevolá doménová API, Registry, RAG, LLM ani storage přímo.
Orchestrátor bude nejprve serverovým modulem za stávajícím BFF a veřejným chat
kontraktem. Samostatná služba vznikne pouze tehdy, když periodické úlohy,
frontování artefaktů nebo provozní škálování prokážou potřebu extrakce.

Každá zdrojová aplikace znovu ověří cílové audience, identitu služby, aktéra,
capability a scope. Kontrola v AKB nenahrazuje PEP zdrojové aplikace.

## 4. Nové závazné kontrakty

### 4.1 DomainTool v1

Každý nástroj bude mít verzovaný manifest a OpenAPI kontrakt:

- stabilní `tool_id`, `schema_version` a vlastnickou aplikaci;
- požadovanou capability a podporované scope typy;
- omezené, typované a stránkované vstupy bez volného SQL nebo promptu;
- `generated_at`, `as_of`, verzi/ETag read-modelu a stabilní entity ID;
- typované hodnoty, jednotky, měnu, období a bezpečný deep link;
- policy lineage zdrojového resource a případná exportní obligations;
- explicitní `partial`, `stale`, `unavailable` a `not_authorized` stav;
- pevné limity velikosti, timeout, cursor a retry pravidla.

První katalog nástrojů:

| Zdroj | První read-only nástroje |
| --- | --- |
| AKB | dokumentový retrieval, metadata, citace, konflikty a platnost |
| Budget | plán/skutečnost/forecast, cashflow, smlouvy, dodavatelé, VZ/NEN a odchylky |
| ProjectFlow | projektový snapshot, milníky, status, RAID, kapacity a závislosti |
| ArchFlow | potřeby, požadavky, cíle, readiness, rozhodnutí a handoff stav |
| AIIP | podněty, hodnocení, duplicity, pipeline a stav přínosů |
| Executive | autorizované portfolio agregace, výjimky, rozhodnutí a snapshoty |

### 4.2 EvidenceItem v1

Každé tvrzení bude normalizováno do jednoho z typů:

- `structured_fact` - živá hodnota ze zdrojové aplikace;
- `document_finding` - tvrzení s AKB citation coordinates;
- `interpretation` - odvození odkazující pouze na jiné evidence IDs;
- `uncertainty` - chybějící, konfliktní, zastaralý nebo nepřístupný údaj.

Společné minimum obsahuje:

- evidence ID, typ, source system, entity type/ID a source version;
- `as_of`, `retrieved_at`, období, jednotku a měnu, pokud dávají smysl;
- scope coordinates a bezpečný deep link;
- governed resource, policy binding/version/hash, klasifikaci, audience a
  obligations;
- hash normalizovaného zdrojového výsledku;
- quality/confidence a odkazy na vstupní evidence u interpretace.

Dokumentový důkaz navíc nese document/version/chunk/page/section. Živý údaj se
nesmí vydávat za dokumentovou citaci a historický dokument se nesmí vydávat za
aktuální hodnotu.

### 4.3 QueryPlan v2

Plán bude neměnný a auditovatelný. Obsahuje:

- intent, období, publikum, požadovaný artefakt a rozhodovací účel;
- rozpoznané kanonické entity a případné bezpečné upřesnění uživatelem;
- DAG kroků s nástrojem, vstupy, závislostmi, limity a timeouty;
- capability/scope požadavky každého kroku;
- očekávané evidence typy a quality gates;
- pravidla pro partial/no-answer a výsledný export.

Plánovač nesmí sám rozšiřovat scope. Nezávislé kroky běží paralelně, závislé až
po validaci jejich vstupů. Neznámá entita nebo nejednoznačné období vede k
upřesnění, ne k hádání.

### 4.4 AnalysisSnapshot v1

Jeden neměnný a velikostně omezený snapshot spojí:

- query plan a jeho verzi;
- hash čerstvé access projection, nikoli její neověřené browserové tvrzení;
- normalizované evidence items a seznam nedostupných zdrojů;
- výslednou strictest policy a source lineage;
- výpočty, jednotky, období a metodiku;
- auditní correlation IDs a čas vytvoření.

Snapshot neukládá raw doménové odpovědi, tajemství ani logovací kopii promptu.
Je odvozeným důkazním balíčkem, nikoli novým source of truth. Jednorázový
konverzační snapshot vlastní AKB a podléhá retenci vlákna. Publikovaný nebo
periodický manažerský report vlastní Executive Center a odkazuje na AKB snapshot
a případný řízený dokument v AKB.

### 4.5 Artifact Package

Stávající `report.v2` a `chart.v1` zůstanou kompatibilní. Evoluce přidá
`metric.v1`, `table.v1`, `report.v3` a balíček, který váže všechny výstupy na
stejný `analysis_snapshot_id`.

- PPTX, DOCX/PDF, XLSX/CSV a briefing vznikají pouze serverově.
- Generátory nevolají LLM; dostávají validovaný snapshot a šablonu.
- Každá tabulka a graf má source notes; každé důležité tvrzení evidence refs.
- Export před vytvořením znovu ověří aktuální přístup ke všem zdrojům.
- `NO_EXPORT` export zablokuje. `WATERMARK` jej povolí až po implementaci
  povinného watermarku. `LOCAL_PROCESSING_ONLY` zakáže vzdáleného providera.
- Různý `as_of` čas mezi zdroji musí být viditelný, ne skrytý.

## 5. Realizační etapy

### Etapa 0 - kontrakty, bezpečnost a měření

Rozsah:

- ADR cílové architektury a vlastnictví dat;
- OpenAPI/JSON Schema pro DomainTool, EvidenceItem, QueryPlan a AnalysisSnapshot;
- centrální rozhodnutí o OBO/delegovaném tokenu a cílových audiences;
- capability/scope matice bez nové statické role `director`;
- cross-domain eval dataset a provozní SLI baseline;
- contract fixtures pro pozitivní i fail-closed scénáře.

Výstupní brána:

- byte-identical kontrakty ve všech vlastnících;
- žádný browserový přímý přístup a žádná důvěra ve statický claim/hlavičku;
- source aplikace odsouhlasí limity, deep links, policy lineage a časovou
  semantiku.

### Etapa 1 - první vertikální řez Budget + ProjectFlow + AKB

Implementovat otázku:

> Které projekty mají současně rozpočtovou odchylku, zpožděný milník a smluvní
> riziko?

Rozsah:

- Budget a ProjectFlow read-only nástroje bez LLM;
- canonical ID vazby projekt/smlouva/procurement/document;
- QueryPlan v2 s paralelním načtením;
- EvidenceItem normalizace a strictest policy;
- čtyřvrstvá chatová odpověď s as-of časem a partial stavem;
- pouze stávající chat, bez nového menu a bez zápisových akcí.

Výstupní brána:

- každé číslo má strukturovaný zdroj; každé smluvní tvrzení AKB citaci;
- odebrání libovolného scope se projeví při dalším dotazu i načtení historie;
- výpadek jednoho zdroje vede k označenému partial výsledku, nikoli k odhadu;
- žádná data mimo efektivní scope se neobjeví v odpovědi, počtech ani auditu.

### Etapa 2 - úplná read-only federace a schopnostní profily

Rozsah:

- přidat ArchFlow, AIIP a Executive nástroje;
- rozšířit canonical entity resolver o potřeby, podněty, portfolio a vazby;
- v chatu nabídnout pouze zužující pracovní režimy `Automaticky`, `Projekt`,
  `Finance` a `Vedení`, odvozené z aktuálních grantů;
- evidence panel s typem zdroje, as-of časem, klasifikací, nejistotou a deep
  linkem;
- bezpečné pokračování dotazu v témže vlákně.

Výstupní brána:

- pět referenčních scénářů ze vstupní analýzy projde nad všemi zdroji;
- management organization scope nikdy neobchází policy zdrojové entity;
- profil pouze zužuje nástroje a nikdy nerozšiřuje capability nebo scope.

### Etapa 3 - továrna manažerských artefaktů

Pořadí:

1. jednostránkový briefing;
2. XLSX/CSV sestava ze živých faktů;
3. DOCX + distribuční PDF;
4. editovatelná PPTX prezentace;
5. saved view/dashboard nad verzovaným snapshotem.

Generování PPTX/DOCX a delší úlohy budou backendové a frontované; web BFF pouze
založí úlohu, ukáže stav a bezpečně vydá výsledek. Po provozním ověření může být
Artifact Engine vyčleněn do samostatné služby.

Výstupní brána:

- všechny formáty pro jednu poradu mají shodný snapshot, metodiku a lineage;
- grafy vznikají z typovaných dat, nikoli jako obrázek z LLM;
- exportní policy, watermark, recipient set a reautorizace jsou vynuceny;
- binární artefakt se bez explicitního publish kroku neukládá jako nový řízený
  dokument.

### Etapa 4 - pravidelné briefingy, watchlisty a konflikty

Rozsah:

- uložené autorizované dotazy a šablony;
- denní/týdenní/měsíční/čtvrtletní snapshoty a diff;
- watchlisty změn, výjimek a nových dokumentů;
- normativní a smluvní conflict evidence;
- auditovaná distribuce pouze recipient setu, který projde aktuální policy.

Výstupní brána:

- změna proti předchozímu snapshotu je vysvětlitelná po jednotlivých evidence
  items;
- změna metodiky je verzovaná a viditelná;
- plánovaný běh bez platného aktéra nebo oprávněné automatizace fail-closed.

### Etapa 5 - řízené akce s potvrzením

Tato etapa není součástí prvního produkčního cíle. Copilot může později připravit
návrh akce, ale:

- nikdy nezapisuje přímo do doménové databáze;
- ukáže přesný návrh, cílovou aplikaci, dopad, policy a idempotency key;
- uživatel potvrzuje v kontextu zdrojové aplikace;
- zdrojová aplikace znovu autorizuje a audituje zápis.

## 6. Vlastnictví realizace

| Vlastník | Odpovědnost |
| --- | --- |
| AKB | chat UX, planner v2, orchestrátor, entity resolution, EvidenceItem, snapshot, syntéza, artefakty, citace, audit a evaluace |
| STRATOS Platform | access projection, OBO/token exchange, centrální capabilities/scopes, policy decision, canonical integration envelope |
| AIIP/ArchFlow/Budget/ProjectFlow/Executive | autoritativní read-only nástroje, stabilní ID, deep links, as-of/source version, lokální PEP a contract fixtures |
| `stratos-ui` | pouze obecně znovupoužitelné evidence/artifact/job komponenty; AKB vlastní doménovou skladbu chatu |

Stávající AI endpointy zdrojových aplikací nejsou DomainTool API. Vlastníci musí
dodat oddělené deterministické read-modely, aby nevznikla rekurze AKB -> zdrojová
AI -> AKB.

## 7. Testovací a release strategie

### Povinné scénáře

- rozpočet + milník + smluvní riziko;
- schválené potřeby bez financí nebo kapacity;
- dopad nové normy na aktivní projekty a interní pravidla;
- překryv AI podnětů s potřebami a projekty;
- měsíční podklad pro vedení ze stejného snapshotu do PPTX/DOCX/XLSX/PDF.

### Negativní scénáře

- chybějící nebo expirovaná access projection;
- capability bez odpovídajícího scope;
- odvolání scope mezi plánem, tool callem, syntézou a exportem;
- neznámá policy, neplatný hash, silnější klasifikace a `NO_EXPORT`;
- nedostupný zdroj, stale data, rozdílné měny/jednotky a konfliktní hodnoty;
- prompt injection v názvu, popisu nebo dokumentu;
- source API vrátí entitu mimo požadovaný scope;
- artefakt nebo historie otevřená po pozdější ztrátě přístupu.

### Quality gate

Vznikne verzovaný dataset `director_copilot_v1` s minimálně:

- cross-domain retrieval/tool selection accuracy;
- entity-resolution precision;
- evidence coverage zásadních tvrzení;
- správným rozlišením fakt/document finding/interpretation/uncertainty;
- temporal accuracy a správnými jednotkami;
- no-answer/partial-answer přesností;
- nulovým únikem mimo scope;
- shodou snapshotu napříč exportními formáty;
- měřenou latencí plánování, jednotlivých nástrojů, syntézy a artefaktů.

Konkrétní p95 prahy se uzamknou po etapě 0 z reálné baseline. Release gate nesmí
nahrazovat nedostupný zdroj odhadem ani snižovat bezpečnost kvůli latenci.

## 8. Provozní zásady

- Audit ukládá plan ID/verzi, tool IDs, source IDs/verze, počty, hashe, policy
  lineage, časování a correlation IDs; neukládá plné doménové payloady, prompty,
  odpovědi ani dokumentová těla.
- Každý tool má timeout, circuit breaker, velikostní limit a metriku
  success/deny/partial/error/latency.
- Nezávislé nástroje se volají paralelně, ale fan-out je pevně omezený.
- Výsledky různých uživatelů se nesdílejí cache. Případná cache je vázaná na
  aktéra, projection hash, scope, tool schema, parametry a krátké TTL.
- Analysis snapshot a historie se při každém načtení reautorizují.
- Produkční změna má immutable release, rollback, health/readiness, contract
  smoke a dohledatelný eval report.

## 9. Bezprostřední pracovní pořadí

1. Schválit tento plán jako architektonický baseline a vytvořit ADR.
2. Sepsat `DomainTool v1`, `EvidenceItem v1`, `QueryPlan v2` a
   `AnalysisSnapshot v1` jako JSON Schema/OpenAPI s fixtures.
3. Předat STRATOS, Budget a ProjectFlow konkrétní handoff pro první vertikální
   řez včetně OBO a policy požadavků.
4. Rozšířit cross-domain eval dataset ještě před implementací orchestrátoru.
5. Implementovat Budget + ProjectFlow + AKB vertikální scénář end-to-end.
6. Teprve po jeho bezpečnostní a kvalitativní akceptaci přidat další zdroje a
   UI schopnostní profily.
7. Artefaktovou továrnu zahájit až nad stabilním AnalysisSnapshot kontraktem;
   negenerovat PPTX/DOCX přímo z volného textu chatu.

## 10. Mimo první rozsah

- automatický zápis do zdrojových aplikací;
- nahrazení Executive Center, Budgetu, ProjectFlow, ArchFlow nebo AIIP;
- kopírování živých doménových tabulek do AKB jako druhého source of truth;
- samostatná aplikace nebo druhá historie Copilota;
- automatické rozšíření oprávnění pro management;
- skryté použití zastaralého snapshotu jako živého stavu;
- generování manažerských artefaktů bez evidence a strictest policy.

## 11. Údržba plánu

Po každé dokončené etapě aktualizovat stav, commit/release, eval report,
akceptační důkazy a zbývající rizika. Historický plán nesmí zůstat označený jako
aktuální, pokud se změnil kontrakt, vlastnictví nebo produkční stav.
