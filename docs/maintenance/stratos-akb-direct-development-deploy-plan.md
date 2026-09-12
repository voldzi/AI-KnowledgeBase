# STRATOS + AKB: přímé vývojové nasazení z MacBooku

Datum: 12. 9. 2026. Stav: schválený vývojový postup; první selektivní
STRATOS nasazení bylo provedeno a změřeno, úplný společný koordinátor pro všechny
služby AKB a STRATOS zůstává navazující implementací.

## Rozhodnutí vlastníka

`docker.home.cz` je do zahájení pilota společné vývojové a integrační prostředí.
Běžná změna se má po lokálním ověření uložit na GitHub a přímo nasadit přes SSH.
**Povinná vzdálená CI se z této cesty ruší v AKB i STRATOS.** GitHub Actions,
Gitea Actions, PR merge, doklad CI pro merge SHA ani VM125 nejsou její podmínkou.
Kompletní akceptace a bezpečnostní testy se provedou nad vybraným kandidátem před
pilotem. Pro běžné vydání zůstanou krátké kontroly přímo související se změnou.

Cíl: běžná změna jedné aplikace má být ověřitelná na serveru do **10 minut**,
pro rozsáhlejší vývojové vydání je diagnostická hranice **15 minut**. Jsou to
cíle k ověření měřením, nikoli již dosažené časy nebo příslib pro studený build.

## Co je skutečně ověřeno

- MacBook: 16 logických CPU, 48 GiB fyzické RAM. Docker Desktop má 16 CPU a
  přibližně 31,3 GiB dostupné RAM; běží na ARM64.
- `docker.home.cz` je x86_64. Výsledné serverové obrazy musí být Linux/amd64.
  Pouhé přenesení ARM64 obrazu z MacBooku není správné nasazení.
- AKB main: `404983367ebc688fd95a8df2194e9261f2741fda`.
- STRATOS main: `dfc34931aeadf533a3bf1359bd334e26bb50de0d`.
- Otevřený AKB adresář byl na starém `8f81a6a…`, jeho pokyny stále požadovaly
  plnou CI. Čistý adresář byl nyní posunut fast-forward na aktuální main;
  kontrola základu prošla. Main již vývojovou výjimku bez vzdálené CI obsahuje.
- STRATOS hlavní pracovní adresář obsahuje necommitnuté architektonické změny.
  Příprava tohoto plánu je nepřepisuje ani je nepovažuje za vydaný kandidát.
- CI STRATOS #1078 prošla za 8 min 17 s. Deploy #1081 pak za 13 min 29 s
  skončil chybou bootstrapu. Počet CPU ani další opakování testů tento konflikt
  skutečných metadat samo neřeší.
- `server-deploy.sh` staví obrazy na serveru v cyklu, zastavuje obě API a spouští
  oba migrátory a bootstrap. Tyto kroky dnes provádí i obecný release postup.
