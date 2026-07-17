# Samostatný AKB Chat A PWA

## Účel Dokumentu

Tento dokument popisuje práci potřebnou pro publikaci znalostního chatu AKB na
samostatné doméně:

```text
https://chat.zeleznalady.cz
```

Cílem je nabídnout běžnému uživateli jednoduchou chatovou aplikaci, kterou lze
instalovat jako PWA na mobilní zařízení nebo pracovní stanici. Chat musí nadále
používat stejná data, oprávnění, historii, vyhledávání, citace a audit jako
hlavní AKB na `https://stratos.zeleznalady.cz/akb`.

Dokument je realizační zadání. Jeho vytvoření samo o sobě nemění aplikaci,
Keycloak, DNS, reverse proxy ani produkční prostředí.

## Rozhodnutí

Samostatný chat je technicky realizovatelný a odpovídá stávající architektuře
AKB. Nemá vzniknout druhá znalostní báze ani kopie chatové logiky.

Cílový model je:

- jeden centrální AKB backend;
- jedna sada dokumentů, indexů a konverzací;
- hlavní administrační AKB na `stratos.zeleznalady.cz/akb`;
- samostatný chatový frontend na `chat.zeleznalady.cz`;
- společný STRATOS realm a centrální access projection;
- vlastní OIDC klient a vlastní host-only relace pro chatovou doménu;
- online-first PWA bez offline ukládání chráněného obsahu.

## Současný Stav

AKB již obsahuje potřebný funkční základ:

- samostatnou uživatelskou route `/chat`;
- kompatibilní přesměrování `/assistant` na `/chat`;
- chatové rozhraní bez administračního postranního menu pro uživatele pouze s
  chatovým oprávněním;
- capability kontrolu `akb:chat`;
- dynamickou access projection načítanou ze STRATOS;
- serverový BFF, přes který prohlížeč volá Registry a RAG;
- odpovědi s citacemi a řízeným otevřením zdroje;
- serverově uloženou historii konverzací;
- soukromé konverzace s výchozí retenční dobou 180 dnů;
- audit událostí asistenta bez ukládání plného textu promptů a odpovědí;
- rozlišení odpovědi, doplňující otázky, nedostatku zdrojů, omezeného přístupu
  a doporučeného předání člověku.

Současné produkční webové AKB je ale sestavené pro:

```text
AKL_WEB_PUBLIC_BASE_URL=https://stratos.zeleznalady.cz/akb
AKL_WEB_BASE_PATH=/akb
```

OIDC callback, statické soubory, interní webové API a podepsané odkazy se
odvozují od této veřejné adresy. Pouhý DNS alias na existující web proto není
dostatečné řešení pro čistou doménu `chat.zeleznalady.cz`.

## Cílová Architektura

```text
uživatel / instalovaná PWA
            |
            v
https://chat.zeleznalady.cz
            |
            v
AKB chat-only web + BFF
            |
            +-- STRATOS access projection
            +-- AKB Registry API
            +-- AKB RAG Retrieval Service
            +-- OpenSearch a Qdrant
            +-- LLM Gateway
            +-- zdrojové soubory a citace
            +-- audit a observabilita
```

Chatový frontend bude nasazen jako druhá webová instance ze stejného
repozitáře. Backendové služby, databáze, indexy a objektové úložiště zůstanou
společné.

Samostatná instance musí používat kořenovou veřejnou cestu. Předpokládaný
konfigurační profil je:

```text
AKL_WEB_PUBLIC_BASE_URL=https://chat.zeleznalady.cz
AKL_WEB_BASE_PATH=
NEXT_PUBLIC_AKL_BASE_PATH=
AKL_WEB_OIDC_CLIENT_ID=akb-chat-web
```

Hodnoty jsou cílový kontrakt, nikoliv pokyn k okamžité změně produkčního env.
Chatová instance musí mít vlastní silný `AKL_WEB_SESSION_SECRET`. Interní adresy
Registry, RAG, Governance a STRATOS access projection zůstávají stejné jako u
hlavní AKB instance.

## Chat-Only Režim

Ze stejného zdrojového kódu musí vzniknout omezená uživatelská plocha. Lokální
kopie komponent ani samostatný fork frontendové aplikace nejsou přípustné.

Chat-only režim musí:

- směrovat `/` přímo do chatu;
- zobrazovat pouze identitu AKB, chat, nastavení uživatele a odhlášení;
- nepoužívat administrační rail, workspace menu ani Intelligence submenu;
- zachovat seznam konverzací, editor dotazu, odpovědi, citace a zdrojový
  kontext;
