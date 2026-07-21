# Profesionální znalostní chat AKB – technický realizační plán

## Cíl

AKB Chat je primární vstup zaměstnanců ke znalostem organizace. Musí poskytovat
věcně správné, dohledatelné a přístupově bezpečné odpovědi a současně zůstat
jednoduchý pro běžného uživatele.

Tento plán rozvíjí architekturu samostatného klienta popsanou v
`docs/ARCHITECTURE/standalone-chat-pwa.md`. Nemění vlastnictví dat:

- AKB spravuje dokumenty, verze, indexy, citace, konverzace a odpovědi;
- STRATOS poskytuje identitu, členství, aplikační přístup, capabilities a scopes;
- OpenSearch a Qdrant jsou odvozené vyhledávací indexy, nikoliv zdroj pravdy;
- PostgreSQL a objektové úložiště zůstávají autoritativními datovými vrstvami.

## Produktové principy

1. Odpověď začíná přímým výsledkem, ne technickým popisem interního zpracování.
2. Tvrzení nad dokumenty mají citaci na konkrétní neměnnou verzi.
3. Aktuální oprávnění se ověřuje při dotazu, načtení historie, otevření citace,
   exportu i sdílení.
4. Uživatel vidí jen funkce, které může skutečně dokončit.
5. Tabulka, graf a sestava vznikají z validovaných strukturovaných dat; graf
   není obrázek vygenerovaný jazykovým modelem.
6. Soukromý vložený dokument se nestane znalostí organizace bez samostatného
   publikačního procesu.
7. Při nedostatku zdrojů nebo výpadku autorizační vrstvy systém bezpečně odmítne
   odpověď a vysvětlí uživatelský další krok.

## Výchozí stav

Existující implementace již poskytuje:

- hybridní vyhledávání OpenSearch BM25 a Qdrant s RRF sloučením a rerankingem;
- autorizaci dokumentů před sestavením odpovědi;
- citace, bezpečné otevření zdroje, audit a řízený stav bez odpovědi;
- serverové konverzace, zprávy, archivaci a uživatelské či skupinové sdílení;
- strukturovaný kontrakt `report.v2`, tabulky a export do XLSX/PDF;
- samostatný OIDC klient a chat-only web na `chat.zeleznalady.cz`.

Nedokončené části jsou rozděleny do etap níže.

## P0 – bezpečný a provozně důvěryhodný základ

### P0-A: historie a odkazy na vlákna

Stav produkce 2026-07-18: nasazeno a ověřeno buildem, automatickými testy a
smoke scénářem vlastního i sdíleného vlákna.

Rozsah:

- načíst při serverovém renderu dostupná aktivní vlákna uživatele;
- respektovat autorizovaný parametr `?thread=<conversation_id>`;
- dohledat autorizované starší vlákno i mimo první stránku historie;
- zobrazit obecnou bezpečnou hlášku pro neexistující či nepřístupné vlákno;
- udržovat URL synchronizované s aktivním uloženým vláknem;
- nevytvářet odkaz ani sdílení pro klientské vlákno bez uložené konverzace;
- odstranit falešné automatické připnutí prvního vlákna.

Akceptace:

- reload stejné URL otevře stejné vlákno;
- odkaz otevřený oprávněným příjemcem zobrazí sdílené vlákno;
- neoprávněný příjemce neuvidí obsah ani informaci, zda vlákno existuje;
- při nedostupnosti historie lze založit nové vlákno bez ztráty bezpečnosti.

### P0-B: reautorizace historických odpovědí

Stav produkce 2026-07-18: fail-closed projekce je nasazena. Registry při načtení
historie znovu ověřuje každou citovanou neměnnou verzi a při neúspěchu vrací
`source_access_changed` bez odpovědi, citací a artefaktů. Release gate ověřil
reautorizaci a bezpečné skrytí při změně přístupu.

Rozsah:

- při každém načtení konverzace znovu vyhodnotit aktuální oprávnění ke všem
  citovaným verzím dokumentů;
