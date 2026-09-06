# Společná akceptace STRATOS → AKB: SSO a konektory

Aktualizace 2026-09-06: rozhodující aktuální výsledek je
[akceptace 0.5.1](stratos-ui-051-acceptance-2026-09-06.md).
Původní chyby návratu do Budgetu a souběhu AKB/Chatu jsou nyní opravené;
dokumentová akceptace stále není dokončená.
Následující checkpoint zachycuje dřívější sestavu. Nové ověření skutečného
přepínače odhalilo chybu návratu do Budgetu a souběhu AKB/Chatu. Port 3221
v tomto starším checkpointu ještě běžel jako platformní profil; samostatný
Chat byl správně zapnut a otestován až při novém ověření.

## Odpovědnost a výsledek

Vlastník souhrnné lokální akceptace je AKB/Codex v tomto pracovním úkolu.
STRATOS ověřuje a opravuje vlastní implementaci, ale jeho dílčí výsledek
nenahrazuje společný test skutečných kontejnerů. Uživatel nemusí spojovat
výsledky obou projektů. Výsledný souhlas k produkci musí vycházet z jedné
matice průchodů celým systémem.

**Celková akceptace zatím NEPROŠLA.** Prošlo jedno zadání hesla a navazující
serverové relace všech pěti webů; pozitivní práce s aplikačními daty a úplné
konektory zůstávají k dokončení. Zdravé kontejnery nejsou důkazem těchto cest.

Prostředí: `akb-stratos-test`, [runbook](../deployment/local-acceptance-docker-desktop.md).
STRATOS API bylo znovu sestaveno z checkoutu na
`000436cc8ae5250892adf230bcc56caeed512de0`, který již odstraňuje duplicitní
zapnutí CORS v NestFactory. Zdrojové soubory STRATOS tento úkol neupravoval.
Ostatní obrazy zůstávají v dřívějším lokálním checkpointu; tato sestava není
neměnný společný release kandidát.

## Co bylo skutečně ověřeno

`scripts/local_acceptance_browser_smoke.mjs` v čistém profilu Chromium:

| Krok | Výsledek |
| --- | --- |
| STRATOS: centrální login `operator`, právě jedno vyplnění hesla | PASS; Access Center a `/api/v1/auth/me` 200 |
| Návštěva ProjectFlow se stejnou centrální relací | PASS autentizace; `/api/auth/session` 200, bez dalšího zadání hesla |
| Návštěva ArchFlow, sdílená Budget serverová relace | PASS autentizace; `/api/v1/auth/me` 200, bez dalšího zadání hesla |
| Návštěva AKB | PASS; autentizovaná relace 200, tentýž subject; žádný další login klik |
| Návštěva Chatu | PASS; autentizovaná relace 200, tentýž subject; žádný další login klik |
| Návrat do STRATOS | PASS; relace 200 bez dalšího zadání hesla |
| Přepínač aplikací ve STRATOS | Odkazy míří na lokální 3231 / 3220/akb / 3232; pro bootstrap správce ukazují Bez přístupu |
| Ochrana aplikací bez doménových grantů | ProjectFlow bootstrap a ArchFlow data odmítnuty 403; AKB/Chat mají 0 capabilities a zobrazí nápovědu |

ProjectFlow test nejprve odhalil nesoulad výchozí cesty `/project` se zdejším
kořenem `/`. Generátor nyní sjednocuje prázdný `NEXT_PUBLIC_PROJECTFLOW_BASE_PATH`
a `PROJECTFLOW_SESSION_COOKIE_PATH=/`. ArchFlow nejprve blokoval chybný
`Access-Control-Allow-Origin: *` s credential requests. Nový STRATOS API obraz
obsahuje již existující upstream opravu této chyby. Ověřování TLS/JWT/CORS ani
oprávnění nebylo vypnuto.

Test zatím přechází přímou navigací na lokální adresy. **Není to ještě pozitivní
průchod klikáním v přepínači pro osobu s přidělenými profily všech aplikací.**
Tento rozdíl je součástí zbývající akceptace, nikoli důvod pro domýšlení práv
nebo vypnutí centrálního rozhodování.

