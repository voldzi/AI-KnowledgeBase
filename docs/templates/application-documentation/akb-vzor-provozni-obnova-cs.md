---
type: runbook
document_type: attachment
title: "Vzor: provozní postup a obnova aplikace"
external_ref: DOC-AKB-TEMPLATE-OPERATIONS
application_id: akb
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, vzor, autorstvi, provoz, obnova]
documentation_profile: akb-application-docs-1
documentation_kind: vzor
document_revision: "1.3"
target_environment: obecne
applies_to: "Vzor pro autory; není oprávněním k zásahu nebo obnově"
reviewed_on: "2026-08-28"
---

# Vzor: provozní postup a obnova aplikace

## Použití vzoru

Osnova není provozní runbook. Založte vlastní dokument podle [metodiky](../../how-to/akb-metodika-tvorba-dokumentace-aplikaci-cs.md). Správce musí před použitím vyplnit a ověřit údaje `DOPLNIT`.

## Služba a odpovědnost

DOPLNIT: Aplikace, prostředí, verze, vlastník, podpora, doba podpory a oprávnění ke změně. Uveďte schválené RPO a RTO a od kterého okamžiku se počítají; návrh není SLA.

## Běžný provoz

| Kontrola | Frekvence | Očekávání | Postup při odchylce |
| --- | --- | --- | --- |
| Dostupnost a readiness | DOPLNIT | DOPLNIT | DOPLNIT |
| Fronty, latence, disk | DOPLNIT | DOPLNIT | DOPLNIT |
| Zálohy a test obnovy | DOPLNIT | DOPLNIT | DOPLNIT |
| OIDC, TLS, relace a přístupová projekce | DOPLNIT | DOPLNIT | DOPLNIT |

## Rozpoznání incidentu

DOPLNIT: Příznak pro uživatele, bezpečné read-only diagnostické kontroly, korelační ID a eskalace. Nezveřejňujte obsah dokumentů, prompty ani autentizační hodnoty v logu incidentu.

## Zálohovaná data

DOPLNIT: Kanonická data a obnovitelné indexy; databáze, soubory, konfigurace, identity a chráněné klíče. Bod obnovy, retence, šifrování a přístup. Záloha bez testu nedokazuje obnovitelnost.

## Obnova

1. DOPLNIT: Schválení a izolace cílového prostředí; zabránění nechtěným zápisům.
2. DOPLNIT: Výběr konzistentního bodu a ověření integrity zálohy.
3. DOPLNIT: Pořadí obnovy závislostí a dat; bezpečné zpřístupnění klíčů mimo dokument.
4. DOPLNIT: Kontrola vazeb, autorizace, historie a funkčních testů před otevřením služby.
5. DOPLNIT: Kritéria rozhodnutí o obnovení provozu a záznam dosaženého RPO/RTO.

DOPLNIT: Obnova zvoleného OIDC, revokací a časových stropů relací; ověření grantů a zneplatnění neobnovitelných relací. Obnova nesmí oživit odebraný přístup.

## Kdy nepokračovat

DOPLNIT: Chybějící záloha, jiná verze schématu, neověřené klíče, neúplné objekty nebo selhání autorizace. Definujte zachování důkazů a další odpovědnost; žádný automatický destruktivní pokus.

## Záznam ověření

DOPLNIT: Datum, izolované prostředí, vydání, rozsah dat, výsledky, trvání, schválení a známé odchylky. Vzor bez výsledků není důkazem provedeného restore testu.