- pokud již uživatel nemá přístup k některému zdroji, nezobrazit uložené znění
  odpovědi, její strukturované artefakty ani úryvky;
- vrátit bezpečný zástupný stav s informací, že se přístup ke zdrojům změnil;
- zapsat auditní událost bez textu odpovědi;
- stejné pravidlo použít pro vlastní i sdílené konverzace.

Akceptace:

- odebrání scope se projeví při nejbližším načtení historie;
- historie nikdy neslouží jako kopie dříve dostupného chráněného obsahu;
- výpadek policy decision služby vede k bezpečnému skrytí, nikoliv k povolení.

### P0-C: spravované sdílení a autorství

Stav produkce 2026-07-18: osoby, autorství a oprávnění komentátora jsou nasazeny. Volný text
byl nahrazen společným adresářovým pickerem; Registry při zápisu znovu ověřuje
existenci a aktivitu Keycloak identity, ukládá stabilní subject ID a bezpečný
zobrazovací snapshot. Každá zpráva má serverově odvozeného autora a typ
identity. Nové skupinové sdílení je záměrně fail-closed, dokud STRATOS
organizační adresář neposkytne ověřený kontrakt skupin.

Rozsah:

- nahradit volný text adresářovým výběrem aktivních osob a ověřených skupin;
- ukládat stabilní subject ID a bezpečný zobrazovací snapshot;
- doplnit ke každé zprávě autora, typ identity a čas;
- rozlišit oprávnění číst a přispívat;
- znemožnit vlastníkovi odebrat si vlastnictví;
- při změně sdílení provést reautorizaci historie.

Akceptace:

- nelze sdílet neexistujícímu nebo neaktivnímu subjektu;
- každá zpráva ve spolupráci má jednoznačné autorství;
- příjemce nezdědí přístupy vlastníka k dokumentům.

### P0-D: retence a odstranění

Stav produkce 2026-07-18: nasazeno. Registry fyzicky maže
vlastníkem potvrzená i retenčně expirovaná vlákna, přičemž zprávy a sdílení
odstraňuje ve stejné transakci pomocí cascade vazeb. Zůstává pouze obsahově
prázdný auditní doklad s počty a důvodem odstranění. Periodická úloha běží
okamžitě po startu a potom v konfigurovaném intervalu, takže po obnově databáze
zálohovaná expirovaná vlákna nezůstanou dostupná. Nové metriky se exportují
přes OTLP. Produkční migrace a provozní smoke prošly v pilotním releasu.

Rozsah:

- zavést periodickou purge úlohu nad `retention_until`;
- mazat zprávy a sdílení transakčně přes vazby s `ON DELETE CASCADE`;
- zachovat pouze obsahově prázdný auditní doklad podle auditní retenční politiky;
- doplnit ruční odstranění vlastního vlákna s potvrzením;
- měřit počet expirovaných a odstraněných záznamů.

Akceptace:

- expirované konverzace nejsou pouze skryté, ale fyzicky odstraněné;
- purge je idempotentní a má provozní metriku i audit;
- obnova ze zálohy respektuje následnou purge politiku.

### P0-E: měřitelná kvalita odpovědí

Stav implementace 2026-07-18: Evaluation Service poskytuje verzované datasety,
retrieval/answer metriky, historické porovnání, exportovatelný report a quality
gate. Chat ukládá hodnocení `pomohlo/nepomohlo` s omezeným důvodem bez volného
textu a exportuje agregovatelnou provozní metriku. Skript
`scripts/check_assistant_quality_release.py` fail-closed ověřuje dokončený
report, minimální počet gold případů, všechny způsobilé prahy a absenci regresí.
Produkční release `dc6bdf6263df37ce6ba1402813a64ee69d7b58dc` uzavřel P0-E
nad datasetem `professional_czech_knowledge_v1`: všech osm gold případů bylo
způsobilých, recall i nDCG dosáhly 100 %, podíl falešných nul byl 0 % a
zahřátá retrieval p95 latence byla 2 119 ms. Fail-closed release kontrola
potvrdila stav `passed` bez regrese v běhu `eval_run_02455940cef9`.