- zachovat přístupnost, klávesnicové ovládání a responzivní rozložení;
- zakázat nebo nezpřístupnit dokumentové, workflow, auditní a administrační
  stránky;
- vracet bezpečný stav `403` nebo řízené přesměrování při pokusu o nepovolenou
  route;
- používat stejné doménové komponenty a stejné API kontrakty jako `/akb/chat`.

Omezení nesmí být pouze vizuální. Musí být vynucené aplikačním route guardem a
backendovou autorizací. Edge allowlist je vhodná další ochranná vrstva, nikoliv
náhrada autorizace.

Chatová instance potřebuje pouze následující skupiny veřejných cest:

- chatová stránka;
- OIDC login, callback, session a logout;
- nezbytné assistant BFF endpointy;
- seznam a detail vlastních konverzací;
- citace, bezpečný source-context a řízené otevření zdroje;
- profilové nastavení;
- health a readiness;
- PWA manifest, ikony a statické soubory.

## Autentizace A Autorizace

Pro `chat.zeleznalady.cz` se zaregistruje samostatný OIDC klient, doporučeně
`akb-chat-web`, ve stejném Keycloak realm `stratos`.

Minimální OIDC kontrakt:

```text
redirect URI: https://chat.zeleznalady.cz/api/auth/callback
post logout URI: https://chat.zeleznalady.cz
web origin: https://chat.zeleznalady.cz
```

Konkrétní typ klienta, audience mappery a service scopes musí odpovídat
schválenému STRATOS OIDC profilu.

Povinné bezpečnostní principy:

- prohlížeč dostává pouze zapečetěné HTTP-only cookies;
- cookies jsou `Secure`, mají odpovídající `SameSite` a cestu `/`;
- cookies zůstávají host-only, atribut `Domain=.zeleznalady.cz` se nepoužije;
- chatová a hlavní AKB relace se nesdílejí prostřednictvím cookies;
- jednotné SSO zajišťuje Keycloak, nikoliv sdílený browser token;
- callback spotřebuje autorizační kód serverově;
- browser nevolá Registry, RAG, LLM Gateway ani objektové úložiště přímo;
- produkční capability a scopes se načítají z ověřené STRATOS access
  projection;
- dynamická oprávnění se neodvozují ze statického `stratos_access` claimu ani
  z neověřených hlaviček;
- vstup do chatu vyžaduje aktivní identitu, členství, přístup k aplikaci a
  capability `akb:chat`;
- každé vyhledání, citace a otevření zdroje znovu respektuje policy binding,
  klasifikaci, scope a stav konkrétní verze dokumentu;
- zamítnuté nebo nedostatečné zdroje vedou k `restricted`, `no_answer` nebo
  handoff stavu, nikoliv k odhadu odpovědi.

## PWA Rozsah

PWA vrstva má zpřístupnit chat jako instalovatelnou aplikaci. Nemá přesouvat
znalostní infrastrukturu ani chráněný obsah do zařízení.

### Manifest

Manifest musí definovat alespoň:

- název a zkrácený název AKB Chat;
- `start_url` na kořen chatové aplikace;
- `scope` omezený na `chat.zeleznalady.cz`;
- `display: standalone`;
- produktovou barvu pozadí a tématu;
- maskable a standardní ikony v požadovaných velikostech;
- stabilní identifikátor aplikace;
- český výchozí jazyk.

Ikony mají vycházet z jednotné vizuální identity STRATOS a AKB.

### Service Worker

Service worker bude online-first a musí mít explicitní cache pravidla:

| Obsah | Strategie |
| --- | --- |
| verzované statické JS/CSS/fonty | cache-first s verzovanou cache |
| manifest a ikony | řízená krátkodobá cache |
| navigace a shell | network-first s bezpečnou offline stránkou |
| OIDC a session endpointy | pouze síť, `no-store` |
| dotazy, odpovědi a historie | pouze síť, `no-store` |
| citace a source-context | pouze síť, `no-store` |
| PDF, Office soubory a zdrojové binární soubory | pouze síť, `no-store` |
| exporty a podepsané URL | pouze síť, `no-store` |

Aktivace nové verze nesmí ponechat uživateli nekompatibilní shell. PWA musí
umět oznámit dostupnou aktualizaci a po potvrzení načíst novou verzi.

### Lokální Data

Bez dalšího bezpečnostního rozhodnutí lze v zařízení ukládat pouze:

- jazyk;
- čistě prezentační nastavení;
- informaci o zobrazení instalační nabídky;
- technický identifikátor verze shellu.

Do `localStorage`, Cache Storage ani IndexedDB se nesmí ukládat:

