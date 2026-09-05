---
type: runbook
document_type: procedure
title: "AKB a STRATOS: instalace a převzetí pilotu"
external_ref: DOC-AKB-STRATOS-PILOT-INSTALL
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, interni-pilot, instalace, akceptace, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: instalace
document_revision: "1.3"
target_environment: customer-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-28"
---

# AKB a STRATOS: instalace a převzetí pilotu

> Tento dokument je kontrolní postup, nikoliv záznam provedené instalace. Před skutečným nasazením vlastníci aplikací doplní release, konfiguraci a konkrétní příkazy pro schválené prostředí.

## Účel

Tento postup navazuje na [infrastrukturní návrh](akb-stratos-instalace-infrastruktura-pilotu-cs.md). Slouží pro řízené nasazení malého interního testovacího prostředí. Neobsahuje přístupové údaje, konkrétní IP adresy ani příkazy závislé na infrastruktuře zákazníka.

AKB a STRATOS se nasazují z nezávislých repozitářů a vlastníci aplikací za ně odpovídají samostatně. Společné jsou pouze předem schválené infrastrukturní a integrační hranice.

## Fáze 0: převzetí prostředí

IT zákazníka předá:

1. interní DNS, TLS a přístup ze správcovské sítě;
2. oddělené VM nebo schválené sdílené služby;
3. PostgreSQL databáze a účty oddělené pro AKB a STRATOS;
4. samostatný AKB S3 bucket s minimálními právy;
5. schválený OIDC issuer, registrace samostatných klientů a přesné redirect/logout URI;
6. interní ClamAV endpoint pro AKB uploady;
7. centralizované zálohy a monitoring;
8. schválený AI a embedding endpoint, pokud se má používat generativní chat.

Před nasazením se ověří, že z uživatelské VLAN jsou dostupné jen interní HTTPS adresy a že databáze, object storage, Redis, indexy, ClamAV a telemetry nejsou z této VLAN ani z internetu dosažitelné.

### Předpoklady centrálního přihlášení

IAM a vlastníci aplikací nejprve zvolí externí OIDC režim, nebo volitelnou identity službu STRATOS. Existující schválený Keycloak issuer se bez společného souhlasu nemění. Režim identity služby STRATOS nevyžaduje Keycloak, ale vyžaduje akceptované zdroje AD/LDAPS či OIDC. AKB nedostává adresářová hesla, LDAP konektor ani přístup do jejich sítě.

1. Ověřte discovery a TLS řetězec explicitně schváleného issueru z prohlížeče i ze serverů. Neodvozujte důvěru z hodnoty dodané v uživatelském tokenu.
2. Pro AKB a samostatný Chat zaregistrujte samostatné klienty. V režimu identity služby STRATOS použijte Authorization Code + PKCE S256, `token_endpoint_auth_method=none`, scopes `openid profile email` a přesné redirect/logout URI bez wildcardů. Client secret jiného issueru se novému poskytovateli nikdy neposílá.
3. Pro AKB i Chat připravte oddělený klíč šifrování serverových tokenů. Klíče nepatří do Compose, image, PDF ani Git; každý má vlastní chráněné předání a obnovu. Nesdílejte cookie Domain ani relaci mezi aplikacemi.
4. Při externím Keycloaku ověřte s IAM mapper `stratos-session-policy-mapper` pro příslušné browser klienty a jeho kompatibilitu s konkrétní nasazovanou verzí. Instalace mapperu je samostatná IAM změna; nepřidává se service klientům a nemění jejich role nebo audience.
5. Připravte uživatelské i technické identity pro celý zvolený profil. Chybějící schválený kontrakt některého workeru je blokátorem úplného přepnutí, i když browser přihlášení již funguje.

### Přijímané tokeny volitelné identity služby STRATOS

Tato tabulka platí pouze pro explicitně nakonfigurovaný režim identity služby STRATOS. Neprovádí sama migraci klientů stávajícího externího issueru.

| Klient nebo účel | Audience a minimální rozsah | Povinné ověření |
| --- | --- | --- |
| AKB / Chat, uživatelský access token | přesně `akl-api` a `stratos-access-api` | schválený issuer a podpis, UUID v `sub`, `stratos_roles`, `identity_source`, `identity_audience` |
| AKB / Chat, ID token | vlastní browser client ID | samostatná OIDC validace včetně nonce; není náhradou access tokenu |
| Director Copilot: tři samostatní klienti | vždy jediná audience `budget-api`, `projectflow-api` nebo `archflow-api`; scope `director-copilot:read` | `stratos_service=true`, správný `client_id`, žádné lidské role |
| Budget čte řízená pravidla AKB | pouze `akl-api`; scope `controlled-rules-read` | `stratos_service_roles=["service_budget_rules_read"]` a samostatný route grant; bez dokumentových a administračních práv |

