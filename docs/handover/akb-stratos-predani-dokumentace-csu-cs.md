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
document_revision: "1.0"
target_environment: csu-test
applies_to: "Příprava malého interního testovacího nasazení"
reviewed_on: "2026-08-27"
---

# AKB a STRATOS: předání dokumentace pro pilot ČSÚ

## Co se předává

Revize sady **1.0**, připravená **27. 8. 2026**, je podkladem pro posouzení vedením, bezpečnostní komunitou a IT správci. Zahrnuje návrh malého pilotu dostupného pouze ve vnitřní síti ČSÚ, nikoli z internetu. Nevydává návrh kapacit, příklad otázky ani popis funkce za potvrzený stav cílového prostředí.

Předání obsahuje osm věcných podkladů, tento rozcestník, metodiku, postup vložení a pět autorských vzorů. Markdown je kanonický zdroj; odvozená PDF a kontrolní součty slouží pro pohodlné čtení a kontrolu distribuční sady.

**Stav:** dokumentační návrh. Nejde o nasazení, schválení provozu, přidělení externích oprávnění ani potvrzení, že sada už byla vložena a publikována v aplikaci AKB. Vložení se dokládá samostatným protokolem s ID dokumentů a verzí.

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

Stálé identifikátory jsou uvedeny v YAML každého dokumentu a ve strojové inventuře `akb-stratos-dokumentacni-sada.json`. Inventura také zachycuje původní názvy před sjednocením. Při aktualizaci již vložených podkladů se musí použít jejich existující identita; samotné přejmenování nesmí vytvořit duplicitu.

Revize dokumentace není totéž co release aplikace. Přiložené PDF musí vždy odpovídat stejné revizi MD; má vlastní hash a dohledatelný zdroj. Distribuční souhrnné PDF není novou autoritou nad jednotlivými dokumenty. Při importu se nemá indexovat společně se všemi originály jako další nezávislý zdroj týchž faktů.

## Z čeho sada vychází

Kontrola vychází z lokálních repozitářových podkladů:

- AKB baseline commit `48c4637e2257731341ae511841d723a8dbe904e0`: standardní architektura, bezpečnost, provoz, integrační profily, dokumentové UI a konverze náhledů.
- STRATOS baseline commit `32a47f74b8f3a16111db8a203df82a575545596e`: `docs/03_ARCHITECTURE.md`, `docs/05_SECURITY.md`, `docs/09_DEPLOYMENT.md`, `docs/10_OPERATIONS.md`, `docs/16_PRODUCT_SUITE.md`.
- Rozpracované předávací texty byly v této revizi sjednoceny a doplněny. Baseline SHA nejsou tvrzením o aktuálně běžící produkci ani o commitu nově připravených textů.

Dokumenty STRATOS `docs/60_STRATOS_AKB_INTEGRATION_AND_SECURITY_GUIDE.md` a `docs/62_AKB_DOCUMENTATION_SUITE_TASK.md` nebyly v dostupném pracovním stromu při přípravě nalezeny. Vlastník STRATOS je musí poskytnout nebo potvrdit náhradní autoritativní podklady před instalační akceptací. AKB je nenahrazuje smyšleným kontraktem.

Současná podpora Markdownu, konverze Office a inventury byla ověřována také v `services/ingestion-service/renditions/pdf.py`, `apps/web/src/features/documents/document-detail.tsx` a `tools/okf_profile.py`. Jde o kontrolu implementace, nikoli provedený test cílového ČSÚ prostředí.

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

AKB může být nasazeno bez živých doménových dotazů Director Copilot, ale tím automaticky nezmizí závislost podporovaného profilu na Access Governance. Skutečný standalone režim bez STRATOS musí mít zvlášť doložený podporovaný způsob autorizace; neověřená hlavička ani mock nejsou náhradou.

## Doporučené pořadí převzetí

1. Vedení, bezpečnost a IT posoudí rozsah a otevřené podmínky tohoto návrhu.
2. Vlastníci doplní konkrétní cílové vydání, infrastrukturu a odpovědnosti.
3. Správce dokumentace vloží věcné podklady, metodiku a vzory řízenou cestou do AKB jako koncepty.
4. Oprávněný vlastník provede obsahovou kontrolu a schválení určeného rozsahu.
5. Provede se dokumentová, přístupová, chatová a případně integrační akceptace. Teprve protokol doloží stav „ověřeno“.
