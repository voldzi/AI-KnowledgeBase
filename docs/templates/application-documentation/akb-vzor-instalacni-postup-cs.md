---
type: runbook
document_type: attachment
title: "Vzor: instalační postup aplikace"
external_ref: DOC-AKB-TEMPLATE-INSTALL
application_id: akb
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, vzor, autorstvi, instalace]
documentation_profile: akb-application-docs-1
documentation_kind: vzor
document_revision: "1.1"
target_environment: obecne
applies_to: "Vzor pro autory; není instalačním příkazem"
reviewed_on: "2026-08-27"
---

# Vzor: instalační postup aplikace

## Použití vzoru

Jde o osnovu pro vlastníka instalace, ne o schválený postup konkrétního prostředí. Podle [metodiky](../../how-to/akb-metodika-tvorba-dokumentace-aplikaci-cs.md) založte dokument s vlastní identitou a nahraďte všechny údaje `DOPLNIT`.

## Cíl, verze a rozsah změny

DOPLNIT: Aplikace, přesné vydání, cílové prostředí, vlastník, požadované oprávnění a očekávaný dopad na dostupnost. Rozlišit první instalaci od aktualizace.

## Předpoklady

| Oblast | Požadavek a způsob ověření |
| --- | --- |
| VM, CPU, RAM, disk | DOPLNIT: doložená kapacita, rezerva a zdroj měření |
| Databáze a objektové úložiště | DOPLNIT: oddělení dat, kompatibilní verze |
| Identita, DNS a TLS | DOPLNIT: schválené interní adresy a správci |
| Síťová spojení | DOPLNIT: zdroj, cíl, port, směr, účel |
| Záloha a obnova | DOPLNIT: ověřený bod obnovy a návratový postup |
| Artefakty a přístupové údaje | DOPLNIT: ověřený zdroj image; pouze odkaz na správu secretů |

## Konfigurace

DOPLNIT: Názvy proměnných, význam, povinnost a bezpečné výchozí hodnoty. Hodnoty secretů, soukromé klíče a produkční connection stringy sem nepatří. Popište, co se při chybě konfigurace odmítne spustit.

## Provedení

1. DOPLNIT: Ověření vydání, integrity artefaktů a dokončených kontrol.
2. DOPLNIT: Příprava dat a zálohy; podmínky přerušení.
3. DOPLNIT: Migrace a start, včetně pořadí závislostí.
4. DOPLNIT: Zdraví služeb, skutečná připravenost a minimální uživatelský test.

Příkazy doplňte až po ověření v daném prostředí. Uveďte pracovní adresář, účet, dopad a očekávaný návratový stav. Zástupný příkaz se nesmí tvářit jako připravený produkční příkaz.

## Akceptace

DOPLNIT: Test přihlášení, minimálních oprávnění, čtení a zápisu, zálohy a hlavní integrace. Ke každému testu uveďte očekávání, skutečný výsledek, datum a vydání. Neprovedené testy označte.

## Selhání a návrat

DOPLNIT: Kdy zastavit, kdo rozhoduje o návratu, co lze vrátit a které migrace jsou nevratné. Návrat image automaticky nevrací databázi. Nikdy nenahrazujte obnovu mazáním dat.

## Předání

DOPLNIT: Běžící verze, vlastník služby, podpora, monitoring, ověřená záloha a známá omezení. Auditní protokol neobsahuje secrets.
