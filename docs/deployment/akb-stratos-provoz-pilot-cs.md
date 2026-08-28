---
type: runbook
document_type: procedure
title: "AKB a STRATOS: provoz a správa pilotu"
external_ref: DOC-AKB-STRATOS-PILOT-OPS
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, interni-pilot, provoz, sprava, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: provoz
document_revision: "1.3"
target_environment: customer-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-28"
---

# AKB a STRATOS: provoz a správa pilotu

> Navržené provozní povinnosti musí před převzetím přijmout konkrétní provozovatelé. Dokument nepotvrzuje, že už jsou zavedené.

## Provozní model

IT zákazníka provozuje infrastrukturu a společné platformní služby. AKB tým provozuje AKB a jeho dokumentové workflow. STRATOS tým provozuje STRATOS, Budget, ProjectFlow a ArchFlow. Každý tým odpovídá za vlastní release, databázové migrace a incidenty své aplikace.

Každé prostředí zákazníka má vlastní interní DNS, konfiguraci, databáze, objektový bucket, OIDC klienty, účty služeb, označení v monitoringu a zálohovací sadu. Údaje ani přístupové klíče se nesdílejí mezi testovacím a ostrým prostředím.

## Denní provozní kontrola

Správce ověřuje:

1. dostupnost interních URL a stav health/readiness obou aplikací;
2. kapacitu CPU, RAM, disku a růst object storage, databází a indexů;
3. stav uploadů, karantény, ClamAV, ingestion front a případných retry;
4. stav záloh, poslední úspěšnou obnovu a volné místo cíle záloh;
5. chyby OIDC, relací, přístupové projekce, service identity a Information Policy;
6. chybovost, p95 latenci a nedostupnost integrovaných zdrojů;
7. neobvyklé bezpečnostní události bez prohlížení obsahu dokumentů nebo chatů.

Provozní dashboard ukazuje agregované technické údaje. Obsah dokumentů, prompty, odpovědi, tokeny, cookie a secrets do něj nepatří.

## Provoz identity a relací

Evidujte zvolený režim identity, schválený issuer a vlastníka služby. Externí OIDC, například Keycloak, provozuje určený IAM tým. Ve volitelném režimu obsluhuje identity STRATOS a pouze on přistupuje k povoleným AD/LDAPS nebo OIDC zdrojům. AKB nikdy neřeší výpadek adresáře přímým připojením nebo převzetím hesla uživatele.

Centrální SSO po akceptaci cílového vydání používá jednu volbu zapamatování. Doložená relace má nejvýše 30 dní neaktivity a 90 dní od centrálního začátku; bez doložené dlouhodobé politiky pouze session cookie, nejvýše 8 hodin neaktivity a 24 hodin absolutně. Refresh tyto stropy neposouvá. Ověření identity musí při aktivitě proběhnout nejpozději po 15 minutách; projekce přístupů a Information Policy se nadále vyhodnocují u relevantních požadavků.

Dohled rozlišuje chybu issueru, podpisu či audience, odmítnutí přístupu, expiraci relace a nedostupnost zdrojového adresáře. Kontroluje také expiraci TLS certifikátů, dostupnost discovery, obnovu tokenů a neobvyklé přesměrovací smyčky. Změna issueru, mapperu, klienta nebo šifrovacího klíče vyžaduje samostatnou akceptaci a plán návratu. Servisní klienty při úpravě browser SSO neměňte.

## Správa AKB

U manuálu nebo provozního návodu gestor založí dokument a jeho verzi, doplní metadata, nechá provést sken a zpracování a dokončí dokumentové schválení a publikaci. Extrakce rozhodovacích pravidel ani založení právního balíčku nejsou podmínkou publikace běžného manuálu. Viz [metodika dokumentace](../how-to/akb-metodika-tvorba-dokumentace-aplikaci-cs.md).

U řízené směrnice s pravidly se navíc uplatní tento tok:

1. založí dokumentový balíček a připojí hlavní dokument i přílohy;
2. doplní vlastníka, klasifikaci, publikum, účinnost a oblast;
3. ověří vytěžená metadata, citace a případná pravidla;
4. schválí vydání v rozsahu své role;
5. vyhlásí vydání jako platné;
6. při nové verzi založí navazující vydání, předchozí verzi ponechá dohledatelnou pro historii.

U právních předpisů se standardně vrací znění účinné k rozhodnému dni. Při konfliktu stejného normativního významu má zákonný zdroj vyšší prioritu než interní pravidlo. Interní procesní povinnost se nesmí zaměnit za zákonný limit. Konflikt nebo neúplný důkaz nesmí vést k jednoznačnému automatickému rozhodnutí. Uplynutí termínu přezkumu je upozornění pro gestora, nikoli samo o sobě zrušení účinnosti dokumentu; použitelnost pravidla určuje jeho skutečný stav a kontrakt.

Správce AKB spravuje nastavení AKB, workflow a vazby dokumentů na schválené politiky. Centrální granty, rozsahy a recipient sets spravuje jejich vlastník v STRATOS; AKB je nesmí samo rozšiřovat. Správce není automaticky oprávněným čtenářem veškerého obsahu. Konfigurační změny jsou oddělené od běžné redakční práce a auditují se.

