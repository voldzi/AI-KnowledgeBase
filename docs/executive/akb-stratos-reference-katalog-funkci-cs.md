---
type: knowledge_article
document_type: project_documentation
title: "AKB a STRATOS: katalog funkcí a datových autorit"
external_ref: DOC-AKB-STRATOS-CAPABILITIES
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, interni-pilot, katalog-funkci, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: reference
document_revision: "1.3"
target_environment: customer-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-28"
---

# AKB a STRATOS: katalog funkcí a datových autorit

## Jak katalog číst

Katalog popisuje funkce aplikací a určuje, kde se spravují jejich data. Přístup uživatele závisí na jeho roli a povoleném rozsahu. Živé dotazy v chatu navíc vyžadují zapojené integrační rozhraní. Dostupnost vybraných scénářů u zákazníka se ověří při převzetí pilotu.

| Oblast | Funkce | Zdroj dat | Uživatelé |
| --- | --- | --- | --- |
| AKB | registr dokumentů, verzí, příloh a účinnosti | registr a objektové úložiště AKB | čtenář, gestor |
| AKB | karanténa, antivirová kontrola a zpracování souboru | příjem dokumentů a ClamAV | gestor, správce |
| AKB | vyhledávání v textu a podle významu, přesné citace | dokumenty a odvozené indexy | oprávnění čtenáři |
| AKB | náhled a stažení dokumentu | přesná verze originálu | oprávnění čtenáři |
| AKB | kontrola, schválení, publikace a nahrazení vydání | registr AKB | gestor, schvalovatel |
| AKB | přehled vlastních dokumentů, stavů a přiřazených schválení | přiřazení gestora a schvalovatele v registru | gestor, schvalovatel; ověřit v cílovém vydání |
| AKB | ověřená pravidla a limity ze zákonů a směrnic | schválené, účinné balíčky AKB | Chat, Budget |
| AKB | chat nad dokumenty, návody a souvislostmi | autorizované dokumenty s citacemi | zaměstnanec, vedení |
| AKB | analytický pracovní prostor a evidenční případy | AKB Intelligence | analytik, auditor |
| Budget & Contract | rozpočtový plán, akce, smlouvy a skutečnost | Budget & Contract | finance, vedení |
| Budget & Contract | finanční dotazy v chatu | živé rozhraní Budgetu | oprávnění uživatelé |
| ProjectFlow | projektový plán, milníky, rizika, rozhodnutí a stav | ProjectFlow | projektový tým |
| ProjectFlow | přehled portfolia v chatu | živé rozhraní ProjectFlow | oprávnění uživatelé |
| ArchFlow | potřeby, posouzení a návaznost na plánování | ArchFlow | pověřené role |
| ArchFlow | přehled potřeb v chatu | živé rozhraní ArchFlow | oprávnění uživatelé |
| STRATOS | společné manažerské přehledy | zdrojové aplikace STRATOS | vedení |
| STRATOS | správa oprávnění a rozsahu přístupů | STRATOS Access Center | správce přístupů |
| STRATOS | společná správa organizační struktury a povolených systémových nastavení | sekce Správa, role a organizační rozsah | určení správci; ověřit rozsah cílového vydání |
| STRATOS, volitelně | identity služba pro více AD/LDAPS a OIDC zdrojů | schválené zdroje identity, oddělené od AKB | správce identity; aktivace po společné akceptaci |
| Společné | jednotné přihlášení a serverové relace | schválený externí OIDC nebo identity služba STRATOS; vlastní relace aplikací | všichni oprávnění uživatelé |
| Společné | audit operací a přístupových rozhodnutí | AKB a STRATOS | auditor, podpora |

Náhled není zárukou totožného vzhledu všech formátů. Office využívá odvozené PDF; u Markdownu současná aplikace zobrazuje obsah a umožňuje stažení zdroje, ale negeneruje PDF celého dokumentu. PDF předávací sady je samostatně vytvořený odvozený výstup.

Katalog rozlišuje funkční rozsah a podmínky zapnutí. Volitelná identity služba, nová politika centrálních relací a pracovní přehledy se musí ověřit proti konkrétnímu vydání obou aplikací. Samotná podpora v kódu není doklad zapnutí na cílových serverech. E-mailová notifikace schvalovateli není součástí garantovaného rozsahu této sady; přiřazení úkolů a jejich viditelnost se ověřují přímo v AKB.

## Pravidla pro integraci

1. AKB čte živá data STRATOS pouze přes verzovaný kontrakt, manifest a minimální service identity.
2. Každý zdroj si znovu ověří člověka, capability, scope a Information Policy.
3. Výsledek `partial`, `conflict`, `no_data`, `denied` nebo `unavailable` není zjednodušen na běžnou odpověď.
4. Chat zobrazí zdroj, rozsah a omezení výsledku; neprezentuje autorizovanou část jako úplný součet celé organizace.
5. Odvozené indexy AKB nejsou zdrojem změn pro Budget, ProjectFlow nebo ArchFlow.

## Vlastnictví katalogu

Za dokumentové funkce a chat odpovídá vlastník AKB. Za Budget, ProjectFlow, ArchFlow a společné funkce STRATOS odpovídá vlastník STRATOS. Rozsah a výsledky převzetí se zaznamenají pro konkrétní vydání a role podle [předávacího listu](../handover/akb-stratos-predani-dokumentace-cs.md).
