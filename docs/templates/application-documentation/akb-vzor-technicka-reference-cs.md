---
type: api
document_type: attachment
title: "Vzor: technická reference a integrace aplikace"
external_ref: DOC-AKB-TEMPLATE-REFERENCE
application_id: akb
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, vzor, autorstvi, api, integrace]
documentation_profile: akb-application-docs-1
documentation_kind: vzor
document_revision: "1.2"
target_environment: obecne
applies_to: "Vzor pro autory; nepopisuje existující API"
reviewed_on: "2026-08-27"
---

# Vzor: technická reference a integrace aplikace

## Použití vzoru

Tato osnova sama nezavádí žádný endpoint, kontrakt ani oprávnění. Založte vlastní referenci podle [metodiky](../../how-to/akb-metodika-tvorba-dokumentace-aplikaci-cs.md) a každý údaj `DOPLNIT` doložte autoritativním schématem nebo implementací.

## Rozsah a verze

DOPLNIT: Aplikace, komponenta, vydání, revize kontraktu, podporované prostředí, vlastník rozhraní a odkaz na strojové schéma. Rozlišit stabilní API od návrhu a od interního nepublikovaného rozhraní.

## Identity a hranice přístupu

DOPLNIT: Typ klienta, ověřovaná audience, minimální role/scopes, pravidla autorizace každé operace a tenant boundary. Žádné bearer tokeny ani client secrety v příkladech.

DOPLNIT: Výslovně schválený issuer a discovery, oddělená validace access a ID tokenu, PKCE a nonce u browser klienta, časové limity relace a chování při neplatném podpisu nebo revokaci. Jde-li o volitelný režim, uvést přesné podmínky jeho aktivace a kompatibility bez automatického přepnutí.

## Operace a parametry

| Operace | Metoda a cesta | Parametry a limity | Výsledek |
| --- | --- | --- | --- |
| DOPLNIT | DOPLNIT | DOPLNIT | DOPLNIT |

DOPLNIT: Povinná pole, enum hodnoty, null versus prázdný seznam, datum a časové pásmo, jednotky, chybové kódy a stránkování. Příklady musí být syntetické a musí projít validací proti uvedenému schématu.

## Úplnost, opakování a konzistence

DOPLNIT: Idempotence, retry, timeout, kurzor, vazba na snapshot a změny oprávnění. Jak klient pozná úplný výsledek a co nesmí tvrdit z částečné odpovědi.

## Výpadkové chování

| Situace | Bezpečný stav a reakce klienta |
| --- | --- |
| Neplatná identita nebo nedostatečný přístup | DOPLNIT |
| Výpadek zdroje či timeout | DOPLNIT |
| Nesoulad kontraktu nebo neúplná odpověď | DOPLNIT |

## Změny a ověření

DOPLNIT: Kompatibilita s předchozí verzí, vlastník změny, testy pozitivního i negativního chování a vydání, vůči kterému prošly. Vzorové hodnoty ani text „DOPLNIT“ nejsou provozní kontrakt.