Rozsah:

- vytvořit reprezentativní český gold dataset pro statistickou službu, IT,
  eGovernment, veřejné zakázky, AI, architekturu a interní postupy;
- měřit retrieval recall, přesnost citací, groundedness, správné odmítnutí,
  latenci a podíl restricted odpovědí;
- zavést release gate s verzovanými prahy;
- přidat uživatelskou zpětnou vazbu „pomohlo/nepomohlo“ s důvodem bez ukládání
  citlivého textu dotazu do telemetrie.

Akceptace:

- každé produkční vydání má dohledatelný eval report;
- regresní práh blokuje vydání;
- provozní dashboard ukazuje kvalitu, dostupnost a latenci odděleně.

## P1 – profesionální konverzační práce

### Řízený vícekolový kontext

Stav produkce 2026-07-18: nasazeno. Z čerstvě autorizované
Registry historie se používají nejvýše čtyři předchozí uživatelské otázky a
celkově nejvýše 1 800 znaků. Staré odpovědi asistenta, citace ani skryté zdroje
se do modelového kontextu nepřenášejí.

- server sestaví omezenou historii relevantních předchozích tahů;
- kontext je velikostně omezený a odděluje instrukce, uživatelská tvrzení a
  citované znalosti;
- změna scope invaliduje dříve odvozený kontext;
- uživatel může zahájit nové vlákno bez přenosu starých předpokladů.

### Správa vláken

Stav produkce 2026-07-18: nasazeno. Přejmenování, serverové
připnutí, archivace, obnova, odstranění a filtry vlastních, sdílených a
archivovaných vláken používají jeden Registry kontrakt. Archiv je pouze pro
čtení a dotykové akce mají nejméně 44 × 44 px.

- přejmenovat, archivovat, obnovit a odstranit;
- připnout oblíbená vlákna až po zavedení serverově uloženého stavu;
- filtrovat vlastní, sdílená, archivovaná a naposledy použitá vlákna;
- podporovat klávesnici, čtečky obrazovky a mobilní dotykové cíle nejméně
  44 × 44 px.

### Profesionální odpověď

Standardní odpověď obsahuje podle potřeby:

1. přímou odpověď;
2. praktický postup nebo závěr;
3. datum platnosti či verzi zdrojů;
4. jasné rozlišení faktu, inference a chybějící informace;
5. konflikty mezi zdroji;
6. citace a doporučené navazující dotazy.

Interní termíny jako OIDC, RRF, scope projection nebo API se běžnému uživateli
nezobrazují mimo rozbalitelné technické podrobnosti.

## P2 – tabulky, grafy a sestavy

Stav první produkční etapy 2026-07-18: tabulky a `report.v2` zůstávají
autoritativním datovým kontraktem; explicitní požadavek na graf vytváří
deterministickou mapu `chart.v1` na validované sloupce stejné tabulky. Web
podporuje sloupcový, skládaný, spojnicový, koláčový a bodový graf bez
spustitelného HTML, skriptu nebo externí URL. Samostatné `metric.v1`,
`table.v1` a kompozitní `report.v3` zůstávají následnou kompatibilní evolucí,
nikoli podmínkou tohoto pilotního vydání.

Rozšířit strukturovaný kontrakt o artefakty:

- `metric.v1` pro jednu nebo více ověřených metrik;
- `table.v1` pro tabulku s typy sloupců, řádkovými citacemi a limity;
- `chart.v1` odkazující na validovaný dataset tabulky;
- `report.v3` skládající textové, metrické, tabulkové a grafové bloky.

Pravidla:

- backend validuje schéma, počet řádků, datové typy a citace;
- graf se vykresluje deterministicky z dat a nese stejnou autorizaci jako data;
- export při vytvoření znovu ověří oprávnění ke všem zdrojům;
- textový model nesmí vložit libovolný skript, HTML ani URL;
- každý artefakt má zdroj, čas vytvoření, stav úplnosti a upozornění.

