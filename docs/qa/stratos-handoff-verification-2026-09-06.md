# Ověření předání STRATOS ve společném Docker prostředí

Tento report zachycuje checkpoint před opravami 0.5.1. Aktuální výsledek je
[společná akceptace 0.5.1](stratos-ui-051-acceptance-2026-09-06.md).

Stav 2026-09-06: **předání převzato a sestaveno, společná akceptace NEPROŠLA**.
Vlastníkem souhrnného ověření zůstává AKB/Codex. Produkce nebyla změněna.

## Přesná sestava a provedené změny

Předání: STRATOS `docs/reports/2026-09-05-akb-suite/HANDOFF.md`.
Ověřený implementační commit je `d035bdb6c71ca506c847908e35a8aa20a43df6e0`.
Následující checkout `9caf7b5` přidává pouze dokumentaci předání. Pro sestavení
byl použit neměnný export tohoto implementačního commitu v
`/private/tmp/akb-stratos-candidate-d035bdb6`; zdroje STRATOS nebyly upraveny.

Ověření `scripts/verify-akb-suite-contracts.mjs` ze STRATOS proti pracovnímu
AKB prošlo. Souhlasí katalog, admission/readiness kontrakty a OpenAPI;
ověřovač zároveň potvrzuje chybějící source upload operace PF/ArchFlow.
Reportované interní STRATOS regrese nebyly vydávány za nově provedené testy AKB.

Ve stávajícím projektu `akb-stratos-test` bylo úspěšně sestaveno a spuštěno
pět dotčených STRATOS služeb: API, ProjectFlow API a všechny tři weby.
Následně byly sestaveny a spuštěny AKB `web` a `chat-web` po těchto opravách:

- Docker builder AKB přijímá lokální veřejné adresy Budget/PF/ArchFlow.
  Dříve je klientské sestavení neobdrželo a nabízelo produkční odkazy.
- Generátor předává nové veřejné adresy také STRATOS buildům včetně Chatu.
- `chat-web` má explicitně `AKL_WEB_PROFILE=chat`. Předchozí test na portu
  3221 ve skutečnosti ověřoval druhý platformní profil; nedokládal samostatné
  UI Chatu. Nynější test ověřuje skutečný samostatný Chat.

Finální kontrola: 21 kontejnerů běží, žádný není unhealthy. Zůstaly zachovány
databáze, volumes, klíče a identity. AKB je rozpracovaný checkout na větvi
`codex/document-intake-hardening`, základ `398aec0593c34bbe8dc1d65423c280d483198ded`.
Sestava tedy dosud není neměnný společný release kandidát. Aktualizace origin
selhala na SSH publickey; kontrola baseline prošla jen proti uloženému origin/main.

## Skutečný uživatelský průchod

Vznikli dva syntetičtí zaměstnanci ve skutečném lokálním Keycloaku.
`suite-sso-reader` obdržel přes auditované Access Center API časově omezené
profily portfolio-reader, finance-viewer, ProjectFlow reader, ArchFlow submitter
a AKB knowledge-reader. `suite-sso-restricted` nemá ProjectFlow grant.
Nejde o globálního správce, náhradní autentizaci ani kompletní dokumentové
fixtures autora/vlastníka/gestora. Přístupy mají platnost 24 hodin od přidělení.

| Scénář | Výsledek a hranice důkazu |
| --- | --- |
| Jedno zadání hesla, skutečné klikání Budget → PF → ArchFlow → AKB | PASS pro cestu tam; PF bootstrap 200, ArchFlow overview 200 a AKB session 200, bez dalšího login kliknutí |
| Návrat AKB → Budget přes přepínač | FAIL; UI hlásí „Jste odhlášeni“ a nabízí přihlášení, zatímco `/api/v1/auth/me` vrací 200 |
| STRATOS → samostatný Chat | PASS; skutečný profil Chat, session 200 a jedno zadání hesla |
| Nové karty všech pěti aplikací po návštěvě Chatu | FAIL; AKB skončí na `/akb/api/auth/login` s přihlašovací branou |
| Omezený zaměstnanec v PF | PASS; bootstrap 403 |
| Odebrání PF grantu aktivnímu zaměstnanci | PASS pouze server: bootstrap 403; následně byl stejný grant obnoven auditovaným API |
| Vyčištění otevřeného UI po odebrání grantu | NEOVĚŘENO v celém intervalu; krátký test 2,47 s neprokázal skrytí pracovního UI |
| Globální odhlášení a lhůty všech BFF | NEOVĚŘENO; společný test skončil timeoutem před spolehlivým měřením odhlášení |
| AKB → Chat a Chat → ostatní aplikace přes přepínač | BLOCKED; AKB 0.3.37 nemá Chat položku, samostatný Chat nemá přepínač aplikací |

Pro krátký test byla identity freshness dočasně snížena na 6 sekund. **Původní
nastavení bylo obnoveno a ověřeno v běžících kontejnerech**: AKB/Chat 15 minut,
oba STRATOS API bez override se standardním limitem. Návrat do Budgetu i nové
karty selhaly také po tomto obnovení; nejsou pouze důsledkem zrychleného testu.

