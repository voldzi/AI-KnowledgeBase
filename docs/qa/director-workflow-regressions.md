# Ověření workflow ředitele IT

## Rozsah a stav

Ověření z 28. 8. 2026 vychází z produkčního uživatelského průchodu na releasu
`9e0e0a74af68b60cc07ac1200405b3dd71e4d951`. Následující opravy jsou ověřované
lokálně. Tento dokument není potvrzením jejich produkčního nasazení ani
neomezeného přístupu testovaného uživatele.

Produkční průchod zahrnoval registr, hledání, náhled dokumentu, řízená pravidla,
citace, Moji práci, správu vláken a 17 chatových dotazů. Nahrávání, schvalování
a publikování nebylo pod čtenářským účtem provedeno: aktuální projekce tyto
akce nepovoluje. Kvůli testu se oprávnění nerozšiřovala a dokumenty se neměnily.

## Opravy a důkazy

| Problém | Oprava | Ověření |
|---|---|---|
| Volba pohledu v Mojí práci vytváří `/akb/akb/tasks` a končí mimo požadovaný seznam | Router dostává cestu bez opakovaného base path | Lokální prohlížeč: Moje dokumenty zůstanou na `/akb/tasks?view=documents`; unit testy navigace |
| Návrat z dokumentu ztrácí filtr po ověření relace | Návratová cesta zachovává query parametry, včetně opakovaných hodnot | Lokální prohlížeč: hledání → detail → zpět zachová `q`; testy `document-navigation` |
| Stav uživatelských preferencí může přepsat ověřené role a capability | Preference mění jen prezentaci stejného ověřeného subjektu; navigace čeká na ověřenou identitu | Testy `reader-workflow-boundaries`; statická 404 již nevkládá identitu z doby buildu |
| Navazující dotaz na nejdražší položku použije nesprávnou granularitu | Kontext zachová období, metriku a organizační rozsah; plánovaná akce se neplete s rozpočtovou položkou | Unit testy resolveru a celý mock chatový průchod včetně evidence gate |
| Nové téma ArchFlow přebírá historický rok z Budgetu | Nová doména začíná nový kontext, pokud uživatel výslovně neodkazuje zpět | Testy změny tématu a explicitního aktuálního období |
| Nedokončený text modelu se vydává za úplnou odpověď | Vyžadováno `finish_reason=stop`; stream navíc musí skončit `[DONE]`; jinak `LLM_ANSWER_INCOMPLETE`, bez potvrzených citací | Pozitivní i negativní testy HTTP, streamu, composeru a zaměstnaneckého chatu |
| Čtenář vidí neověřené návrhy pravidel a spouští zbytečný globální audit | Čtenářský pohled obsahuje ověřená pravidla; Registry odmítá neověřené návrhy bez správcovského/publikačního oprávnění | Registry: běžné čtení 200, neověřené návrhy 403, oprávněný správce 200 |
| Odkaz na pravidlo neobsahuje přesnou verzi dokumentu | Odkaz nese verzi, úsek i stránku; neshodný zdroj se nezobrazí | Testy odkazů a kontroly identity citace; při chybě úseku zůstává náhled přesné verze |
| Zavírání citace překrývá hlavička a opožděné načítání může vrátit starý obsah | Sdílený `stratos-ui` Dialog, správná vrstva a rušení starých požadavků | Lokální prohlížeč: zavření tlačítkem, návrat focusu, celá obrazovka 1280 × 720 |
| Chat neumí přímo zobrazit vlastní úkoly, schvalování a spravované dokumenty | Samostatný nástroj čte osobní frontu Registry, bez LLM; zobrazuje autorizovaný počet a nejvýše pět záznamů | Pozitivní dotazy, odmítnutí jiných lidí, historických nebo nepodporovaných filtrů, nedostupnost a neúplná stránka |
| Osobní fronta by mohla zůstat v historii sdíleného vlákna | Před vydáním se znovu ověří oprávnění; do historie se ukládá pouze neutrální výzva k obnovení, nikoli názvy, počty nebo identifikátory záznamů | Test skutečné ukládací funkce nad mock Registry, změna scope/uživatele a selhání uložení; odpověď `no-store` |
| Prázdná nebo částečná odpověď může mít zavádějící označení vysoké jistoty | Uživatelský stav upřednostňuje konflikt, omezení, částečnost, výpadek a chybějící data před jistotou | Patnáct testů prezentace stavů; mobilní scénáře pro partial, no_data, conflict a unavailable |
| Upozornění se opakují nebo skrývají důvod neúplnosti | Shodná vysvětlení se slučují; věcná omezení jsou viditelná česky nebo anglicky, neznámý technický kód se nepropíše do textu | Chybějící schválený plán není nula; drift není transportní chyba; neúplný počet a konflikt zůstávají označené |
| Interní odkaz z chatu zbytečně otevírá další záložku | Bezpečná lokální cesta se otevře ve stejném okně; externí odkazy zůstávají oddělené | Lokální prohlížeč: osobní přehled → Moje práce, bez změny původní cesty na dvojitý base path |
| Roztažené postranní panely mohou odříznout ovládání | Šířky respektují dostupný prostor, střed chatu zůstává použitelný | Lokální prohlížeč 1440 × 900: oba panely na maximum, zavření i pole dotazu uvnitř viewportu |
| Mobilní pole neumožňuje pohodlně přečíst rozepsaný delší dotaz | Krátký placeholder a růst pole do 120 px; po odeslání se vrátí kompaktní výška | Lokální prohlížeč 390 × 844: tři řádky, dostupné odeslání a zmenšení prázdného pole |