### Akceptace politiky relací

Volbu zapamatování zařízení uživatel provádí pouze na centrální přihlašovací stránce. AKB nesmí zobrazovat druhou volbu a běžný vstup nesmí vynucovat `prompt=login` ani `max_age=0`. Při chybějící relaci zahájí jeden Authorization Code + PKCE tok, ne nekonečnou přesměrovací smyčku.

- Persistenci určuje pouze platně podepsaný a ověřený access token: boolean `stratos_remember_device` a neměnný `stratos_session_started_at` v Unix sekundách. `auth_time` není nový začátek dlouhodobé relace.
- Zapamatovaná relace končí nejpozději po 30 dnech neaktivity nebo 90 dnech od centrálního začátku, podle toho, co nastane dříve. Přechod do jiné aplikace ani refresh tento strop neposouvá.
- Bez doložené dlouhodobé politiky vzniká pouze session cookie bez `Max-Age` a `Expires`, nejvýše 8 hodin neaktivity a 24 hodin absolutně. Je-li doložen centrální začátek, strop se odvozuje od něj. Již expirovaný doložený začátek se nenahradí novým obdobím.
- Identita se při aktivitě znovu ověří nejpozději po 15 minutách. Každý relevantní přístup navíc potřebuje aktuální projekci a Information Policy; výpadek autorizace není důvodem použít statické claims.
- Odhlášení odvolá lokální relaci a cookie i při výpadku issueru. Obnova tokenu nesmí oživit odvolanou relaci. Po logoutu aplikace nezahájí automatické opětovné přihlášení.

Otestujte ve stejném prohlížeči a profilu přechody STRATOS -> AKB -> Chat a zpět, obě volby zapamatování, expiraci, revokaci, výpadek issueru, chybný callback a změnu účtu. Samostatná instalovaná PWA může mít oddělený profil a potřebovat vlastní první přihlášení. Do protokolu patří výsledky a correlation ID, nikoli tokeny či cookie.

## Fáze 1: AKB bez živých doménových integrací

Před startem ověřte centrální přístupovou projekci a Information Policy ze STRATOS. Samotné přihlášení přes OIDC nenahrazuje správu oprávnění. Dokumentové funkce se zpřístupní až po úspěšném ověření této závislosti.

Vlastník AKB provede nasazení přes neměnný release z ověřeného commitu. Build nesmí poprvé vznikat na cílovém produkčním hostiteli. Konfigurace se předává výhradně chráněným mechanismem prostředí; `.env`, tokeny, klientské secrety a privátní klíče nepatří do repozitáře ani image.

Povinné kontroly po startu:

- interní AKB web a chat jsou dostupné přes reverse proxy;
- `/akb/api/health` a `/akb/api/ready` jsou zdravé;
- Registry, ingestion, RAG, object storage, databáze, Qdrant a scanner mají očekávaný stav;
- upload malého neškodného souboru skončí skenem `OK`, vytvoří verzi a citaci;
- simulovaný výpadek scanneru nebo indexu není vyhodnocen jako úspěch;
- koncept není viditelný běžnému zaměstnanci a publikovaný dokument ano;
- audit neobsahuje soubory, prompty, odpovědi, cookie, tokeny ani secrets.

Pokud není AI služba součástí pilotu, AKB zůstává použitelný pro řízené dokumenty, vyhledávání a citace. Chat nesmí při nedostupném modelu předstírat odpověď.

## Fáze 2: STRATOS

Vlastník STRATOS nasadí vlastní immutable release podle jeho provozní dokumentace. Ověří zejména weby, API, PostgreSQL, Redis, OIDC a vlastní health a readiness endpointy. AKB tým do STRATOS runtime ani jeho oprávnění nezasahuje.

Pro společný pilot musí STRATOS dodat:

- aktuální Director Copilot V2 kontrakt, revizi a bundle hash;
- read-only manifesty Budgetu, ProjectFlow a ArchFlow;
- service identity s minimálními route granty a správnou audience;
- aktivní access projection pro pilotní uživatele;
- veřejně popsané bezpečné stavy `no_data`, `partial`, `conflict`, `denied` a `unavailable`.

## Fáze 3: integrace AKB se STRATOS