### SSO-01: návrat do Budgetu

Opakovat v čistém profilu se zaměstnancem s pěti uvedenými profily:
jedno přihlášení → přepínačem PF → ArchFlow → AKB → Budget. Nepoužívat odhlášení.
Budget ukáže přihlašovací bránu i při ověřené serverové relaci 200.
Při odchodu byl zachycen zrušený probe `/api/v1/auth/me` (`net::ERR_ABORTED`).
Ve sdílené knihovně `monitorStratosSession` spouští ověření i `visibilitychange`
při skrytí stránky; konzument při každé chybě volá `markSignedOut`.
To je konkrétní podezření na příčinu, nikoli dokončený důkaz přesné kauzality.
**Vlastník opravy STRATOS.** Rozlišit odchod/zrušený požadavek, nedostupné
ověření a skutečně odvolanou relaci. Zachovat serverové kontroly přístupu.

### SSO-02: souběh AKB a Chatu

Na hostu localhost jsou dvě cookies `akl_session` a dvě `akl_sso_sync`, vždy
s cestami `/akb` a `/`. Cesta `/akb` přijímá obě stejně pojmenované cookies;
rozdílný port je neodděluje. Po návštěvě Chatu byla reprodukována brána AKB,
v další diagnostice i session 401 pro obě aplikace a navigační timeout.
Serverový kód při nesouladu client ID revokuje zvolený selector. Kolize jmen
je potvrzená; její přesný podíl na všech pozorovaných chybách vyžaduje cílený
regresní test. Diagnostický pokus o izolaci odstraněním cookies nedoběhl
k tomuto kroku a není důkazem opravy.
**Vlastník AKB.** Oddělit relace/protokolové cookies obou profilů nebo zavést
ověřenou topologii oddělených hostů; doplnit testy souběhu, návratu, nových
karet a odhlášení. Neoslabovat kontrolu issuer/client/subject.

### SSO-03: společná knihovna a samostatný Chat

STRATOS předal workspace `@voldzi/stratos-ui` 0.5.0 a výslovně ji v tomto
kroku nepublikoval. AKB používá 0.3.37. STRATOS musí dodat spotřebovatelnou
kompatibilní verzi podle společného package standardu; AKB poté sjednotí oba
topbary včetně Chatu. Žádné publikování balíčku ani lokální fork neproběhlo.

## Příjem dokumentů a živé zdroje

| Oblast | Ověřený stav / navazující vlastník |
| --- | --- |
| Budget | Centrální replay/atomická registrace v předaném zdroji; AKB stále omezuje binary audience na budget_scope. AKB musí dokončit organization/recipient_set při zachování aktuálního PDP a vazeb zdroje. |
| PF a ArchFlow nový upload | Chybí source preflight/confirm v AKB OpenAPI. Nejdříve AKB kontrakt a implementace, potom STRATOS adaptéry. Reference na existující dokument nejsou upload. |
| Nativní dokumenty / veřejné kolekce | Centrální implementace nyní ve STRATOS existuje; starší tvrzení o úplné absenci je překonané. Zbývá skutečný společný příjem, replay, revokace a indexace. |
| Executive Center / federovaná historie | Samostatný provider a důvěryhodný zápis/snapshot historie nejsou uzavřené; potřeba společného kontraktu a ověření. |
| Všechny zdroje → Chat a citace | Žádný celý nový upload → scanner → confirm → index → odpověď → citace nebyl touto kontrolou prokázán. |

Finální živý smoke prošel: zdravotní a provozní endpointy 200; admission
STRATOS 503 `DOCUMENT_ADMISSION_CATALOG_NOT_READY`, AKB 503
`document_profile_admission_unavailable`; neplatný vstup 400, anonymní 401.
ClamAV povolil čistý vzorek a detekoval EICAR. Tento PASS znamená správné
uzavření nepřipraveného příjmu, nikoli připravenost konektorů.

Povinné explicitní TLP, autor/vydavatel, vlastník, gestor, platnost a publikum
zůstávají podmínkami akceptace. Výjimka „schváleno bez TLP“ se nevrací.
Globální readiness se nesmí zapnout náhradním přepínačem.

## Důkazy a další pořadí

Sanitizované výsledky jsou v [adresáři důkazů](stratos-handoff-2026-09-06/):
identita obrazů, finální smoke a test běžného časování. Soukromé syntetické
účty a diagnostické skripty jsou v ignorovaném `data/local-acceptance/`.
Hesla, cookies a tokeny nejsou v publikovaných důkazech.

Nejbližší práce: STRATOS SSO-01 a dodání knihovny; AKB SSO-02 a oba topbary;
potom opakovat celé SSO včetně odhlášení a změn oprávnění. Souběžná aplikační
závislost: AKB PF/ArchFlow kontrakty a Budget audience, poté adaptéry STRATOS.
Každý konektor musí samostatně projít pozitivní i negativní cestou až do Chatu.
