---
type: system
document_type: project_documentation
title: "AKB a STRATOS: podklad pro bezpečnostní posouzení"
external_ref: DOC-AKB-STRATOS-SECURITY
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, csu-pilot, bezpecnost, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: bezpecnost
document_revision: "1.1"
target_environment: csu-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-27"
---

# AKB a STRATOS: podklad pro bezpečnostní posouzení

## Rozhodnutí, která tento přehled podporuje

Dokument umožňuje vedení a bezpečnostní komunitě posoudit podmínky pilotu ve vnitřní síti. Je návrhem kontrol, nikoli bezpečnostní certifikací, protokolem penetračního testu ani potvrzením již zavedených opatření v ČSÚ. Uvedené důkazy musí dodat a vyhodnotit vlastníci při převzetí.

## Bezpečnostní principy

V tomto dokumentu znamená **oprávnění (capability)** povolení konkrétního úkonu, **rozsah (scope)** vymezení dostupných dat a **Information Policy** pravidla nakládání s konkrétním obsahem. **Fail-closed** znamená, že při neověřeném oprávnění nebo nedoloženém výsledku aplikace chráněný obsah nevydá.

1. **Určený vlastník dat.** Dokumenty, živá data, oprávnění a audit mají určenou autoritu. Akceptace má ověřit, že nevznikají neřízené kopie cizích dat.
2. **Nejnižší nutné oprávnění.** Přístup je průnik aktivní identity, členství, capability, scope, audience, klasifikace a Information Policy.
3. **Fail-closed.** Nejistota v identitě, zdroji, pravidle, stránkování nebo integraci nevede k domyšlené odpovědi ani k širšímu přístupu.
4. **Dohledatelnost bez úniku obsahu.** Audit a telemetrie nesou technická metadata a correlation ID, nikoli soubory, prompty, odpovědi či přístupové údaje.
5. **Obnovitelnost.** Kanonická data se zálohují; indexy se obnovují kontrolovaně z kanonických zdrojů.

## Hlavní kontrolní oblasti

| Riziko | Požadovaná kontrola | Důkaz požadovaný při převzetí |
| --- | --- | --- |
| Neoprávněný přístup | OIDC, serverová relace, access projection, Information Policy | audit rozhodnutí, negativní autorizační testy |
| Únik tokenu v prohlížeči | neprůhledná `HttpOnly` cookie, tokeny pouze šifrovaně na serveru | konfigurace relace a kontrola logů |
| Chybný nebo škodlivý upload | karanténa, ClamAV, limit typu a velikosti, fail-closed | scan metadata, test `FOUND` a timeoutu |
| Chybné právní nebo interní pravidlo | časová účinnost, precedence, schválení gestorem, citace | balíček pravidel, zdrojová verze a audit |
| Nepravdivá odpověď chatu | evidence gate, citace, explicitní stav neúplnosti | testovací sada, zdrojová metadata a correlation ID |
| Širší přístup přes integraci | audience-bound service identity, route grants, PEP zdroje | manifest preflight a negativní testy |
| Výpadek závislosti | readiness, timeouty, fail-closed odpověď a alerting | health/readiness, incidentní test |
| Ztráta dat | schválený plán záloh a izolovaný restore test | záznam obnovy, dosažené RPO/RTO |
| Útok z internetu | interní DNS, HTTPS, síťová segmentace, neveřejné datové porty | firewall review a síťový test |

## Hranice dat a důvěry

| Druh dat | Kanonický vlastník | Co je odvozené | Bezpečnostní důsledek |
| --- | --- | --- | --- |
| Dokumenty, přílohy, verze, citace | AKB Registry a objektové úložiště | chunking, Qdrant, OpenSearch | index lze obnovit, originál a audit se nemažou |
| Finance a zakázky | Budget & Contract | autorizovaná odpověď pro Chat | AKB nesmí finance domýšlet nebo přepisovat |
| Projekty a portfolio | ProjectFlow | read-only odpověď a Executive read-model | lokální role projektu zůstávají autoritou |
| Potřeby a posouzení | ArchFlow | autorizovaná odpověď pro Chat | citlivé potřeby nejsou vidět mimo scope |
| Identity a přístupy | Keycloak a STRATOS Access Center | krátkodobé serverové ověření | statický claim není náhradou aktuálního rozhodnutí |

## Výpadkové chování

- Nedostupný scanner: dokument zůstává v karanténě nebo je upload odmítnut.
- Nedostupný dokumentový index či model: Chat neprezentuje neověřenou odpověď.
- Nedostupný STRATOS zdroj: Chat nevyužije dokumenty jako náhradu živých dat.
- Neúplné stránkování nebo změna source version: agregace se nevydá jako úplná.
- Nedostupná access projection nebo policy: není-li možné platně ověřit oprávnění, chráněný požadavek se odmítne; nesmí přejít na statický claim nebo širší scope.
- Výpadek Keycloaku při odhlášení: lokální relace se ukončí i bez vzdálené revokace.

## Minimum před převzetím pilotu

1. Zkontrolovaná segmentace s výhradně interním přístupem.
2. Schválený model identity, správy skupin a rolí.
3. Doložený upload, scanner, dokumentové workflow a historická citace.
4. Doložené negativní autorizační a integrační testy.
5. Aktivní monitoring, alerty, zálohy a izolovaný restore test.
6. Záznam o release SHA, image identitě, konfiguraci bez secret hodnot a známých omezeních pilotu.

**Navazující podklady:** [Infrastruktura pilotu](../deployment/akb-stratos-instalace-infrastruktura-pilotu-csu-cs.md), [obnova a kontinuita](../deployment/akb-stratos-bezpecnost-obnova-pilotu-csu-cs.md), [předávací list a podmínky převzetí](../handover/akb-stratos-predani-dokumentace-csu-cs.md).
