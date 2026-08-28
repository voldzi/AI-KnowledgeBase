---
type: knowledge_article
document_type: project_documentation
title: "AKB a STRATOS: předání dokumentace"
external_ref: DOC-AKB-STRATOS-HANDOVER
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, interni-pilot, predani, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: prehled
document_revision: "1.3"
target_environment: customer-test
applies_to: "Příprava malého interního testovacího nasazení"
reviewed_on: "2026-08-28"
---

# AKB a STRATOS: předání dokumentace

## Co se předává

Dokumentační sada **1.3** ze dne **28. 8. 2026** popisuje AKB a STRATOS a požadavky na jejich malé testovací nasazení u zákazníka. Pilot je dostupný **pouze ve vnitřní síti zákazníka**, nikoli z internetu. Sada je určena vedení, bezpečnostnímu týmu, IT správcům, autorům dokumentace a pilotním uživatelům.

Předání obsahuje osm věcných podkladů, tento rozcestník, metodiku, postup vložení a pět autorských vzorů. Markdown je kanonický zdroj; odvozená PDF a kontrolní součty slouží pro pohodlné čtení a kontrolu distribuční sady.

**Určení:** posouzení a příprava pilotu. Kapacity jsou návrhem k potvrzení IT zákazníka. Konkrétní vydání aplikací, přístupy, provozní odpovědnosti a výsledky ověření se zaznamenají při převzetí instalace. Dokumenty se v AKB zpřístupní až po obsahovém schválení a nastavení příjemců.

## Použití u různých zákazníků

Tato sada je společný produktový podklad. Popisuje interní pilotní profil, nikoli konkrétní již instalované prostředí. Název zákazníka, skutečné adresy, účty a kontakty se do obecného textu, názvů souborů, tagů ani identifikátorů nepřidávají.

Pro každé nasazení vznikne samostatný chráněný instalační a akceptační protokol. Obsahuje zvolené vydání, topologii, vlastníky služeb, přístupový model a výsledky ověření. Není součástí obecné distribuční sady; jeho příjemce a klasifikaci určuje provozovatel. Přístup mimo vnitřní síť vyžaduje samostatný schválený návrh.

## Rozsah řešení

- **AKB** spravuje dokumenty, přílohy, pravidla, vyhledávání a citované odpovědi chatu.
- **Budget & Contract** spravuje rozpočty, finanční plány, zakázky a smluvní evidenci.
- **ProjectFlow** spravuje projekty, milníky, rizika, rozhodnutí a stav portfolia.
- **ArchFlow** spravuje potřeby, jejich posouzení a návaznost na plánování.

STRATOS zajišťuje společné prostředí svých aplikací, správu přístupů a manažerské přehledy. AKB s ním spolupracuje přes zabezpečená rozhraní. Jednotné přihlášení nemění rozdělení odpovědností ani oprávnění k datům.

## Přihlášení a připravenost pilotu

Pro pilot se vybere jeden schválený poskytovatel přihlášení. Výchozí varianta používá externí OIDC službu, například organizací spravovaný Keycloak. Volitelná varianta používá identity službu STRATOS s připojením k více AD/LDAPS nebo OIDC zdrojům; nevyžaduje Keycloak. AKB se nikdy nepřipojuje přímo k LDAP a nepřebírá adresářová hesla.

Připravená podpora centrálního SSO a volitelné identity služby není dokladem jejich aktivace v cílovém prostředí. Před převzetím musí oba vlastníci potvrdit konkrétní vydání, konfiguraci klientů a společnou akceptaci. Bez tohoto potvrzení se nemění schválený issuer ani existující přihlašování.

V cílovém SSO se volba zapamatování zařízení nastavuje jednou na centrální přihlašovací stránce. AKB a samostatný Chat mají vlastní chráněné serverové relace; nesdílejí cookie, šifrovací klíče ani uživatelské tokeny. Podrobné limity a bezpečnostní kontroly stanoví [instalační postup](../deployment/akb-stratos-instalace-prevzeti-pilotu-cs.md).

## Kudy začít

| Čtenář | Dokument |
| --- | --- |
| Vedení organizace | [Přehled pro vedení](../executive/akb-stratos-prehled-pro-vedeni-cs.md) |
| Vlastník aplikace a vedení | [Katalog funkcí a datových autorit](../executive/akb-stratos-reference-katalog-funkci-cs.md) |
| Bezpečnostní komunita | [Podklad pro bezpečnostní posouzení](../executive/akb-stratos-bezpecnost-posouzeni-cs.md) |
| IT infrastruktura | [Infrastruktura interního pilotu](../deployment/akb-stratos-instalace-infrastruktura-pilotu-cs.md) |
| Instalační tým | [Instalace a převzetí pilotu](../deployment/akb-stratos-instalace-prevzeti-pilotu-cs.md) |
| Správce a podpora | [Provoz pilotu](../deployment/akb-stratos-provoz-pilot-cs.md) |
| Správce obnovy a bezpečnost | [Obnova a kontinuita](../deployment/akb-stratos-bezpecnost-obnova-pilotu-cs.md) |
| Pilotní uživatel | [Uživatelský průvodce](../deployment/akb-stratos-uzivatel-pilot-cs.md) |
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
| Interní DNS, certifikáty a schválené síťové prostupy | IT zákazníka | pouze vnitřní přístup, datové porty neveřejné |
| Zvolený OIDC issuer, zdroje identity a centrální politika relací | IAM + vlastníci aplikací | přesní klienti, důvěryhodné TLS, SSO a negativní testy; žádné automatické přepnutí |
| Sizing, počet uživatelů, souběh, objem dokumentů | IT zákazníka + vlastníci | potvrzený návrh a měření pilotu |
| AI/embedding služba a nakládání s daty | bezpečnost + IT zákazníka | schválené umístění, provoz a dostupnost |
| Přístupový model a čtenáři včetně externích osob | vlastník dat + přístupový správce | pozitivní a negativní testy; bez plošného zpřístupnění |
| Zálohy, klíče, RPO/RTO, odpovědná podpora | provoz + bezpečnost | doložená konzistentní obnova |
| Metodika, skutečné názvy rolí a kontakty | vlastníci dokumentace | věcné potvrzení a publikace |
| Import této sady do AKB | oprávněný správce dokumentace | ID/verze, scan, citace, stažení a test čtenáře |

U volitelné identity služby se samostatně ověří všechny technické identity potřebné pro zvolený rozsah pilotu, nejen přihlášení uživatele. Neověřená identita workeru nebo integrační služby je důvodem nepřepnout příslušný provozní profil.

Pilot může používat jen dokumentové funkce AKB, nebo také živé dotazy do Budgetu, ProjectFlow a ArchFlow. Obě varianty potřebují ověřenou identitu a centrální správu přístupů. Samostatná instalace bez STRATOS Access Governance není předmětem této sady.

## Doporučené pořadí převzetí

1. Vedení, bezpečnost a IT posoudí rozsah a otevřené podmínky tohoto návrhu.
2. Vlastníci doplní konkrétní cílové vydání, infrastrukturu a odpovědnosti.
3. Správce dokumentace vloží věcné podklady, metodiku a vzory řízenou cestou do AKB jako koncepty.
4. Oprávněný vlastník provede obsahovou kontrolu a schválení určeného rozsahu.
5. Provede se dokumentová, přístupová, chatová a případně integrační akceptace. Teprve protokol doloží stav „ověřeno“.
