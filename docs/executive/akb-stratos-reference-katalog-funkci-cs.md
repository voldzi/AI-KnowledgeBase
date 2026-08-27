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
tags: [dokumentace, csu-pilot, katalog-funkci, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: reference
document_revision: "1.0"
target_environment: csu-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-27"
---

# AKB a STRATOS: katalog funkcí a datových autorit

## Jak katalog číst

Katalog rozlišuje autoritativní zdroj od uživatelského rozhraní. **Podklady** znamená funkci popsanou v dostupné dokumentaci či implementaci, nikoli akceptační PASS v ČSÚ. **Integrace** navíc vyžaduje funkční rozhraní a společný test. **Rozvoj** není závazek pro pilot. Každý provozní scénář se před předáním ověří pro konkrétní release a uživatelský profil.

| Oblast | Schopnost | Autoritativní zdroj | Primární uživatelé | Stav |
| --- | --- | --- | --- | --- |
| AKB | registr dokumentů, verzí, příloh a účinnosti | Registry + objektové úložiště | čtenář, gestor | Podklady |
| AKB | karanténa a antivirová kontrola | ingestion + ClamAV | gestor, správce | Podklady |
| AKB | vytěžení, indexace a citace | ingestion, Qdrant, OpenSearch | oprávnění čtenáři | Podklady |
| AKB | náhled podle podporovaného formátu | viewer a originální objekt | oprávnění čtenáři | Podklady |
| AKB | schválení, publikace, přílohy a historie | Registry | gestor, schvalovatel | Podklady |
| AKB | Controlled Rules nad zákony a směrnicemi | schválené balíčky v Registry | Chat, Budget | Integrace |
| AKB | chat nad dokumenty a postupy | RAG + citace | zaměstnanec, vedení | Podklady |
| AKB | analytický workbench a evidenční případy | AKB Intelligence | analytik, auditor | Podklady |
| AKB | obecné AI insighty s dalším schvalováním | budoucí workflow | gestor | Rozvoj |
| Budget & Contract | rozpočtový plán, akce, smlouvy, skutečnost | Budget & Contract | finance, vedení | Podklady |
| Budget & Contract | finanční dotazy v Chatu | Director Copilot | oprávnění uživatelé | Integrace |
| ProjectFlow | projektový plán, rizika, rozhodnutí a stav | ProjectFlow | projektový tým | Podklady |
| ProjectFlow | read-only portfolio v Chatu | Director Copilot | oprávnění uživatelé | Integrace |
| ArchFlow | potřeby, posouzení a převod do plánování | ArchFlow | pověřené role | Podklady |
| ArchFlow | read-only potřeby v Chatu | Director Copilot | oprávnění uživatelé | Integrace |
| Executive Center | manažerské přehledy | STRATOS read-modely | vedení | Podklady |
| STRATOS Access Center | capabilities, scope a projekce přístupů | STRATOS | správce přístupů | Integrace |
| Společné | OIDC a serverové relace | Keycloak + aplikace | všichni uživatelé | Integrace |
| Společné | audit a bezpečné odmítnutí | auditní hranice AKB a STRATOS | auditor, podpora | Integrace |

Náhled není zárukou totožného vzhledu všech formátů. Office využívá odvozené PDF; u Markdownu současná aplikace zobrazuje obsah a umožňuje stažení zdroje, ale negeneruje PDF celého dokumentu. PDF předávací sady je samostatně vytvořený odvozený výstup.

## Retired a neaktivní oblasti

AIIP a ProcessForge nejsou aktivní samostatné aplikace. Processní rytmus je realizován v ProjectFlow; intake potřeb realizuje ArchFlow. Tyto názvy se nemají uvádět v uživatelské navigaci ani v nabídce nového pilotu.

## Pravidla pro integraci

1. AKB čte živá data STRATOS pouze přes verzovaný kontrakt, manifest a minimální service identity.
2. Každý zdroj si znovu ověří člověka, capability, scope a Information Policy.
3. Výsledek `partial`, `conflict`, `no_data`, `denied` nebo `unavailable` není zjednodušen na běžnou odpověď.
4. Chat zobrazí zdroj, rozsah a omezení výsledku; neprezentuje autorizovanou část jako úplný součet celé organizace.
5. Odvozené indexy AKB nejsou zdrojem změn pro Budget, ProjectFlow nebo ArchFlow.

## Vlastnictví katalogu

AKB tým aktualizuje řádky AKB a společné chatové hranice. STRATOS tým potvrzuje řádky svých aplikací. Označení „ověřeno“ lze doplnit teprve s datem, releasem, profilem uživatele a výsledkem konkrétního testu. Otevřené body a zdroje obsahuje [předávací list](../handover/akb-stratos-predani-dokumentace-csu-cs.md).
