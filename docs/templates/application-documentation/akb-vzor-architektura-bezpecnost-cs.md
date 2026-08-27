---
type: system
document_type: attachment
title: "Vzor: architektura a bezpečnost aplikace"
external_ref: DOC-AKB-TEMPLATE-ARCHITECTURE
application_id: akb
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, vzor, autorstvi, architektura, bezpecnost]
documentation_profile: akb-application-docs-1
documentation_kind: vzor
document_revision: "1.2"
target_environment: obecne
applies_to: "Vzor pro autory; není bezpečnostním posudkem"
reviewed_on: "2026-08-27"
---

# Vzor: architektura a bezpečnost aplikace

## Použití vzoru

Jde o osnovu pro vlastníka aplikace a bezpečnostního posuzovatele. Nenahrazuje risk assessment ani schválení provozu. Podle [metodiky](../../how-to/akb-metodika-tvorba-dokumentace-aplikaci-cs.md) založte dokument s novou identitou a vyplňte všechny údaje `DOPLNIT`.

## Účel a hranice

DOPLNIT: Co aplikace řeší, co naopak neřeší, pro koho je určena a ke kterému vydání a prostředí se popis vztahuje. Odlišit návrh od skutečně ověřeného stavu.

## Komponenty a toky dat

| Komponenta | Odpovědnost | Kanonická data | Závislosti |
| --- | --- | --- | --- |
| DOPLNIT | DOPLNIT | DOPLNIT | DOPLNIT |

DOPLNIT: Čitelný diagram a jeho textový popis; uživatel, vstupní bod, interní služby, data, externí služby a hranice důvěry. Uvést směr komunikace a účel, ne pouze seznam ikon.

## Identity a klasifikace

DOPLNIT: Autorita identity, relace, udělení a odebrání oprávnění, účty služeb, klasifikace dat a přístupy externích čtenářů. Rozlišit roli od rozsahu dat. Popsat přístupy ke zdroji i odvozeným souborům a indexům.

DOPLNIT: Výchozí a případný volitelný OIDC režim, centrální politika relace, nezávislá přístupová projekce, oddělení uživatelských a služebních klientů a zákaz slučování identity podle e-mailu. Uvést, která služba smí přistupovat do adresáře a která pouze ověřuje OIDC. Odlišit existenci implementace od aktivace a akceptace v daném prostředí.

## Síť, secrets a monitoring

DOPLNIT: Prostupy, TLS, správa důvěry, způsob distribuce a rotace tajných údajů. Konkrétní secret hodnoty se uvádějí pouze v určeném chráněném úložišti, nikdy zde. Popsat sběr bezpečných technických metadat, audit a odpovědnost za alerty.

## Hrozby a omezení

| Riziko | Opatření | Důkaz nebo neověřená podmínka | Vlastník |
| --- | --- | --- | --- |
| DOPLNIT | DOPLNIT | DOPLNIT | DOPLNIT |

Zahrnout neoprávněné čtení, podvržený zdroj, chybný upload, ztrátu dat, výpadek závislosti a přístup při změně role. Tvrzení „bezpečné“ bez důkazu nestačí.

## Kontinuita a změny

DOPLNIT: Autoritativní zálohy, obnova, závislost na klíčích, schválené RPO/RTO, související provozní runbook a podmínky nové bezpečnostní kontroly po změně.

## Závěr posouzení

DOPLNIT: Co bylo skutečně ověřeno, co zůstává otevřené, kdo rozhoduje a pro jaké vydání. Bez vyplnění nejde o pozitivní bezpečnostní stanovisko.