První podporované grafy:

- sloupcový a skládaný sloupcový;
- spojnicový pro časovou řadu;
- koláčový pouze pro malé části jednoho celku;
- bodový pro korelace s dostatečným počtem pozorování.

## P3 – analýza vložených dokumentů v chatu

Stav produkčního vydání 2026-07-18: záměrně není zapnuto. Stávající upload
session ukládá řízený dokument a nesplňuje požadovanou thread-scoped retenci,
malware kontrolu a úplné odstranění dočasných chunků. Dokud nebude tento
samostatný bezpečnostní kontrakt implementován a akceptován, chat nezobrazuje
nefunkční nebo zavádějící tlačítko přílohy. Publikace dokumentu do AKB nadále
probíhá pouze řízeným dokumentovým workflow.

Uživatelské rozhraní musí výslovně oddělit dvě akce:

- **Analyzovat dočasně** – soubor je soukromý pro vlákno, má krátkou retenci a
  nevstupuje do organizační znalostní báze;
- **Publikovat do AKB** – řízený dokument s vlastníkem, policy bindingem,
  klasifikací, verzí a schvalovacím postupem.

Dočasná analýza vyžaduje:

- malware a formátovou kontrolu, volitelnou DLP bránu podle provozního profilu;
- OCR a extrakci v izolovaném jobu;
- thread-scoped index nepoužitelný z jiné konverzace;
- citace na stranu, oddíl, list nebo snímek;
- automatické odstranění binárního souboru, textu, chunků a indexu;
- zákaz sdílení bez nového explicitního potvrzení vlastníka souboru.

## API a datové změny

Předpokládané změny kontraktů:

- `assistant_messages.author_subject_id`, `author_subject_type` a bezpečný
  zobrazovací snapshot;
- serverově uložené `pinned_at` a uživatelsky měnitelný název konverzace;
- adresářový endpoint nebo STRATOS BFF pro vyhledání sdílených subjektů;
- explicitní stav historické zprávy `available | source_access_changed`;
- delete endpoint a interní idempotentní purge operace;
- verzované artefakty a dataset references;
- privátní attachment session a její retenční stav.

Každá změna API vyžaduje aktualizaci `openapi/openapi.json`, příslušných
service-local kontraktů, migrace, testů a provozní dokumentace.

## Pořadí nasazení

1. P0-A historie a deep linky.
2. P0-B reautorizace historického obsahu.
3. P0-C adresářové sdílení a autorství.
4. P0-D purge a odstranění.
5. P0-E eval dataset, report a release gate.
6. Omezený pilot se zaměstnanci.
7. P1 konverzační práce a správa vláken.
8. P2 strukturované tabulky, grafy a sestavy.
9. P3 dočasná analýza vložených dokumentů.

P0-B až P0-E jsou podmínkou pro rozšíření z technického ověření na běžný
organizační pilot. P2 a P3 lze vydávat postupně po samostatných bezpečnostních a
uživatelských akceptacích.

## Realizační záznam

### 2026-07-18 – první P0 změna

Implementováno:

- serverové načtení aktivní historie chatu;
- autorizované deep linky `?thread=<conversation_id>`;
- dohledání staršího autorizovaného vlákna mimo první stránku seznamu;
- bezpečný stav pro nepřístupný odkaz a výpadek historie;
- synchronizace URL s uloženým aktivním vláknem;
- zákaz odkazu a sdílení klientského vlákna před prvním uložením;
- odstranění falešného automatického připnutí;
- reautorizace každé citované neměnné verze při načtení historické odpovědi;
- fail-closed `source_access_changed` bez textu, citací a strukturovaných
  metadat při změně nebo nedostupnosti přístupu;