Výchozí limit dokumentové odpovědi je 1536 výstupních tokenů. Změna nenahrazuje
kontrolu dokončení. Explicitní provozní nastavení má přednost a při nasazení se
musí ověřit. Úmyslně se neprovádí automatické pokračování, které by mohlo spojit
neověřené fragmenty do zdánlivě dokončené odpovědi.

## Automatizované kontroly

- Web: 764 testů prošlo; TypeScript prošel. Součástí je 58 testů osobního
  workflow, dva testy bezpečného ukládání a 15 testů prezentace odpovědi.
- RAG retrieval: 260 testů prošlo.
- Registry: 337 testů prošlo, jeden test byl přeskočen. Vyžaduje samostatný
  PostgreSQL administrátorský přístup pro destruktivní migrační fixture;
  nespouštět jej proti produkční databázi.
- Kontrola skeletonu a shody OpenAPI prošla.
- Gitleaks nenašel tajné údaje ve změněných ani deseti nových souborech;
  kontrola měla plně redigovaný výstup a není auditem celé historie repozitáře.
- Produkční Docker Compose se vzorovým prostředím prošel kontrolou `config
  --quiet`; nebyl spuštěn ani změněn žádný produkční kontejner.
- Všechny čtyři dotčené obrazy (`web`, `chat-web`, `registry-api`,
  `rag-retrieval-service`) se lokálně sestavily pro `linux/amd64` ze skutečných
  produkčních Dockerfile a odpovídajících build kontextů. Nejde o publikované
  release obrazy ani náhradu CI nad finálním commit SHA.
- V nově sestaveném Linuxovém obrazu RAG prošlo znovu všech 260 testů bez
  přístupu k síti. Jde o druhé ověření stejné sady, nikoli dalších 260 testů.
- Celá lokální Playwright sada prošla: 34 scénářů s base path `/akb`, včetně
  mobilního a tabletového rozložení. Scénář `DW-14` ověřuje také zavření citace,
  celou obrazovku, Escape a návrat focusu. Osobní fronta používá skutečnou
  chatovou cestu s mock Registry; chybové stavy používají deterministické
  odpovědi pro ověření prezentace. Scénáře používají mock data a
  nenahrazují produkční akceptaci ani Linux CI nad finálním SHA.
- Pět nových regresních testů potvrzuje čtení publikovaného interního zdroje
  s organizačním rozsahem a oddělení práva číst od editace, publikace a auditu.
  Chybějící scope, jiná organizace, explicitní příjemci a užší organizační
  jednotka zůstávají odmítnuté; koncept nesmí projít do dokumentového RAG.