## Matice konektorů

Každá aplikace musí mít samostatně ověřený příjem dokumentu a zpřístupnění
informací v Chatu. Výběr existujícího dokumentu nebo živé dotazování na business
API nejsou důkazem úspěšného přijetí nového souboru.

| Zdroj / cesta | Nynější stav | Podmínka pozitivní akceptace |
| --- | --- | --- |
| Budget & Contract → AKB | Budget atomická registrace/revalidace a replay ve STRATOS existují; příjem je uzavřen společnou readiness. AKB omezuje binary audience na budget_scope. | Smlouva/soubor, schválený profil, explicitní TLP a publikum včetně organization/recipient_set, scanner, confirm, index, Chat a citace |
| ProjectFlow → AKB | Existují reference a AI bridge; úplný zdrojový příjem s novým documentAdmission kontraktem není společně akceptovaný. | Soubor ze skutečného projektu/úkolu/zápisu, aktuální projektové oprávnění a plný průchod až k citaci |
| ArchFlow → AKB | Úplný zdrojový intake adaptér podle nového profilu zůstává k implementaci/akceptaci. | Podklad skutečné potřeby, autoritativní vazba a rozsah, TLP/gestor, příjem a citace |
| Řídicí centrum / informace aplikací → Chat AKB | SSO a administrace neprokazují federované odpovědi ani původ historie. | Každý provider samostatně: přesná service audience, manifest/readiness, oprávnění osoby, odpověď, evidence/citace a revokace |
| Nativní AKB a veřejné zdroje | Centrální adaptéry/kolekce jsou nově implementované ve STRATOS d035bdb6; společná pozitivní akceptace zůstává nedokončená. | Řízené root/version přijetí; u veřejných zdrojů schválená kolekce, vydavatel, explicitní PUBLIC/CLEAR a platnost |

Živý `local_acceptance_smoke.py` po opravách znovu prošel: infrastruktura 200,
STRATOS readiness 503 `DOCUMENT_ADMISSION_CATALOG_NOT_READY`, neplatný vstup 400,
anonymní 401, AKB readiness 503 `document_profile_admission_unavailable`.
ClamAV povolil čistý test a zachytil EICAR. Jde o pozitivní důkaz uzavřených
bezpečnostních bran; pozitivní přijetí žádného dokumentu se netvrdí.

## Zbývající souhrnná akceptace a vlastníci

| Celek | Kdo připraví/opraví | Kdo uzavře společným testem |
| --- | --- | --- |
| Testovací zaměstnanec s povolenými profily a odpovědnostmi přes skutečný Access Center; odpovídající zakázaný účet | AKB test runner, centrální správa STRATOS | AKB/Codex |
| Klikání mezi aplikacemi, zpět, nové záložky a hluboké odkazy bez dalšího loginu | Oba vlastníci podle nalezené chyby | AKB/Codex |
| Společné odhlášení, expirace, deaktivace osoby a odebrání přístupu během aktivní relace | STRATOS identity + jednotlivé BFF | AKB/Codex |
| Chybějící centrální registrační/revalidační adaptéry, kolekce a provider manifesty | STRATOS podle společných kontraktů | AKB/Codex |
| AKB binary audience, native recovery a bezpečné zpracování/Chat/citace | AKB | AKB/Codex |
| Každý konektor: jedna verze po opakování, nová verze, odvolání přístupu mezi kroky | Oba vlastníci | AKB/Codex |
| Povinné TLP, autor/vydavatel, vlastník, gestor, platnost; RED, chybějící hodnoty, škodlivý obsah a nedostupný scanner | Oba vlastníci | AKB/Codex |

Dokumentace pro STRATOS zůstává [společný handoff](../integration/STRATOS_DOCUMENT_INTAKE_HANDOFF.md).
Nelze schválit „všechny konektory“ na základě jednoho Budget testu ani zapnout
readiness náhradním přepínačem. Před nasazením musí mít každý podporovaný řádek
pozitivní i negativní důkaz ze skutečné společné sestavy.
