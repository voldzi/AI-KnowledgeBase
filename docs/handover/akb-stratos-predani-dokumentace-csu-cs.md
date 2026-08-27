---
type: knowledge_article
document_type: project_documentation
title: "AKB a STRATOS: předání dokumentace pro pilot ČSÚ"
external_ref: DOC-AKB-STRATOS-HANDOVER
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, csu-pilot, predani, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: prehled
document_revision: "1.1"
target_environment: csu-test
applies_to: "Příprava malého interního testovacího nasazení"
reviewed_on: "2026-08-27"
---

# AKB a STRATOS: předání dokumentace pro pilot ČSÚ

## Co se předává

Dokumentační sada **1.1** ze dne **27. 8. 2026** popisuje AKB a STRATOS a požadavky na jejich malé testovací nasazení v ČSÚ. Pilot je dostupný **pouze ve vnitřní síti ČSÚ**, nikoli z internetu. Sada je určena vedení, bezpečnostnímu týmu, IT správcům, autorům dokumentace a pilotním uživatelům.

Předání obsahuje osm věcných podkladů, tento rozcestník, metodiku, postup vložení a pět autorských vzorů. Markdown je kanonický zdroj; odvozená PDF a kontrolní součty slouží pro pohodlné čtení a kontrolu distribuční sady.

**Určení:** posouzení a příprava pilotu. Kapacity jsou návrhem k potvrzení IT ČSÚ. Konkrétní vydání aplikací, přístupy, provozní odpovědnosti a výsledky ověření se zaznamenají při převzetí instalace. Dokumenty se v AKB zpřístupní až po obsahovém schválení a nastavení příjemců.

## Rozsah řešení

- **AKB** spravuje dokumenty, přílohy, pravidla, vyhledávání a citované odpovědi chatu.
- **Budget & Contract** spravuje rozpočty, finanční plány, zakázky a smluvní evidenci.
- **ProjectFlow** spravuje projekty, milníky, rizika, rozhodnutí a stav portfolia.
- **ArchFlow** spravuje potřeby, jejich posouzení a návaznost na plánování.

STRATOS zajišťuje společné prostředí svých aplikací, správu přístupů a manažerské přehledy. AKB s ním spolupracuje přes zabezpečená rozhraní. Jednotné přihlášení nemění rozdělení odpovědností ani oprávnění k datům.

## Kudy začít

| Čtenář | Dokument |
| --- | --- |
| Vedení organizace | [Přehled pro vedení](../executive/akb-stratos-prehled-pro-vedeni-cs.md) |
| Vlastník aplikace a vedení | [Katalog funkcí a datových autorit](../executive/akb-stratos-reference-katalog-funkci-cs.md) |
| Bezpečnostní komunita | [Podklad pro bezpečnostní posouzení](../executive/akb-stratos-bezpecnost-posouzeni-cs.md) |
| IT infrastruktura | [Infrastruktura interního pilotu](../deployment/akb-stratos-instalace-infrastruktura-pilotu-csu-cs.md) |
| Instalační tým | [Instalace a převzetí pilotu](../deployment/akb-stratos-instalace-prevzeti-pilotu-csu-cs.md) |
| Správce a podpora | [Provoz pilotu](../deployment/akb-stratos-provoz-pilot-csu-cs.md) |
| Správce obnovy a bezpečnost | [Obnova a kontinuita](../deployment/akb-stratos-bezpecnost-obnova-pilotu-csu-cs.md) |
| Pilotní uživatel | [Uživatelský průvodce](../deployment/akb-stratos-uzivatel-pilot-csu-cs.md) |
| Autor a dodavatel dokumentace | [Metodika a jmenná konvence](../how-to/akb-metodika-tvorba-dokumentace-aplikaci-cs.md) |
| Správce dokumentace AKB | [Vložení a ověření sady](../how-to/akb-postup-vlozeni-predavaci-dokumentace-cs.md) |

Autorské vzory jsou rovnocennou součástí sady, ale **nejsou schválenými provozními návody**:

- [Vzor uživatelského postupu](../templates/application-documentation/akb-vzor-uzivatelsky-postup-cs.md).
- [Vzor instalačního postupu](../templates/application-documentation/akb-vzor-instalacni-postup-cs.md).
- [Vzor provozního postupu a obnovy](../templates/application-documentation/akb-vzor-provozni-obnova-cs.md).
- [Vzor technické reference](../templates/application-documentation/akb-vzor-technicka-reference-cs.md).
- [Vzor architektury a bezpečnosti](../templates/application-documentation/akb-vzor-architektura-bezpecnost-cs.md).

## Identita, revize a přílohy

Stálé identifikátory jsou uvedeny v metadatech každého dokumentu a v [seznamu souborů sady](akb-stratos-dokumentacni-sada.json). Při aktualizaci již vložených podkladů se použije existující identita dokumentu a založí jeho nová verze.

Revize dokumentace není totéž co release aplikace. Přiložené PDF musí vždy odpovídat stejné revizi MD; má vlastní hash a dohledatelný zdroj. Distribuční souhrnné PDF není novou autoritou nad jednotlivými dokumenty. Při importu se nemá indexovat společně se všemi originály jako další nezávislý zdroj týchž faktů.

## Co je nutné doplnit před instalací

| Otevřený údaj | Odpovědný vlastník | Podmínka převzetí |
| --- | --- | --- |
| Cílové release AKB a STRATOS, image identity | vlastníci aplikací | CI, build a integrační akceptace stejného vydání |
| Interní DNS, certifikáty a schválené síťové prostupy | IT ČSÚ | pouze vnitřní přístup, datové porty neveřejné |
| Sizing, počet uživatelů, souběh, objem dokumentů | IT ČSÚ + vlastníci | potvrzený návrh a měření pilotu |
| AI/embedding služba a nakládání s daty | bezpečnost + IT ČSÚ | schválené umístění, provoz a dostupnost |
| Přístupový model a čtenáři včetně externích osob | vlastník dat + přístupový správce | pozitivní a negativní testy; bez plošného zpřístupnění |
| Zálohy, klíče, RPO/RTO, odpovědná podpora | provoz + bezpečnost | doložená konzistentní obnova |
| Metodika, skutečné názvy rolí a kontakty | vlastníci dokumentace | věcné potvrzení a publikace |
| Import této sady do AKB | oprávněný správce dokumentace | ID/verze, scan, citace, stažení a test čtenáře |

Pilot může používat jen dokumentové funkce AKB, nebo také živé dotazy do Budgetu, ProjectFlow a ArchFlow. Obě varianty potřebují ověřenou identitu a centrální správu přístupů. Samostatná instalace bez STRATOS Access Governance není předmětem této sady.

## Doporučené pořadí převzetí

1. Vedení, bezpečnost a IT posoudí rozsah a otevřené podmínky tohoto návrhu.
2. Vlastníci doplní konkrétní cílové vydání, infrastrukturu a odpovědnosti.
3. Správce dokumentace vloží věcné podklady, metodiku a vzory řízenou cestou do AKB jako koncepty.
4. Oprávněný vlastník provede obsahovou kontrolu a schválení určeného rozsahu.
5. Provede se dokumentová, přístupová, chatová a případně integrační akceptace. Teprve protokol doloží stav „ověřeno“.