- Chyba #1081: `akb.official-public-reference@1 conflicts with the canonical
  human approval`. Přesné odlišné pole nebylo v tomto šetření doloženo porovnáním
  databázového záznamu. PR #126 upravuje porovnání historického jména, ale
  samotný test nad textem implementace nedokazuje odstranění tohoto incidentu.
- Incident byl 12. 9. odstraněn přímým vývojovým nasazením revize STRATOS
  `c444f3fa9633f8c55e8a7f5b0e795734909debea`. Bootstrap prošel nad skutečnými
  daty, `api`, `projectflow-api` i ProjectFlow proxy jsou zdravé a veřejná
  aplikace i AKB health/readiness vracejí HTTP 200. Původní formální release
  marker zůstal záměrně beze změny; vývojová aktivace má vlastní záznam.
- AKB `current` ukazuje na `9d09971…`. Pro nový plán musí být zdrojem skutečného
  stavu revize a image každé služby; samotný symlink nezaručuje shodu celého stacku.

## Proč se dosavadní nasazování opakovalo

1. Smísila se vývojová cesta s formálním pilotním releasem. I hotová malá změna
   znovu čekala na PR, CI, nový merge SHA, další evidence a nasazovací brány.
2. AKB má rychlý skript jen pro web. Vyžaduje dostupné Gitea main a neumí celou
   sadu backendů. STRATOS nemá odpovídající společnou vývojovou cestu.
3. CI s čistou databází nezachytila kolizi bootstrapu nad existujícími metadaty.
   Ověření předpokladů serveru přišlo až po odstavení API.
4. Formální postup po vedlejším účinku vyžaduje potomka neúspěšné revize;
   opakování release infrastruktury tak prodlužovalo i malou opravu.
5. Sestavovaly a přenášely se i nezměněné obrazy. AKB runbook popisuje dřívější
   přenos celého přibližně 1,1GB archivu, který zabral kolem 20 minut.
6. Sériové úlohy, síťový přenos a emulace nezrychlí tím, že kontejneru jen
   přidělíme další CPU. Navíc úplné mazání cache vynucuje nové stahování a build.

## Nová běžná cesta

**Lokální změna → commit a záloha na GitHub → lokální sestavení změněných
obrazů → přenos → SSH aktivace změněných služeb → krátké funkční ověření.**

1. Vybrat konkrétní změnu, uložit ji commitem na pracovní větev a ověřit shodný
   SHA na GitHubu. Nasazovat lze tuto větev bez čekání na merge do main.
   Záloha obsahuje zdroje a lockfiles, nikoli secrets, lokální dokumenty nebo DB.
   Cizí rozpracované změny se nepřidávají automaticky hromadným `git add`.
2. Na začátku během 30–60 s ověřit SSH, dostupnost balíčků a obrazů, volný prostor,
   současný deployment, očekávané proměnné a stav potřebných závislostí. Secrets
   zůstávají na serveru; kontrola vrací jen splnění podmínek a názvy problémů.
3. Porovnat kandidáta s manifestem skutečně nasazených služeb. Změny dokumentace
   nic nestaví. Změna jedné služby vybere jen ji a prokazatelné konzumenty.
   Sdílený kontrakt/knihovna rozšíří výběr podle evidovaných závislostí.
4. Spustit pouze relevantní krátké lokální ověření. Již úspěšný výsledek lze
   znovu použít jen při shodném kódu, lockfilech, konfiguraci buildu a nástroji.
   Chyba testu není úspěch; opravit ji lokálně před nasazením dotčené služby.
5. Sestavit jednou přesné Linux/amd64 obrazy na MacBooku. Náročné nezávislé úlohy
   spouštět souběžně, každý build se svým výstupem a sdílenou bezpečnou cache.
6. Přenést jen chybějící vrstvy změněných obrazů; manifest obsahuje SHA obou
   repozitářů, digest každého obrazu, platformu, konfiguraci a migrační revizi.
7. Na serveru nejprve připravit obrazy a předchozí manifest. Až potom aktivovat
   vybrané služby z digestů pomocí Compose bez buildu a bez restartu závislostí.
   Příkaz `up --no-build --no-deps` je součástí navrhovaného nového nástroje,
   nikoli pokyn obejít dnešní pending stav nebo existující startovací ochrany.
8. Ověřit health/readiness, veřejnou cestu a jeden autentizovaný scénář změněné
   funkce. Při chybě běžného vydání bez změny schématu vrátit předchozí image
   a konfiguraci. Veřejné a funkční kontroly musí stále patřit do rollback bloku.
9. Uložit výsledek, revize, časy a adresu k testování. SSH aktivace běží jako
   krátká durable úloha s vlastním zámkem, logem a stavovým dotazem, nikoli přes UI.

Při opakování téhož neúspěšného přenosu se využijí hotové obrazy. Ve vývojovém
režimu se nevyžaduje nový commit jen kvůli technickému výpadku transportu.
Nový deploy pokus dostane vlastní ID; obraz i zdrojový commit zůstávají neměnné.

## Zrušení CI ve vývojové cestě

- V AKB i STRATOS zrušit automatické spouštění plné CI při běžném push/PR pro
  vývojovou větev; formální workflow ponechat jako ručně spustitelnou pilotní sadu.
- Z běžného vývojového nasazení odstranit požadavek Gitea main, CI run ID,
  release attestation, SHA-burn a nové PR po každé transportní chybě.
- GitHub bude primárním místem pro zálohu vybrané vývojové revize. Gitea lze
  ponechat pro historii, ale její dostupnost nebude podmínkou tohoto nasazení.
  GitHub workflow nesmí po zálohovacím pushi potichu spustit druhou plnou CI.
- Hlavní větev lze ponechat chráněnou pro pilot; vývoj nasazuje vybranou větev
  `codex/*` nebo `development`. Není nutné globálně vypínat ochranu historie.
- Publikování `stratos-ui` pro společný vývoj oddělit od npm publish workflow:
  verzi zabalit lokálně a připnout v konzumentech s lockfilem a hashem. Oficiální
  publikaci lze spustit samostatně, nesmí blokovat lokální společné ověření.
- Nezastavovat všechny sdílené runnery nebo všechny Actions na organizaci.
  Vypnout pouze dotčené automatické workflow; ostatní aplikace nejsou součástí změny.
- Sjednotit `AGENTS.md`, `CLAUDE.md` a runbooky obou repozitářů. Jednoznačně
  odlišit `development` od explicitní `pilot` propagace. Dokumentace musí přestat
  současně požadovat i zakazovat CI pro stejný typ nasazení.

Tento plán mění nasazovací proces. Autentizace, TLP, oprávnění uživatelů a
kontrola přístupu k dokumentům nadále zůstávají funkčními vlastnostmi aplikací.

## Pokrytí všech aplikací a pracovníků

| Oblast změny | Služby zahrnuté podle skutečného dopadu |
| --- | --- |
| Budget, Executive Center a sdílené centrální moduly | STRATOS `web`, případně `api` |
| ProjectFlow | `projectflow-web`, `projectflow-api`; proxy jen při změně její konfigurace |
| ArchFlow | `archflow`, případně centrální `api` |
| Generování reportů STRATOS | `report-renderer`, příslušný konzument API |
| AKB web a samostatný Chat | `web`, `chat-web` podle odlišných build parametrů |
| Automatický příjem veřejných zdrojů | `official-source-sync-worker`; dnes používá tentýž image jako AKB web |
| Evidence dokumentů AKB | `registry-api` |
| Příjem a vytěžování | `ingestion-service`, `docling-worker`; dnes sdílejí image |
| RAG, modelové volání, governance, evaluace | konkrétní `rag-retrieval-service`, `llm-gateway-service`, `governance-service`, `evaluation-service` |
| Stav platformy a směrování AKB | `platform-status`, `reverse-proxy` pouze při přímém dopadu |
| Sdílené UI nebo veřejný kontrakt | sestavit poskytovatele a skutečně dotčené konzumenty v obou repozitářích |

Přesná mapa se generuje z aktuálních Compose souborů a závislostí. Při dílčím
vydání je běžné mít různý zdrojový SHA jednotlivých služeb; jeden globální tag
nesmí předstírat, že se aktualizovaly všechny. Závislostní pár AKB–STRATOS musí
mít kompatibilní kontrakt. Obvykle se připraví kompatibilní AKB backend, poté
jeho konzument STRATOS; selhání druhé části se zaznamená jako neúplné vydání.

Qdrant na `qdrant.home.cz`, ClamAV na `scan.home.cz`, SeaweedFS na
`storage.home.cz`, sdílená databáze a identitní služby se kvůli běžné aplikační
změně znovu nestaví, nestěhují ani nerestartují. Lokální Chroma je vyhledávací
nástroj pro vývoj; jeho reindex není podmínkou spuštění aplikace na serveru.

## MacBook a přenos obrazů

- Vyhradit pro build maximálně přibližně 12–14 CPU a 24–26 GiB RAM; zbytek
  ponechat lokálním službám. Začít se 3–4 nezávislými buildy a upravit souběh
  podle změřené RAM a doby. Nespouštět 16 náročných buildů po 16 workerech.
- Cache pro pnpm, Python a Docker držet trvale. Změna zdrojového souboru nesmí
  zbytečně invalidovat vrstvu instalace všech závislostí. Souběžné buildy nesmějí
  přepisovat stejné `dist` nebo `.next` adresáře.
- Nativní ARM64 build fázi použít tam, kde vzniká přenositelný výstup. Pro Prisma,
  sharp a další nativní moduly zajistit správné Linux/amd64 závislosti. Konečný
  serverový obraz ověřit i jako amd64; rychlý ARM test sám není tento důkaz.
- Preferovaná distribuce: privátní GHCR, lokální push z MacBooku a pull přesného
  digestu na serveru. Nejde o GitHub Actions; GitHub zde ukládá hotové obrazy.
  Ověřit dostupnost, oprávnění a cenu uložiště pro účet před prvním použitím.
- Změřit průchodnost z obou stran. Pokud GHCR nedokáže splnit rozpočet, použít
  přímý SSH přenos pouze vybraných obrazů jako první funkční variantu; celý
  mnohagigabajtový archiv sady nebude standard. Další registry infrastruktura
  se nemá stát podmínkou prvního rychlého nasazení.
- Uchovat poslední funkční image a rozumně omezenou build cache. Velký úklid
  cache patří do samostatné údržby, ne před každé vydání.

Docker popisuje zpomalení emulace a možnosti nativních build fází v
[multi-platform dokumentaci](https://docs.docker.com/build/building/multi-platform/).
Podporované varianty sdílení cache jsou v
[BuildKit cache backends](https://docs.docker.com/build/cache/backends/).
Přihlášení a práci s privátními obrazy GHCR popisuje
[GitHub Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Migrace, bootstrap a současný incident

**Běžné vydání UI/API bez změny schématu neprovádí bootstrap, seed, plný dump
databáze ani kompletní migrace.** Běžné provozní zálohování je samostatné.

Pokud kandidát obsahuje migraci nebo změnu governance:

1. Zjistit aktuální migrační ledger a ověřit přesné relevantní záznamy na serveru
   ještě před odstávkou. Vrátit pouze redigované rozdíly, nikdy tajemství.
2. Ověřit upgrade z relevantního předchozího stavu v oddělené lokální DB,
   včetně již existujícího schválení a druhého opakovaného spuštění. Čistý seed
   není test upgradu. Pro současný konflikt nejprve doložit konkrétní rozdílné pole.
3. Vytvořit příslušnou zálohu, aplikovat jen dosud neprovedené ledgerované změny
   a ověřit výsledek. Existující lidské schválení ani auditní původ nepřepisovat
   pouze proto, aby prošel bootstrap.
4. Preferovat aditivní migrace slučitelné se starou i novou aplikací. Pokud taková
   kompatibilita neplatí, neoznačit návrat samotného image za bezpečný rollback.
5. Při chybě před aktivací udržet starou službu, pokud to schéma dovoluje.
   Rollback databáze s novějšími zápisy není automatická součást běžného deploye.

Dnešní `pending/failed` marker formálního pokusu nebyl přepsán ani vydáván za
pilotní `applied/verified`. Oprava byla ověřena samostatným bootstrapem nad
skutečnými daty, obrazy byly sestaveny na MacBooku pro Linux/amd64 a aktivovány
jen pro obě dotčená API. Výsledek je uložen v
`/srv/STRATOS/deployments/dev-20260912-c444f3fa/result.txt`; předchozí obrazy
jsou označeny pro rollback.

## Konkrétní implementační kroky

| Krok | Úpravy | Důkaz dokončení |
| --- | --- | --- |
| 0. Stabilizace | Doložit konflikt katalogu a kompatibilitu migrací; opravit aktuální STRATOS incident | obě API a proxy zdravé, autentizovaný průchod, přesný manifest |
| 1. Jednotná pravidla | AKB/STRATOS `AGENTS.md`, `CLAUDE.md`, AKB release-process a STRATOS 09/10; odpojit automatické CI triggery ve vývoji | zálohovací push nespustí CI ani deploy; žádná vývojová brána nevyžaduje CI ID |
| 2. Společný nástroj | nový lokální koordinátor v AKB `scripts/dev-deploy/`, adaptér STRATOS `deploy/scripts/dev/`, verzovaný manifest pro oba repozitáře | jeden příkaz připraví plán dopadu, build, přenos, aktivaci a výsledek |
| 3. Selektivní build | zobecnit AKB web fast path na všechny služby a pracovníky; STRATOS oddělit build od serverového release | UI změna nestaví backendy ani infrastrukturu |
| 4. Přenos a aktivace | přesné digesty, důsledné `--no-build --no-deps`, zachované secrets, krátký hostový zámek, durable stav, rollback | přerušení lokálního spojení neztratí stav; předchozí verze dostupná |
| 5. Databáze | migrace jen při změně, upgrade ověření, explicitní compatibility pole | konflikt existujících metadat zjištěn před odstávkou |
| 6. Měření | tři postupné běžné aktualizace se zahřátou cache | každá změna pod 10 min; samostatně změřena celá sada |

Nový koordinátor a adresáře výše jsou návrh, nikoli existující spustitelné příkazy.
U stávajícího AKB fast web skriptu je nutné odstranit závislost na Gitea main,
zahrnout sdílené worker images a rozšířit rollback i na veřejný/funkční smoke;
dnes se rollback trap ruší ještě před veřejnými kontrolami.

## Časový odhad

Čas měřit od výběru hotové lokální změny po úspěšný autentizovaný smoke na serveru,
včetně commitu, GitHub zálohy, potřebné lokální kontroly, buildu a přenosu.

| Typ vydání | Cíl při zahřáté cache | Podmínka |
| --- | --- | --- |
| Běžná úprava jednoho webu | 3–6 minut | beze změny závislostí a schématu |
| Jedno API nebo pracovník | 4–8 minut | malý obrazový rozdíl, relevantní testy |
| Sdílené UI ve více aplikacích | 6–10 minut | souběžné nezávislé buildy |
| AKB a celá sada STRATOS | 8–15 minut | již dostupné závislosti a základní vrstvy |
| Změna s migrací | 10–20 minut nebo individuálně | závisí na velikosti DB a typu migrace; odhad předem |
| První build / výměna těžkých závislostí | 20–40+ minut | výjimka bez cache, ne běžné vydání |

Orientační rozpočet běžné změny: 0,5–1 min GitHub a preflight,
1–2 min lokální ověření, 2–4 min build, 0,5–1,5 min přenos a
1–1,5 min aktivace s ověřením. Nezávislé činnosti se mohou překrývat.
Hotové a již ověřené obrazy mají cíl **1–3 minuty** do dostupnosti na serveru.

Jednorázové sjednocení pravidel, sestavení prvního použitelného společného nástroje
a ověření web+API odhaduji na **3–5 hodin soustředěné práce**; pokrytí celé mapy
služeb, migrací a časové zkoušky může přidat **2–4 hodiny**. Aktuální incident
má vlastní neuzavřenou příčinu, jeho opravu nelze vydávat za součást zaručeného
desetiminutového nasazení. Jde o implementační odhad, ne čekání na CI.

Po 10 minutách běžného nasazení musí nástroj ukázat přesně pomalý krok a zbývající
práci. Při dosažení 15 minut zastaví novou práci v bezpečném bodě a uloží
diagnostiku. Již zahájenou DB migraci nesmí násilně přerušit jen kvůli časovači.
Následuje oprava konkrétního problému a využití hotových výsledků, ne nový celý cyklus.

## Převzetí a stav tohoto plánu

Dokončení nové cesty znamená změřené nasazení změny Budget/Executive Center,
ProjectFlow, ArchFlow, AKB a Chatu, ověření selekce všech workerů a backendů,
následně zkoušku chyby před aktivací a rollbacku změny bez migrace. Ověřit také
SSO, přesnou dokumentovou verzi a zachování TLP při související integrační změně.
Zápis na GitHub bez funkčního serverového scénáře není hotové nasazení.

První nasazení podle tohoto postupu nečekalo na CI #1082 ani nespustilo nový
Gitea release. Zahrnulo cílený test, GitHub zálohu pracovní větve, dva přesné
Linux/amd64 obrazy, přímý přenos, selektivní aktivaci bez restartu závislostí,
health/readiness a ověření existující přihlášené relace v produkčním UI. Tento
vývojový postup nenahrazuje závěrečnou pilotní akceptaci.