- prompty;
- odpovědi;
- konverzace;
- citované úryvky;
- dokumentová metadata;
- PDF nebo jiné zdrojové soubory;
- access a refresh tokeny;
- policy bindingy nebo podepsané odkazy.

Dotazy se bez spojení neřadí do offline fronty. Samotný dotaz může obsahovat
citlivé organizační údaje.

## Význam Dostupnosti Dat

Instalovaná PWA zajistí snadný vstup do aplikace, nikoliv automaticky úplný
offline přístup.

Požadavek „data vždy přístupná“ se v první etapě interpretuje takto:

- po přihlášení má uživatel ze všech podporovaných zařízení přístup ke svým
  serverově uloženým konverzacím;
- historie se řídí AKB retenční politikou, výchozí doba je 180 dnů;
- dostupnost dokumentů se vždy vyhodnotí podle aktuální identity a policy;
- odvolané oprávnění se projeví okamžitě i u starší konverzace;
- bez síťového spojení je dostupný pouze bezpečný offline stav, nikoliv obsah;
- při nedostupnosti Registry může chat výslovně přejít do dočasného
  neperzistentního režimu, pokud to dovoluje stávající kontrakt, a musí o tom
  uživatele informovat.

Plný offline režim pro interní nebo omezená data vyžaduje samostatné schválení,
MDM, evidenci zařízení, šifrování, vzdálenou revokaci, časově omezené klíče a
pravidla podle klasifikace. Není součástí této práce.

## Audit, Logování A Soukromí

Samostatná doména musí zachovat stávající auditní model AKB.

Audit může ukládat:

- identitu aktéra;
- typ události;
- identifikátor konverzace;
- identifikátory zdrojů a citací;
- počty, hashe, confidence a warning kódy;
- request a correlation id;
- použitý model a verzi kontraktu podle stávajícího API.

Logy ani audit nesmí standardně ukládat plný text dotazu, odpovědi, dokumentu,
tokenu nebo přihlašovacího údaje.

Provozní metriky musí rozlišit minimálně:

- hlavní AKB web;
- chatovou PWA;
- úspěšné a neúspěšné OIDC callbacky;
- dostupnost Registry a RAG;
- `answer`, `no_answer`, `restricted` a handoff výsledky;
- otevření citace;
- chyby service workeru a nekompatibilní verze shellu.

## Veřejné Publikování

STRATOS/provozní vlastník zajistí:

- DNS záznam `chat.zeleznalady.cz`;
- TLS certifikát a jeho obnovu;
- samostatný server blok na DMZ reverse proxy;
- přidělený interní upstream pro chatovou webovou instanci;
- forwarded headers bez podvržených externích hodnot;
- limity velikosti požadavku, timeouty a rate limiting;
- registraci OIDC klienta a redirect URI;
- monitoring veřejného health/readiness vstupu.

AKB vlastník zajistí:

- chat-only profil aplikace;
- root build bez `/akb` base path;
- manifest, ikony, service worker a offline stav;
- serverové route guardy;
- BFF a bezpečnostní hlavičky;
- stejné capability, policy a auditní kontroly jako v hlavním AKB;
- automatické a manuální testy;
- release a rollback postup.

DNS alias bez samostatného aplikačního profilu se nepovažuje za dokončené
řešení.

## Etapy Realizace

### 1. Kontrakt A Rozhodnutí

- potvrdit veřejnou doménu;
- potvrdit, zda je doména dostupná z internetu, intranetu nebo pouze přes VPN;
- přidělit vlastníka DNS, TLS, Keycloak klienta a DMZ konfigurace;
- potvrdit capability `akb:chat` a povolené informační klasifikace;
- potvrdit výchozí retenci konverzací;
- potvrdit, že první verze neukládá obsah offline;
- zapsat veřejnou route a OIDC kontrakt do provozní dokumentace.

### 2. Chat-Only Webový Profil

- zavést řízený režim jedné aplikace pro hlavní AKB a chat-only plochu;
- nastavit kořenovou route na chat;
- odstranit z chatového profilu administrační navigaci;
- omezit stránky a BFF endpointy;
- zachovat společné komponenty, typy a API klienty;
- doplnit samostatný root build a health/readiness;
- otestovat, že hlavní `/akb` profil zůstává beze změny.

### 3. PWA

- vytvořit manifest a produktové ikony;
- implementovat bezpečný service worker;
- vytvořit offline obrazovku bez chráněných dat;
- doplnit řízenou aktualizaci aplikace;
- ověřit instalaci, spuštění a odinstalování;
- ověřit, že odstranění lokálních dat nepoškodí serverovou historii.

### 4. OIDC A Edge

