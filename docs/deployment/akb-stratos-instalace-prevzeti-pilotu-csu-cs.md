---
type: runbook
document_type: procedure
title: "AKB a STRATOS: instalace a převzetí pilotu ČSÚ"
external_ref: DOC-AKB-STRATOS-PILOT-INSTALL
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, csu-pilot, instalace, akceptace, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: instalace
document_revision: "1.0"
target_environment: csu-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-27"
---

# AKB a STRATOS: instalace a převzetí pilotu ČSÚ

> Tento dokument je kontrolní postup, nikoliv záznam provedené instalace. Před skutečným nasazením vlastníci aplikací doplní release, konfiguraci a konkrétní příkazy pro schválené prostředí.

## Účel

Tento postup navazuje na [infrastrukturní návrh](akb-stratos-instalace-infrastruktura-pilotu-csu-cs.md). Slouží pro řízené nasazení malého interního testovacího prostředí. Neobsahuje přístupové údaje, konkrétní IP adresy ani příkazy závislé na infrastruktuře ČSÚ.

AKB a STRATOS se nasazují z nezávislých repozitářů a vlastníci aplikací za ně odpovídají samostatně. Společné jsou pouze předem schválené infrastrukturní a integrační hranice.

## Fáze 0: převzetí prostředí

ČSÚ IT předá:

1. interní DNS, TLS a přístup ze správcovské sítě;
2. oddělené VM nebo schválené sdílené služby;
3. PostgreSQL databáze a účty oddělené pro AKB a STRATOS;
4. samostatný AKB S3 bucket s minimálními právy;
5. Keycloak realm, klienty a redirect URI pro obě aplikace;
6. interní ClamAV endpoint pro AKB uploady;
7. centralizované zálohy a monitoring;
8. schválený AI a embedding endpoint, pokud se má používat generativní chat.

Před nasazením se ověří, že z uživatelské VLAN jsou dostupné jen interní HTTPS adresy a že databáze, object storage, Redis, indexy, ClamAV a telemetry nejsou z této VLAN ani z internetu dosažitelné.

## Fáze 1: AKB bez živých doménových integrací

Před startem potvrďte podporovaný profil přístupové projekce a Information Policy. Samostatné OIDC nestačí k nahrazení STRATOS Access Governance. Pokud není tato závislost vyřešena, instalaci nepřijímejte jako funkční standalone provoz.

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
| Budget | „Jaký má IT rozpočet na rok 2025?“ | pouze autorizovaný rozsah, viditelná neúplnost, pokud existuje |
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

## Výstupy pro převzetí ČSÚ

Při ukončení instalace předají vlastníci aplikací společný záznam obsahující:

- release SHA a immutable image identity AKB i STRATOS;
- seznam interních URL a potvrzení, že nejsou zveřejněné do internetu;
- výsledky health/readiness a integračního preflightu;
- seznam pilotních rolí a jejich záměrně omezených oprávnění;
- výsledek dokumentového uploadu, skenu, publikace, citace a historického dotazu;
- výsledek testu integrace Director Copilot nebo explicitní potvrzení, že v pilotu není zapnut;
- ověření zálohy, obnovy, monitoringu a alertů;
- známá omezení, odpovědné osoby a postup eskalace incidentu.

## Zdroje aktuálního stavu

Tento runbook vychází z aktuálních AKB dokumentů `docs/deployment/`, `docs/security.md`, `docs/observability.md` a `docs/OPERATIONS/backup-restore.md` a z aktuálních STRATOS dokumentů `docs/03_ARCHITECTURE.md`, `docs/05_SECURITY.md`, `docs/09_DEPLOYMENT.md` a `docs/10_OPERATIONS.md` v repozitáři STRATOS.

Zadání označovaná jako `docs/60_STRATOS_AKB_INTEGRATION_AND_SECURITY_GUIDE.md` a `docs/62_AKB_DOCUMENTATION_SUITE_TASK.md` nebyla při přípravě 27. 8. 2026 v dostupném pracovním stromu STRATOS nalezena. Po jejich zpřístupnění je potřeba provést věcnou kontrolu a zapracovat případné rozdíly před ostrým nasazením. Přesné podklady a otevřené body jsou v [předávacím rozcestníku](../handover/akb-stratos-predani-dokumentace-csu-cs.md).
