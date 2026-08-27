---
type: knowledge_article
document_type: project_documentation
title: "AKB a STRATOS: přehled pro vedení"
external_ref: DOC-AKB-STRATOS-OVERVIEW
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, csu-pilot, vedeni, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: prehled
document_revision: "1.1"
target_environment: csu-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-27"
---

# AKB a STRATOS: přehled pro vedení

## Účel

Přehled vysvětluje přínosy, odpovědnosti a hranice AKB a STRATOS. Slouží k rozhodnutí o interním pilotu v ČSÚ. Konkrétní rozsah nasazení se potvrdí při převzetí; příklady použití vyžadují odpovídající dokumenty, integrace a oprávnění.

AKB a STRATOS tvoří jednu integrovanou pracovní platformu, nikoli jednu databázi nebo jeden monolit. Každá část má jasně vymezenou odpovědnost:

- **AKB** je důvěryhodné místo pro řízené dokumenty, interní předpisy, právní podklady, jejich verze, citace, vyhledávání, pravidla a auditovatelné odpovědi.
- **Budget & Contract** je zdrojem financí, rozpočtů, zakázek, smluv a finančních plánů.
- **ProjectFlow** je zdrojem projektové reality: plánů, milníků, rizik, problémů, rozhodnutí a stavových aktualizací.
- **ArchFlow** eviduje a posuzuje strategické nebo architektonické potřeby a převádí schválené potřeby do plánování.

Společné manažerské přehledy STRATOS skládají údaje ze zdrojových aplikací. Nejsou samostatnou evidencí a nenahrazují pracovní data Budgetu, ProjectFlow ani ArchFlow.

Společné přihlášení přes Keycloak dává uživateli jednotný vstup. Oprávnění se však vyhodnocují v každé aplikaci podle aktuální role, rozsahu a Information Policy. Přihlášení proto samo o sobě neznamená přístup ke všem datům.

## Přínos pro vedení

1. **Dohledatelné podklady pro odpověď.** U doloženého výsledku má manažer vidět zdroj, datum, rozsah a citaci. Dostupnost podkladů a správnost konkrétních odpovědí se ověří v pilotu.
2. **Rozhodování nad aktuální realitou.** Finance a projekty zůstávají v doménových aplikacích. AKB Chat je čte přes podporované kontrakty pouze v autorizovaném rozsahu; nepokrývá automaticky každou kombinaci otázky a dat.
3. **Řízené předpisy bez ztráty historie.** Platná i historická znění mají vlastní verze, účinnost, přílohy, gestory a audit.
4. **Méně ručního hledání.** Zaměstnanci mohou začít běžnou otázkou, například kde najdou formulář nebo jaký postup platí.
5. **Bezpečný negativní výsledek.** Když zdroj, oprávnění nebo důkaz chybí, systém neodhadne odpověď. Jasně označí, zda jde o chybějící podklad, neúplný výsledek, konflikt nebo dočasný výpadek.

## Co uživatelé dostávají

| Uživatel | Hlavní přínos | Příklad |
| --- | --- | --- |
| Zaměstnanec | přístup k platným podkladům a citovaným odpovědím | „Kde najdu formulář pro zahraniční cestu?“ |
| Gestor a schvalovatel | řízené vydání dokumentu a ověření pravidel | schválí nové znění směrnice a jeho přílohy |
| Finanční pracovník | dohledatelné finance, plán a smluvní souvislosti | ověří plán a zdroj finanční položky |
| Projektový tým | pracovní řízení projektu a stavové aktualizace | spravuje milníky, rizika a rozhodnutí |
| Ředitel IT / vedení | autorizovaný přehled dokumentů, financí a projektů | „Jaký je stav mého portfolia a související rozpočtové riziko?“ |
| Auditor a bezpečnostní tým | historie, autorita zdroje a auditní stopy | dohledá kdo, kdy a z jakého zdroje vydal rozhodnutí |

## Jak funguje jednotný Chat

AKB Chat klasifikuje záměr otázky a použije odpovídající autorizovaný zdroj:

| Typ otázky | Zdroj odpovědi | Co musí být vidět |
| --- | --- | --- |
| Postup, směrnice, zákon, formulář | AKB řízený dokument a citace | verze, účinnost, citace |
| Pravidlo nebo limit | AKB Controlled Rules | zdroj, precedence, účinnost, jistota |
| Rozpočet, akce, smlouva | Budget & Contract | rozsah, stav dat, čas zdroje |
| Projektové portfolio | ProjectFlow | autorizované projekty, aktuálnost a stav |
| Architektonické potřeby | ArchFlow | autorizované potřeby nebo bezpečný stav bez dat |
| Kombinovaná otázka | více ověřených zdrojů | jasné rozlišení zdrojů a jejich omezení |

Chat nesmí zaměnit tyto zdroje. Dokumentový RAG nenahrazuje živá finanční nebo projektová data. Živý zdroj naopak nemůže nahradit právně účinný předpis.

## Řízení dokumentů a pravidel

AKB podporuje životní cyklus dokumentu od karantény a antivirové kontroly, přes vytěžení metadat a příloh, po schválení, platnost, revizi a historii. Zveřejněný dokument nelze zaměnit za koncept. Přílohy jsou vazbou konkrétního vydání a historická otázka se vyhodnocuje podle rozhodného data.

Pro řízená pravidla platí:

- při konfliktu stejného normativního významu má zákonný zdroj vyšší prioritu než interní směrnice;
- interní procesní pravidlo se vyhodnocuje odděleně od zákonného limitu; nesmí být za tento limit zaměněno;
- neúplný, konfliktní nebo neověřený návrh není automatické rozhodnutí;
- aplikace mohou využít pouze schválené, časově účinné a citovatelné pravidlo.

## Hranice produktu

AKB nenahrazuje účetní systém, evidenci IT incidentů, správu konfigurací ani provozní monitoring. Projektové řízení zůstává v ProjectFlow. Dokumentové originály a jejich verze spravuje AKB; integrované aplikace na ně odkazují a nemají vytvářet vlastní neřízené kopie.

Chat poskytuje podklady pro rozhodnutí. Neprovádí automaticky schválení smlouvy, změnu rozpočtu ani jiný úkon vyhrazený odpovědné osobě.

## Metriky pro vedení

V pilotu se doporučuje sledovat:

- počet publikovaných a platných dokumentů podle oblasti a klasifikace;
- dobu od vložení dokumentu k publikaci a počet vrácených vydání;
- podíl odpovědí s přímou citací, bezpečných `no_data` a neúplných výsledků;
- p95 dobu hledání, chatu a zpracování dokumentu;
- stav záloh, obnovy a kritických bezpečnostních událostí;
- podíl manažerských dotazů, které získaly autorizovaný živý zdroj bez ruční eskalace.

Technické metriky a obsahovou kvalitu vždy interpretují příslušní vlastníci domén. Vyšší počet odpovědí není sám o sobě ukazatel kvality, pokud by vedl k oslabení autorizace nebo důkazů.

## Stav a další řízení

Rozsah řešení popisuje [katalog funkcí](akb-stratos-reference-katalog-funkci-cs.md), bezpečnostní podmínky [podklad pro bezpečnostní posouzení](akb-stratos-bezpecnost-posouzeni-cs.md). Dokumenty, odpovědnosti a podmínky převzetí jsou shrnuty v [předávacím listu](../handover/akb-stratos-predani-dokumentace-csu-cs.md).