- vytvořit samostatný Keycloak klient;
- nakonfigurovat přesný callback a logout URI;
- nasadit chatovou webovou instanci;
- publikovat doménu přes DMZ reverse proxy;
- ověřit host-only cookies a jednotné SSO;
- ověřit CSP, HSTS, frame policy, MIME ochranu a referrer policy;
- potvrdit, že interní AKB služby nejsou zveřejněné do internetu.

### 5. Integrační A Bezpečnostní Testy

- provést celý login, refresh a logout tok;
- načíst access projection a ověřit `akb:chat`;
- položit dotaz a získat citovanou odpověď;
- otevřít citaci a původní zdroj;
- obnovit konverzaci na druhém zařízení;
- ověřit retenci, archivaci a sdílení;
- odebrat capability nebo scope a ověřit okamžité zamítnutí;
- ověřit `restricted` a `no_answer` scénáře;
- ověřit nedostupnost Registry, RAG a modelu;
- ověřit, že cache neobsahuje chráněná data;
- ověřit aktualizaci service workeru mezi dvěma releasy.

### 6. Pilot A Produkce

- nasadit omezený pilot;
- sledovat přihlášení, dostupnost, no-answer poměr a citace;
- potvrdit podporované prohlížeče a zařízení;
- provést bezpečnostní kontrolu uložených browser dat;
- schválit produkční release;
- zachovat předchozí webový release pro okamžitý rollback.

## Akceptační Kritéria

### Funkce

- `https://chat.zeleznalady.cz` otevře chat bez administračního workspace;
- uživatel se přihlásí přes STRATOS Keycloak;
- historie patří ověřené identitě a je dostupná na dalším zařízení;
- odpověď používá stejné RAG, Registry a citace jako hlavní AKB;
- otevření citace respektuje aktuální policy;
- odhlášení odstraní lokální relaci a ukončí nebo správně naváže SSO tok;
- hlavní `https://stratos.zeleznalady.cz/akb` zůstane funkčně beze změny.

### PWA

- instalace funguje na podporovaném desktopovém Chromium;
- instalace nebo přidání na plochu funguje na Androidu a iOS podle možností
  platformy;
- aplikace se spouští ve standalone režimu;
- manifest, ikony, start URL a scope jsou správné;
- offline stav neukazuje dříve načtený chráněný obsah;
- nová verze shellu se aktivuje řízeně a bez nekonečného reloadu.

### Bezpečnost

- dynamické oprávnění pochází pouze z ověřené STRATOS access projection;
- uživatel bez `akb:chat` obdrží zamítnutí;
- nelze otevřít dokument mimo aktivní scope nebo policy;
- interní API nejsou dostupná přímo z browseru;
- cookies nejsou čitelné JavaScriptem ani sdílené mezi subdoménami;
- browser cache, IndexedDB a localStorage neobsahují dotazy, odpovědi ani
  dokumenty;
- prompt, odpověď, token a dokumentové tělo se neobjeví v aplikačních logách;
- negativní scénáře mají correlation id a bezpečné chybové sdělení.

### Responzivita A Přístupnost

- ověřené viewporty minimálně 390, 768, 1024 a 1440 px;
- bez horizontálního overflow;
- editor dotazu zůstává dostupný při zobrazení softwarové klávesnice;
- seznam konverzací a citace lze ovládat klávesnicí;
- focus se po zavření panelu nebo dialogu vrací na spouštěcí prvek;
- stavy loading, offline, chyba, restricted a no-answer jsou srozumitelné i bez
  barvy.

### Provoz

- veřejné `/health` a `/ready` rozlišují procesní a závislostní stav;
- monitoring rozliší chatovou instanci od hlavního AKB webu;
- release je identifikovatelný commitem a verzí;
- rollback nevyžaduje změnu Registry, RAG ani dokumentových dat;
- výpadek PWA frontendové instance nepoškodí hlavní AKB.

## Povinné Testovací Scénáře

1. Uživatel s `akb:chat` se přihlásí, položí dotaz, obdrží odpověď s citací a
   otevře zdroj.
2. Stejný uživatel otevře PWA na druhém zařízení a načte stejnou historii.
3. Jiný uživatel nevidí soukromou konverzaci prvního uživatele.
4. Sdílená konverzace je dostupná pouze povolenému uživateli nebo skupině.
5. Odebrání scope nebo capability okamžitě zablokuje další retrieval i otevření
   staré citace.
6. Dokument změněný na neplatnou nebo nahrazenou verzi nelze otevřít přes
   historickou citaci.