Při nasazení ověřte přehled vlastních dokumentů gestora a úkolů přiřazeného schvalovatele. Úkol má odkazovat na konkrétní verzi, obsah a přílohy, nikoli pouze na stav dokumentu. Nová verze nezdědí automaticky obsahové schválení předchozího vydání. Dostupnost e-mailových upozornění se potvrzuje samostatně; v tomto pilotním návrhu není garantována.

## Správa STRATOS

STRATOS správce řídí uživatele, capabilities, scopes, organizační rozsah a Information Policy přes vlastní Access Center v rámci společné správy. Správa organizační struktury, přístupů a identity je oddělena od odborných nastavení Budgetu, ProjectFlow a ArchFlow; dostupné části se odvozují od role. AKB tyto údaje načítá jen přes schválenou access projection a nikdy je nedoplňuje heuristikou.

Pro Director Copilot musí STRATOS spravovat aktuální manifesty a jejich bundle, audience, minimální route granty a read-only service identity. AKB při manifest driftu, chybné audience, nedostupnosti zdroje nebo neúplném stránkování odpověď uzavře a nezkouší nahrazovat živé informace dokumenty.

## Uživatelé a podpora

| Role | Běžná činnost | Co nevidí nebo nedělá |
| --- | --- | --- |
| Zaměstnanec | hledá, čte publikované podklady, používá chat a otevírá citace | koncepty, audit, upload, editace, schvalování a publikace |
| Externí spolupracovník | čte výslovně přidělenou dokumentaci a používá povolené části chatu | automatický přístup k zaměstnaneckým dokumentům nebo cizím aplikacím |
| Gestor | připravuje balíčky, ověřuje extrakci a pravidla, navrhuje vydání | globální policy a data mimo svěřenou oblast |
| Schvalovatel | schvaluje nebo vrací vydání a pravidla | technickou konfiguraci, pokud ji nemá zvlášť přidělenou |
| AKB administrátor | spravuje workflow, klasifikace, policy a auditní přístup | živý obsah STRATOS bez odpovídajících doménových grantů |
| Ředitel IT | používá chat nad povolenými dokumenty a živými daty | editace nebo schvalování bez samostatné capability |

První podpora řeší s uživatelem význam stavů: `nenalezen dostatečný zdroj`, `neúplný výsledek`, `konflikt`, `přístup není povolen` a `zdroj je dočasně nedostupný`. Technické correlation ID si vyžádá pouze při eskalaci na provozní tým.

## Aktualizace a release

Každá aplikace nasazuje jen stejný plný commit SHA, který prošel povinným CI, kontrolou image a release gate. Aktualizace AKB a STRATOS se plánují odděleně, ale integrační kontrakt se ověřuje společně před aktivací změny.

Před release se vytvoří záloha kanonických dat a ověří se očekávané dotčené služby. Po release se ověří aktivní SHA, health/readiness, přihlášení, autorizovaný dokumentový tok a pouze u relevantních změn také Director Copilot preflight. Přímý ruční build nebo improvizovaná změna konfigurace na produkční VM není akceptovaný release postup.

Rychlost nasazení se zlepšuje opětovným využitím ověřených závislostí, build cache a rozsahem dotčených služeb, nikoli vynecháním povinných kontrol. CI výpočet může běžet na schváleném lokálním stroji nebo dedikovaném runneru, pokud dodá stejné SHA, požadované důkazy a odpovídající neměnné obrazy. Konkrétní dobu nasazení doloží měření v cílovém prostředí.

## Incidenty a eskalace

| Příznak | První krok | Vlastník |
| --- | --- | --- |
| AKB nebo STRATOS není ready | ověřit závislou službu a correlation ID | příslušný aplikační tým |
| Upload čeká v karanténě | ověřit ClamAV, limit a frontu; dokument neuvolňovat | AKB tým a IT zákazníka |
| Chat nevrací živá data | ověřit manifest, projection, scope a source status | AKB tým; STRATOS tým při doménové příčině |
| Uživatel vidí nesprávná data | okamžitě omezit dotčený přístup, zachovat audit | vlastník aplikace a bezpečnost zákazníka |
| Selhala záloha nebo obnova | eskalovat jako provozní riziko, nečekat na incident | IT zákazníka a aplikační tým |

Při incidentu se nemažou dokumenty, indexy, volumes ani auditní záznamy. Postupuje se podle posledního ověřeného rollbacku nebo obnovy.

## Ověření a související podklady

Úspěšná kontrola má záznam s časem, prostředím, odpovědnou osobou a výsledkem; neobsahuje tajné hodnoty. Při chybě se použije výše uvedená eskalace, nikoliv označení služby za zdravou bez důkazu.

- [Instalace a převzetí](akb-stratos-instalace-prevzeti-pilotu-cs.md)
- [Bezpečnost a obnova](akb-stratos-bezpecnost-obnova-pilotu-cs.md)