- zachování historie nad přesnou platnou verzí kurátorovaného oficiálního
  veřejného zdroje pro přihlášeného zaměstnance s `akb:chat` a veřejným scope,
  bez možnosti přímého čtení dokumentu;
- aktualizace TypeScript typů, Registry schématu a OpenAPI kontraktů.

Ověření:

- web typecheck;
- 242 webových testů;
- 149 Registry testů, 1 přeskočený;
- produkční Next.js build;
- skeleton a OpenAPI validace.

Před nasazením:

- end-to-end ověřit vlastní a sdílené vlákno nad produkčně podobnou access
  projection;
- ověřit odebrání scope mezi vytvořením a znovunačtením odpovědi;
- doplnit provozní auditní metriku pro `source_access_changed`.

### 2026-07-18 – druhá P0 změna

Implementováno:

- samostatný `rag.query` adresářový kontrakt pro chat bez udělení workflow nebo
  administrativních oprávnění;
- sdílení pouze výběrem aktivní Keycloak identity ze společného STRATOS
  `DirectoryPersonPicker`;
- opakované ověření příjemce v Registry při každém zápisu sdílení;
- bezpečný zobrazovací snapshot příjemce a stabilní subject ID;
- odmítnutí neexistujícího či neaktivního uživatele a nových neověřených skupin;
- serverově odvozené autorství uživatelských, asistenčních a komentátorských
  zpráv;
- migrace existující historie a sdílení bez ztráty konverzací;
- sdílená transformace Keycloak osob pro workflow a chat bez duplikované UI
  logiky.

Ověření:

- 243 webových testů a web typecheck;
- 153 Registry testů, 1 přeskočený;
- produkční Next.js build včetně `/api/assistant/directory`;
- shoda dotčených FastAPI a service-local OpenAPI schémat;
- root OpenAPI, skeleton a diff kontrola;
- vizuální smoke dialogu, adresářového popoveru, hledání a výběru osoby v
  lokálním chat-only profilu.

### 2026-07-18 – produkční pilotní release

Nasazeno:

- immutable merge commit `dc6bdf6263df37ce6ba1402813a64ee69d7b58dc`;
- Registry migrace `0022_assistant_feedback` a `0023_assistant_pinning`;
- samostatný chat na kanonické route `https://chat.zeleznalady.cz/`;
- permanentní přesměrování starých `/chat` a `/assistant` odkazů na `/` se
  zachováním query parametrů;
- P0-E quality gate `eval_run_02455940cef9` s 8/8 gold případy, 100% recall,
  100% nDCG, 0% falešnými nulami a retrieval p95 2 119 ms;
- živý produkční dotaz na právní předpis pro informační systémy veřejné správy
  s odpovědí podle zákona č. 365/2000 Sb. a autorizovanými citacemi;
- manifest, service worker, všechny deklarované PWA ikony, aktualizační tok,
  serverovou historii a vytvoření i odstranění testovacího vlákna.

Pro P0, P1 a první produkční etapu P2 prošly automatické testy, immutable
release verification, health/readiness a veřejné smoke kontroly. P3 zůstává
záměrně oddělenou etapou: dočasné přílohy se nezapnou bez thread-scoped
retence, malware kontroly a úplného odstranění binárních i odvozených dat.
Fyzická instalace a odinstalace na konkrétních spravovaných iOS/Android
zařízeních je součástí uživatelské akceptace pilotu, nikoli serverového release
gate.

## Definition of Done každé etapy

- změna má automatické testy a aktualizovanou dokumentaci;
- prošel typecheck, relevantní testy, produkční build a skeleton/OpenAPI check;
- nové chybové stavy jsou uživatelsky srozumitelné a fail-closed;
- logy neobsahují dotazy, odpovědi, dokumentová těla ani tokeny;
- autorizace je ověřena na vlastní, sdílené, odebrané a expirované variantě;
- desktop, tablet, mobil, klávesnice a čtečka obrazovky mají akceptační scénář;
- produkční nasazení má rollback bod, health/readiness smoke a dohledatelný eval
  report.
