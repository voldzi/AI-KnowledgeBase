---
type: runbook
document_type: procedure
title: "AKB a STRATOS: bezpečnost a obnova pilotu ČSÚ"
external_ref: DOC-AKB-STRATOS-PILOT-DR
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, csu-pilot, bezpecnost, obnova, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: bezpecnost
document_revision: "1.2"
target_environment: csu-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-27"
---

# AKB a STRATOS: bezpečnost a obnova pilotu ČSÚ

> RTO/RPO jsou navržené cíle, nikoliv ověřené SLA. Tento postup není oprávněním provádět destruktivní obnovu na běžícím prostředí.

## Bezpečnostní minimum

- Pilot je dostupný pouze v interní síti ČSÚ přes HTTPS a interní DNS.
- Secrety, service credentials, databázová hesla, OIDC client secrets a šifrovací klíče jsou v chráněném secret mechanismu, ne v Git, Compose, image ani logu.
- Upload dokumentů je kontrolován přes interní ClamAV a při chybě skeneru selže uzavřeně.
- Citace, chat, export, dokumentové čtení, upload, schvalování a audit jsou autorizovány odděleně.
- Telemetrie a audit obsahují jen technická metadata, anonymizované correlation ID a bezpečné statusy. Neobsahují dokumentový obsah, prompty, odpovědi, tokeny, hodnoty cookie ani secrets.
- Neznámý manifest, špatná audience, manipulovaný cursor, neúplné stránkování nebo výpadek zdroje nikdy nesmí být nahrazen domyšleným výsledkem.

## RTO a RPO pilotu

**RPO** je nejvyšší přijatelná ztráta dat vyjádřená časem od poslední použitelné zálohy. **RTO** je cílová doba obnovení služby. Oba cíle schvaluje provozovatel a ověřuje je testem obnovy.

Pro první testovací etapu stanovte před zahájením provozu minimálně:

| Parametr | Návrh pro pilot | Poznámka |
| --- | --- | --- |
| RPO | 24 hodin | denní záloha kanonických dat; častější záloha při intenzivní redakci |
| RTO | 8 pracovních hodin | od vyhlášení výpadku do ověřené dostupnosti; provozní hodiny a eskalace se musí předem dohodnout |
| Obnova indexů | samostatně měřit | Qdrant obnovit snapshotem, OpenSearch logicky reindexovat |

Před ostrým provozem se RPO/RTO upraví podle skutečné důležitosti a objemu dat.

## Postup obnovy

1. Vyhlaste incident, zastavte změny a uchovejte auditní a provozní evidence.
2. Určete rozsah: aplikace, databáze, bucket, index, identita nebo integrace.
3. Zvolte společný konzistentní bod obnovy. Obnovte PostgreSQL a odpovídající objekty. Externí OIDC službu včetně případné databáze Keycloaku obnoví její správce; u identity služby STRATOS obnovte konfiguraci, vazby identit a odděleně chráněné klíče a ověřte zdrojové adresáře. Ověřte vazby přesných verzí dokumentů na objekty dříve, než povolíte zápis nebo přístup uživatelů.
4. Obnovte Qdrant snapshot nebo index znovu sestavte z kanonických dokumentů.
5. OpenSearch obnovte logickým reindexem nebo vlastním ověřeným snapshot/restore postupem pro shodnou podporovanou verzi. Nekopírujte jeho datový adresář mezi verzemi.
6. Aktivujte ověřený immutable release a obnovte jen schválenou konfiguraci.
7. Ověřte health/readiness, autorizaci, dokumentový upload, citaci, audit a zálohy.
8. Zapište dobu, rozsah, použitý backup, případnou ztrátu dat a nápravná opatření.

Obnova se pravidelně testuje v izolovaném prostředí. Nikdy se nezkouší poprvé během ostrého incidentu.

### Relace a oprávnění po obnově

Obnova databáze nesmí oživit odvolanou nebo expirovanou relaci, znovu přidělit odebraný grant ani prodloužit centrální časový strop. Pokud nelze doložit zachování revokací, před otevřením provozu zneplatněte obnovené aplikační relace schváleným postupem a vyžádejte nové přihlášení. Ověřte aktuální identity, členství a přístupovou projekci ze zdrojových služeb.

AKB a Chat mají oddělené šifrovací klíče. Relace, jejichž tokeny po obnově nebo rotaci nelze dešifrovat, musí zůstat neplatné; nepoužívá se náhradní nezabezpečené uložení. SSO test zahrne 30denní neaktivitu a 90denní absolutní strop zapamatované relace, 8hodinovou neaktivitu a 24hodinový strop krátké relace a nové ověření identity nejpozději po 15 minutách aktivity.

## Povinné bezpečnostní testy před převzetím

1. odebrání uživatele, role, capability nebo scope okamžitě nebo při nejbližším ověření zablokuje přístup;
2. neplatná service identity, audience nebo route grant je odmítnut;
3. koncept, neúčinný dokument, zakázaná klasifikace a cizí recipient set nejsou čitelné;
4. nedostupný scanner, databáze, S3, index, model, registry nebo STRATOS zdroj vede k bezpečnému stavu;
5. záloha se obnoví do izolovaného prostředí a je dohledatelná včetně dokumentových objektů a auditních metadat;
6. uživatelské, datové a správcovské síťové cesty odpovídají schválené segmentaci.
7. shodné login nebo e-mail v různých zdrojích nesloučí identity; externista ani služba nezískají automaticky zaměstnanecké dokumenty;
8. lokální logout funguje i při výpadku issueru, neplatný callback nevytvoří relaci a odvolaná relace se neobnoví refreshem ani návratem ze zálohy.

## Když obnova neprojde

Prostředí ponechte izolované, neotevírejte neúplná data uživatelům a eskalujte vlastníkovi aplikace a záloh. Zachovejte původní data i důkazy a zvolte jiný ověřený bod obnovy. Záloha nebo rollback aplikace samy o sobě nevracejí nevratnou databázovou migraci.

## Související podklady

[Provoz a správa](akb-stratos-provoz-pilot-csu-cs.md) a [instalace a převzetí](akb-stratos-instalace-prevzeti-pilotu-csu-cs.md).