AKB provede pouze read-only preflight manifestů a tokenů. Integrace se zapne nejprve v režimu shadow. Povýšení vyžaduje shodu kontraktu, bundle hashů, audience, service grantů, scope, Information Policy a evidence gate.

Akceptační dotazy se provádějí vždy pod reálným pilotním uživatelem:

| Oblast | Příklad ověření | Očekávání |
| --- | --- | --- |
| Dokumenty | „Kde najdu formulář pro zahraniční cestu?“ | citovatelný dokument nebo bezpečný nedostatek zdroje |
| Řízená pravidla | „Jaký je limit průzkumu trhu?“ | správná verze, účinnost, precedence a citace |
| Budget | „Jaký má IT rozpočet na letošní rok?“ | pouze autorizovaný rozsah, viditelná neúplnost, pokud existuje |
| ProjectFlow | „Jaký je stav projektového portfolia?“ | pouze autorizované projekty a živý zdroj |
| ArchFlow | „Jaké potřeby čekají na posouzení?“ | pouze povolená data nebo bezpečný `no_data`/`denied` |

Živá data STRATOS nikdy nenahrazuje dokumentový RAG. Chyba manifestu, autorizace, stránky, evidence nebo zdroje musí skončit fail-closed odpovědí s uživatelsky srozumitelným vysvětlením a technickým correlation ID pouze pro oprávněnou podporu.

## Fáze 4: bezpečnostní a obnovovací akceptace

Před převzetím pilotu se ověří:

1. neplatný, expirovaný nebo odvolaný uživatel nezíská dokumenty ani živá data;
2. běžný zaměstnanec čte publikované směrnice pro zaměstnance, ale nemůže je měnit, schválit ani publikovat;
3. uživatel bez `akb:read_document` neotevře chráněný dokument ani citaci;
4. servisní identita nepřevezme lidská oprávnění;
5. upload překračující limit, výpadek ClamAV, neznámý typ nebo nález malwaru nepřijme dokument jako čistý;
6. při výpadku PostgreSQL, S3, Qdrantu, OpenSearch, modelu, registru nebo STRATOS endpointu nevznikne domyšlená odpověď;
7. záloha podle schváleného harmonogramu se vytvoří a izolovaný test obnovy vrátí konzistentní data, dokumentové objekty a dohledatelnou auditní historii;
8. centrální monitoring vidí health, readiness, p95 latenci, chyby, fronty, volné místo a stav záloh.

## Release, rollback a změny

- Release je povýšení stejného plného commit SHA, který prošel povinným CI a image buildem. Neznámý nebo smíšený rozsah změn spouští plné CI.
- Nasazení používá neměnné image tagy nebo digesty, release evidence, zálohu před migrací a health/readiness kontrolu po aktivaci.
- Při selhání se aktivuje předchozí ověřený release a obnovuje se pouze podle schváleného restore postupu. Nemažou se dokumenty, indexy ani auditní data jako způsob řešení incidentu.
- Konfigurace, schema migrace, integrační kontrakty, model, klasifikace nebo Information Policy vyžadují řízenou změnu a opakování relevantní akceptace.

## Výstupy pro předání zákazníkovi

Při ukončení instalace předají vlastníci aplikací společný záznam obsahující:

- release SHA a immutable image identity AKB i STRATOS;
- seznam interních URL a potvrzení, že nejsou zveřejněné do internetu;
- výsledky health/readiness a integračního preflightu;
- seznam pilotních rolí a jejich záměrně omezených oprávnění;
- zvolený issuer, identity profil, ověření TLS a SSO politiky; žádné tajné hodnoty;
- výsledek dokumentového uploadu, skenu, publikace, citace a historického dotazu;
- výsledek testu integrace Director Copilot nebo explicitní potvrzení, že v pilotu není zapnut;
- ověření zálohy, obnovy, monitoringu a alertů;
- známá omezení, odpovědné osoby a postup eskalace incidentu.

Podpora funkce v předávaném kódu není potvrzením jejího produkčního zapnutí. V protokolu se každá volitelná funkce označí jako zapnutá a ověřená, nezapnutá, nebo blokovaná konkrétní nesplněnou podmínkou. Vydání s neověřeným společným SSO se nepředává jako již akceptované.

## Navazující postupy

- [Provoz a správa pilotu](akb-stratos-provoz-pilot-cs.md).
- [Bezpečnost a obnova pilotu](akb-stratos-bezpecnost-obnova-pilotu-cs.md).
- [Předávací list a odpovědnosti](../handover/akb-stratos-predani-dokumentace-cs.md).
