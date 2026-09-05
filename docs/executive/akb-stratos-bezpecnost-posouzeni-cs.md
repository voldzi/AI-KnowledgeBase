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
tags: [dokumentace, interni-pilot, bezpecnost, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: bezpecnost
document_revision: "1.3"
target_environment: customer-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-28"
---

# AKB a STRATOS: podklad pro bezpečnostní posouzení

## Rozhodnutí, která tento přehled podporuje

Dokument umožňuje vedení a bezpečnostní komunitě posoudit podmínky pilotu ve vnitřní síti. Je návrhem kontrol, nikoli bezpečnostní certifikací, protokolem penetračního testu ani potvrzením již zavedených opatření u zákazníka. Uvedené důkazy musí dodat a vyhodnotit vlastníci při převzetí.

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
| Identity a přístupy | schválený OIDC poskytovatel a STRATOS Access Center | krátkodobé serverové ověření | statický claim není náhradou aktuálního rozhodnutí |

## Společné přihlášení a hranice identity

Výchozí varianta používá schválený externí OIDC issuer, například Keycloak. Volitelná identity služba STRATOS obsluhuje více AD/LDAPS a OIDC zdrojů; její zapnutí je samostatná řízená změna. AKB pouze ověřuje OIDC a aktuální přístupovou projekci. Nemá LDAP konektor, nezná adresářové heslo a s jinými aplikacemi nesdílí databázi relací ani šifrovací klíč.

V cílovém společném SSO se zapamatování zařízení volí pouze centrálně. Trvání relace se odvozuje z ověřeného access tokenu, nikoli z formuláře AKB, neověřené hlavičky nebo nového okamžiku přechodu mezi aplikacemi:

| Politika | Neaktivita nejvýše | Absolutní platnost nejvýše | Cookie |
| --- | --- | --- | --- |
| Doložené zapamatování zařízení | 30 dní | 90 dní od neměnného začátku centrální relace | persistentní, nejdéle do stejného stropu |
| Bez doložené dlouhodobé politiky | 8 hodin | 24 hodin; doložený centrální začátek se zachová | dočasná, bez trvalé expirace v prohlížeči |

Aktivní požadavek vyžaduje serverové ověření identity nejpozději po 15 minutách. To nenahrazuje kontrolu capability, scope a Information Policy při každém relevantním přístupu. Obnova tokenu ani nové ověření hesla neposouvá absolutní konec relace. Neplatný podpis, issuer nebo audience se odmítne; nesmí vyvolat náhradní přihlášení s širšími právy. Tyto vlastnosti musí být doloženy společným testem cílového vydání, ne pouze existencí implementace.

Externí osoba nezískává automaticky dokumenty pro zaměstnance. Shodné přihlašovací jméno nebo e-mail v různých zdrojích identity nejsou důvodem ke sloučení účtů. Služební klient nezískává lidské role ani zaměstnanecký recipient set.

## Výpadkové chování

- Nedostupný scanner: dokument zůstává v karanténě nebo je upload odmítnut.
- Nedostupný dokumentový index či model: Chat neprezentuje neověřenou odpověď.
- Nedostupný STRATOS zdroj: Chat nevyužije dokumenty jako náhradu živých dat.
- Neúplné stránkování nebo změna source version: agregace se nevydá jako úplná.
- Nedostupná access projection nebo policy: není-li možné platně ověřit oprávnění, chráněný požadavek se odmítne; nesmí přejít na statický claim nebo širší scope.
- Výpadek poskytovatele přihlášení při odhlášení: lokální relace se ukončí i bez vzdálené revokace. Odhlášení jedné aplikace samo nedokládá okamžité odvolání všech ostatních aplikačních relací.

## Minimum před převzetím pilotu

1. Zkontrolovaná segmentace s výhradně interním přístupem.
2. Schválený model identity, správy skupin a rolí.
3. Doložený upload, scanner, dokumentové workflow a historická citace.
4. Doložené negativní autorizační a integrační testy.
5. Aktivní monitoring, alerty, zálohy a izolovaný restore test.
6. Záznam o release SHA, image identitě, konfiguraci bez secret hodnot a známých omezeních pilotu.
7. Ověření obou politik relace, změny uživatele, revokace, chybného callbacku, cizího Origin a přechodů mezi aplikacemi ve stejném profilu prohlížeče.

**Navazující podklady:** [Infrastruktura pilotu](../deployment/akb-stratos-instalace-infrastruktura-pilotu-cs.md), [obnova a kontinuita](../deployment/akb-stratos-bezpecnost-obnova-pilotu-cs.md), [předávací list a podmínky převzetí](../handover/akb-stratos-predani-dokumentace-cs.md).