Lokální browser používá izolované mock podklady. Jeho výsledky nepotvrzují
produkční grant, dostupnost doménových dat ani výkon produkčního modelu.
Mock Registry má životnost požadavku; reload historie a sdílení osobního
přehledu proto nejsou ověřeny plným prohlížečovým průchodem. Ochranu uloženého
obsahu ověřují integrační testy ukládací funkce. Reload a sdílené vlákno je
nutné samostatně ověřit proti trvalému Registry před produkční akceptací.

Závěrečná read-only kontrola produkce potvrdila původní release
`9e0e0a74af68b60cc07ac1200405b3dd71e4d951` v cestě `/srv/akl/current` i v
revizních štítcích dotčených kontejnerů. Kontejnery jsou zdravé;
`/akb/api/health` vrací `ok` a `/akb/api/ready` vrací `ready` bez degradovaných
závislostí. Produkční konfigurace ani data nebyly při opravách změněny.

## Kontrola oprávnění

Ověřený produkční účet má pouze `akb:access`, `akb:chat` a
`akb:read_document`. Jeho AKB scopes jsou `public`, `budget_scope:budget:it`
a `recipient_set:employee-directives`; efektivní projekce přidává 142 konkrétních
dokumentových rozsahů. Neobsahuje obecný organizační rozsah.

Read-only kontrola Registry zjistila 517 dokumentů: 494 platných a 23
rozpracovaných. Platných interních je 147 (142 v rozpočtovém a pět v
organizačním rozsahu); platných veřejných je 347, všechny v organizačním
rozsahu. Všechny tyto skupiny mají evidovanou policy vazbu a registraci.
Uživatelský registr zobrazuje 145 autorizovaných dokumentů.

Počet v seznamu tedy není počet všech uložených objektů. Klasifikace `public`
sama nepovoluje přístup na soukromý registr a zaměstnanecký scope nepovoluje
automaticky všechny interní manuály nebo smlouvy. Chybějící organizační rozsah
je prokazatelný; konečné zpřístupnění navíc vždy vyžaduje aktuální Information
Policy. Postup pro vlastníka oprávnění je v
[pokynu k internímu čtení](../integration/director-internal-read-handoff.md).

## Co ještě není uzavřeno

Opravy jsou připravené v samostatné pracovní větvi. Nebyly commitovány,
sloučeny ani nasazeny. Před produkcí zbývá standardní kontrola finálního SHA
v Gitea, schválení změny a immutable release. Tato oprava nemění účty, role,
grants, konfiguraci STRATOS ani produkční data.

1. Centrálně schválit a promítnout požadovaný širší rozsah čtení. AKB jej
   nesmí nahradit statickým claimem, vlastní výjimkou ani rolí administrátora.
2. Ověřit projektové portfolio s konkrétní aktuální projekcí a korelovaným
   rozhodnutím zdroje. Samotné otevření ProjectFlow neprokazuje datové právo;
   dosavadní test neprokazuje chybu STRATOS.
3. Prověřit chybějící historické úseky a neověřené vazby příloh. Oprava URL
   neobnovuje neexistující index ani automaticky neschvaluje zdroj.
4. Gestor musí přezkoumat obsah již schválených pravidel, zejména návrhy
   vzniklé z hlaviček tabulek nebo popisu změn. V této opravě se žádné pravidlo
   automaticky nepotvrdilo ani neodvolalo.
5. Navazující zlepšení: relevance obecných rad a kontrola dostupnosti předávací
   dokumentace. Osobní přehled zatím podporuje jen aktuální vlastní frontu a
   dokumenty; historické, týmové a nepodporované filtry nepředstírá.
6. Po standardním release zopakovat původní scénáře pod čtenářem; pod skutečně
   oprávněným gestorem/schvalovatelem ověřit upload → scan → vytěžení → kontrolu
   → schválení → publikaci → novou verzi → historickou citaci. Samostatně ověřit
   revokaci práv, přepnutí účtu, mobilní klávesnici, export, reload historie
   a sdílení vlákna s osobním přehledem. Jiný čtenář musí vidět jen neutrální
   záznam a při obnovení pouze svou aktuálně autorizovanou frontu.

Soukromá testovací vlákna ani odpovědi nejsou součástí zdrojového repozitáře.
Correlation ID nebyla v původním UI průchodu získána; nelze je zpětně vymýšlet.