7. Bez relevantních zdrojů chat vrátí `no_answer`.
8. Při zakázané klasifikaci chat vrátí `restricted` bez úniku metadat.
9. Při výpadku modelu se zobrazí bezpečný a srozumitelný stav.
10. Při výpadku historie se případný dočasný režim výslovně označí jako
    neperzistentní.
11. Po přechodu offline nelze z cache přečíst předchozí odpověď, citaci ani
    dokument.
12. Aktualizace PWA nezanechá starý shell nad novým API kontraktem.
13. Pokus o otevření administrační route na chatové doméně je zamítnut.
14. Hlavní AKB web projde regresními chatovými a administračními testy.

## Rozdělení Odpovědností

| Oblast | AKB vlastník | STRATOS/provozní vlastník |
| --- | --- | --- |
| chat UI a chat-only režim | odpovídá | konzultuje jednotný shell |
| Registry, RAG, citace a historie | odpovídá | poskytuje access projection |
| capability a policy enforcement | odpovídá v AKB | vlastní centrální bindingy |
| PWA manifest a service worker | odpovídá | schvaluje branding a politiku |
| DNS a TLS | poskytuje požadavky | odpovídá |
| DMZ reverse proxy | poskytuje upstream kontrakt | odpovídá |
| Keycloak klient | poskytuje callback kontrakt | odpovídá |
| monitoring aplikace | poskytuje metriky a health | integruje centrální dohled |
| release a rollback AKB webu | odpovídá | koordinuje produkční okno |
| zařízení, MDM a offline politika | konzultuje | vlastní organizační rozhodnutí |

## Rizika A Opatření

| Riziko | Opatření |
| --- | --- |
| rozdílné chování hlavního a chatového webu | jeden repozitář, společné komponenty a společné kontraktní testy |
| únik dat přes service worker cache | explicitní allowlist cache a network-only pro veškerý obsah |
| neplatný OIDC callback nebo redirect loop | samostatný klient, přesné URI a E2E test callbacku |
| falešné sdílení relace mezi subdoménami | host-only cookies a samostatný session secret |
| zastaralá PWA po release | verzovaná cache, update signal a kompatibilní rollout |
| obcházení navigace přímou URL | serverové route guardy a backendová capability kontrola |
| výpadek chatové domény ovlivní celé AKB | samostatná webová instance nad společnými backendy |
| uživatel očekává plný offline přístup | jasný online/offline stav a dokumentované bezpečnostní omezení |

## Mimo Rozsah

Tato práce nezahrnuje:

- druhou databázi nebo kopii dokumentů;
- samostatný RAG, OpenSearch, Qdrant nebo LLM stack;
- přímé volání interních služeb z browseru;
- anonymní veřejný chat;
- offline ukládání interních, restricted nebo confidential dat;
- offline frontu dotazů;
- push notifikace;
- nativní mobilní aplikaci;
- změnu zdrojových pravomocí ostatních aplikací STRATOS.

## Výstupy

Realizace bude uzavřena až po dodání:

- schváleného route a OIDC kontraktu;
- chat-only webového profilu;
- PWA manifestu, ikon, service workeru a offline stavu;
- compose/deployment profilu bez produkčních tajemství v repozitáři;
- DMZ a Keycloak předávacího pokynu;
- automatických testů autorizace, cache a regresí;
- manuálního mobilního, desktopového a PWA QA protokolu;
- aktualizované architektury, bezpečnosti, provozu a runbooku;
- rollback postupu;
- pilotního a produkčního ověření.

## Definition Of Done

Práce je dokončená, když uživatel může nainstalovat AKB Chat z
`chat.zeleznalady.cz`, přihlásit se přes STRATOS, pracovat se svou serverovou
historií a otevírat pouze autorizované citace, zatímco v zařízení nezůstává
chráněný obsah použitelný offline. Hlavní AKB web musí současně projít
regresními testy bez změny svého dokumentového a administračního chování.

## Stav Implementace

Implementace v repozitáři obsahuje:

- profil `AKL_WEB_PROFILE=chat` a serverovou allowlist rout;
- samostatný root build a Compose službu `chat-web` na portu `3221`;
- samostatný immutable image `akl/chat-web:<commit>`;
- OIDC klient `akb-chat-web` s PKCE a přesnými callback/origin URI;
- manifest, 192/512/maskable ikony, bezpečnou offline stránku a verzovaný
  service worker;
- řízenou aktivaci aktualizace bez offline fronty;
- automatické testy konfigurace, rout a cache politiky;
- release ověření health/readiness, manifestu a blokovaného management API.

Produkční stav a datum ověření se doplní po vytvoření DNS/TLS/DMZ route,
reconciliaci Keycloak klienta a immutable nasazení.
