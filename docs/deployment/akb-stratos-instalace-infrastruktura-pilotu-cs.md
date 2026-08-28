---
type: system
document_type: project_documentation
title: "AKB a STRATOS: infrastruktura interního pilotu"
external_ref: DOC-AKB-STRATOS-PILOT-INFRA
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, interni-pilot, infrastruktura, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: instalace
document_revision: "1.3"
target_environment: customer-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-28"
---

# AKB a STRATOS: infrastruktura interního pilotu

> Návrh pro posouzení IT zákazníka. Uvedené kapacity se potvrdí podle rozsahu pilotu a měřením; nejde o naměřené minimum.

## Účel a hranice

Tento dokument stanovuje vstupní požadavky pro malé testovací nasazení AKB a STRATOS ve vnitřní síti zákazníka. Je určen společně pro IT zákazníka, správce AKB a správce STRATOS.

Pilot není veřejná služba. Uživatelé se připojují pouze z interní sítě zákazníka přes interní DNS a HTTPS. Internetový příjem dokumentů, veřejné API a veřejné administrátorské rozhraní nejsou součástí první etapy. Případný sběr oficiálních dokumentů z internetu se řeší až samostatným, schváleným odchozím přístupem přes proxy a s allowlistem zdrojů.

AKB je kanonický systém pro řízené dokumenty, jejich verze, přílohy, citace, pravidla a audit. STRATOS zůstává kanonickým systémem pro finance, projekty a architektonické potřeby. AKB Chat nad nimi pracuje jako jednotné uživatelské rozhraní, ale nesmí nahrazovat živá data STRATOS dokumentovým vyhledáváním.

## Doporučená výchozí topologie

```text
interní uživatelé zákazníka
        |
        | HTTPS (pouze interní DNS)
        v
interní reverse proxy
        +-- AKB web, chat a klientské API
        +-- STRATOS web a klientské API
        +-- schválený poskytovatel OIDC / centrální SSO

serverová komunikace (není publikována pro uživatele):
AKB     -> PostgreSQL, S3, Qdrant, OpenSearch, ClamAV
AKB     -> schválená AI / embedding služba
AKB     -> STRATOS access projection a doménové API
STRATOS -> vlastní PostgreSQL, Redis a další závislosti
STRATOS -> AD/LDAPS nebo OIDC zdroje (jen volitelný režim identity)
služby  -> centrální monitoring a zálohování
```

Databáze, objektové úložiště, vyhledávací indexy, ClamAV, Redis, interní API a telemetrie nesmějí být dostupné z uživatelské sítě ani z internetu. Reverse proxy je jediný publikovaný vstup pro uživatele; administrace probíhá jen ze správcovské sítě.

## Varianty pilotu

### A. Dokumentové funkce AKB bez živých doménových dat

Varianta pro správu dokumentů, hledání a citované odpovědi bez živých dotazů do Budgetu, ProjectFlow a ArchFlow. Vyžaduje AKB, OIDC, PostgreSQL, objektové úložiště, vyhledávací služby, scanner a schválenou embedding službu. Přístupová oprávnění a Information Policy poskytuje centrální správa přístupů STRATOS. Tato varianta tedy není plně samostatnou instalací bez STRATOS Access Governance; taková instalace není předmětem této sady.

### B. AKB a STRATOS integrovaně

Doporučená varianta pro test společného uživatelského prostředí. Přidává STRATOS API, Redis, manifesty Director Copilot V2 a read-only integraci Budget, ProjectFlow a ArchFlow. Jednotné přihlášení využívá společný schválený OIDC issuer; každá aplikace však drží vlastní serverovou relaci a vlastní autorizaci.

### Volba poskytovatele identity

Výchozí režim využívá organizací schválený externí OIDC, například Keycloak. Volitelný režim využívá identity službu STRATOS s více AD/LDAPS nebo OIDC zdroji a může fungovat bez Keycloaku. Není zapnut automaticky a vyžaduje společný instalační preflight a akceptaci. AKB se připojuje pouze přes HTTPS k OIDC a přístupovému API STRATOS, nikoli k LDAP. AKB může běžet na samostatném serveru; nepotřebuje společnou databázi ani Docker síť se STRATOS.

## Výchozí kapacitní návrh

Přesný výkon závisí na počtu dokumentů, jejich velikosti a zvoleném modelu. Pro první test doporučujeme oddělit aplikační a datovou vrstvu:

| Vrstva | Výchozí návrh k posouzení | Účel |
| --- | --- | --- |
| Aplikační VM | 12 vCPU, 32 GiB RAM, 200 GiB SSD | AKB a STRATOS weby, API a workery; bez lokálního velkého jazykového modelu |
| Datová a vyhledávací VM | 8 vCPU, 32 GiB RAM, 500 GiB SSD | PostgreSQL, Redis, Qdrant a OpenSearch, pokud je zákazník neposkytne jako sdílené služby |
| Objektové úložiště | samostatný S3-kompatibilní bucket | originální dokumenty, přílohy a jejich verze |
| AI výpočet | samostatně posoudit | embedding a LLM služba podle bezpečnostních a kapacitních pravidel zákazníka |
| Monitoring a zálohy | sdílená služba zákazníka nebo samostatná VM | metriky, trasy, redigované logy, alerty a zálohy |

Pokud zákazník poskytne PostgreSQL, S3, OIDC, monitoring a schválený AI endpoint jako centrální služby, mohou být aplikační VM menší. Naopak lokální LLM se nemá přidávat na stejnou VM jako databáze nebo vyhledávací indexy bez samostatného kapacitního testu.

Před přechodem z pilotu do ostrého provozu je nutné změřit skutečný objem dokumentů, denní přírůstek, souběžné uploady, počet aktivních uživatelů a p95 latenci chatu.

Výchozí tabulka není rozměrováním odvozeným ze zátěžového testu zákazníka. IT před objednáním kapacity potvrdí počet uživatelů, souběh, objem dokumentů, OCR a umístění modelu. Přijatelnou menší variantu je možné ověřit pilotním měřením; GPU není zahrnuto v uvedené RAM ani vCPU.

## Síťové a DNS požadavky

IT zákazníka připraví interní DNS jména a certifikáty pro AKB, STRATOS, zvolený OIDC issuer a podle zvoleného řešení pro monitoring a objektové úložiště. Certifikáty musí být důvěryhodné pro spravované prohlížeče a pro serverové klienty. OIDC URL musí být dostupná pro prohlížeč i pro aplikace přes schválené HTTPS; neznamená to zveřejnění do internetu.

| Směr | Port/protokol | Účel |
| --- | --- | --- |
| Uživatelská síť -> reverse proxy | 443/TCP | interní web AKB a STRATOS |
| Správcovská síť -> servery | 22/TCP | správa, pouze pro určené administrátory |
| Prohlížeč a aplikace -> schválený OIDC issuer | 443/TCP | centrální přihlášení, discovery a ověření identity |
| Identity služba STRATOS -> schválené AD/LDAPS zdroje | 636/TCP | pouze volitelný režim identity; AKB tento prostup nemá |
| Aplikace -> PostgreSQL | 5432/TCP | kanonická metadata a audit |
| STRATOS -> Redis | 6379/TCP | fronty a cache, pouze interně |
| AKB -> S3 | 443/TCP nebo interně schválené TLS | kanonické dokumenty a přílohy |
| AKB -> Qdrant/OpenSearch | 6333/TCP, 9200/TCP | interní odvozené indexy |
| AKB -> ClamAV | 3310/TCP | interní skenování dokumentů |
| AKB -> STRATOS API | interní HTTPS | access projection a povolené doménové dotazy mezi servery |
| AKB -> AI/embedding endpoint | schválený interní service port / HTTPS | embedding a generování podle profilu |
| Aplikace -> monitoring | 4317/4318/TCP, případně scrape přes management síť | telemetrie a metriky |

Konkrétní port se otevírá pouze tehdy, pokud příslušná služba není ve stejné privátní síti nebo na stejném hostiteli. Žádný z datových portů nemá být publikován přes reverse proxy ani do uživatelské VLAN.

## Identity a autorizace

- Zvolený OIDC issuer je explicitně schválený a ověřuje se přes discovery. Změna poskytovatele přihlášení není změnou oprávnění uživatelů.
- AKB a samostatný Chat mají vlastní OIDC klienty a přesné redirect/logout URI. V režimu identity služby STRATOS jde o veřejné browser klienty s Authorization Code + PKCE S256, bez client secretu; parametry externího issueru určuje schválená registrace.
- Prohlížeč nikdy neuchovává access ani refresh token. Aplikace používají serverovou neprůhlednou relaci v cookie `HttpOnly`, `Secure` a `SameSite=Lax`.
- AKB a Chat mají oddělené šifrovací klíče pro serverové tokeny, předané chráněným mechanismem mimo Git a Compose. Cookie mají omezenou cestu a nesdílejí atribut `Domain` mezi aplikacemi.
- V cílovém společném SSO platí ověřená centrální politika relace: nejvýše 30 dní neaktivity a 90 dní od jejího začátku; bez doložené dlouhodobé politiky pouze dočasná cookie, nejvýše 8 hodin neaktivity a 24 hodin. Identita se při aktivitě znovu ověřuje nejpozději po 15 minutách.
- AKB při každém relevantním požadavku vyhodnocuje aktuální capabilities, scopes a Information Policy. STRATOS access projection není nahrazena statickým OIDC claimem.
- Publikované interní směrnice určené všem zaměstnancům jsou dostupné běžným zaměstnancům; upload, editace, schválení, publikace, export a audit jsou samostatná, výslovně přidělená oprávnění.
- Externí osoba dostává pouze výslovně schválené dokumenty a role; zaměstnanecké dokumenty nezískává automaticky. Identity různých zdrojů se neslučují podle e-mailu nebo shodného loginu.
- Služební identity mají samostatné klienty, minimální role, přesnou audience a pouze route-bound oprávnění. Nikdy nepoužívají uživatelské role.

## Dokumenty, vyhledávání a AI

- Originální soubory jsou v objektovém úložišti; PostgreSQL obsahuje jejich identitu, verze, platnost a audit. Qdrant a OpenSearch jsou odvozené indexy a lze je obnovit z kanonických zdrojů.
- Upload vstupuje do karantény. Dokument je zpřístupněn až po výsledku `OK` z interního ClamAV. Výpadek, timeout nebo nález je fail-closed.
- Každý dokument dostane vlastníka, klasifikaci, publikum, časovou účinnost a zdrojovou verzi. Citace musí ukazovat na konkrétní verzi a úsek dokumentu.
- Modelová a embedding služba se připojuje jen přes organizací schválený endpoint. Dokumenty, prompty, odpovědi, tokeny a citace se neposílají do telemetrie ani běžných aplikačních logů.

## Zálohy, obnova a monitoring

Zálohovat se musí PostgreSQL, objektový bucket, infrastruktura a konfigurační metadata indexů. Stav identity závisí na zvoleném režimu: externí OIDC službu včetně případné databáze Keycloaku obnovuje její správce; identity služba STRATOS potřebuje zálohu své konfigurace, vazeb identit a podpisových klíčů a dostupné zdrojové adresáře. Šifrovací klíče mají oddělenou zabezpečenou obnovu, nejsou součástí této dokumentace. Qdrant snapshoty urychlují obnovu; při jejich absenci se index musí sestavit z kanonických zdrojů. OpenSearch lze logicky reindexovat; podporovaný snapshot/restore vyžaduje shodu verzí a vlastní ověřený postup. Datové adresáře se nekopírují mezi verzemi.

Databáze a objekty se obnovují ke společnému konzistentnímu bodu. Samotná existence jednotlivých záloh bez ověření vazeb dokument-verze-objekt není důkazem obnovitelnosti.

| Frekvence | Minimální činnost |
| --- | --- |
| Denně | PostgreSQL dump, kopie objektů, Qdrant snapshot |
| Týdně | kontrola úplnosti a kopie mimo provozní host |
| Měsíčně | izolovaný test obnovy včetně evidence výsledku |

Uvedené intervaly jsou návrhem provozní politiky, nikoliv tvrzením, že jsou u zákazníka již zavedeny.

Centrální dohled sleduje alespoň health/readiness, p95 latenci chatu a ingestion, chyby autorizace, stav front, volné místo, zálohy, stav indexů a nedostupnost externích závislostí. Logy musí být redigované.

## Rozdělení odpovědností

| Oblast | IT zákazníka | AKB tým | STRATOS tým |
| --- | --- | --- | --- |
| VM, VLAN, DNS, TLS, firewall, zálohovací úložiště | poskytuje a provozuje | specifikuje požadavky | specifikuje požadavky |
| AKB runtime, Registry, ingestion, RAG a řízená dokumentace | poskytuje provozní přístup | nasazuje a ověřuje | integruje pouze přes kontrakty |
| STRATOS runtime, Budget, ProjectFlow a ArchFlow | poskytuje provozní přístup | čte jen schválené integrační rozhraní | nasazuje a ověřuje |
| OIDC, zdroje identity, uživatelé a skupiny | IAM provozuje nebo schválí issuer a zdrojové adresáře | nastavuje pouze AKB/Chat klienty a vazby policy | spravuje vlastní klienty, projekci a volitelnou identity službu |
| S3 bucket a scanner | poskytuje nebo schválí službu | nastavuje AKB backend a fail-closed scan | používá jen vlastní schválené datové cesty |
| Akceptace a incidenty | účastní se | odpovídá za AKB | odpovídá za STRATOS |

## Vstupy potřebné před instalací

1. Interní DNS jména, certifikační autorita a rozhodnutí o reverse proxy.
2. Volba poskytovaných sdílených služeb: PostgreSQL, S3, OIDC, monitoring, ClamAV, AI/embedding endpoint a zálohy; u identity služby STRATOS také schválené zdroje identity a jejich TLS důvěra.
3. Oddělené technické identity a tajné údaje předané mimo Git.
4. Potvrzená síťová pravidla z této dokumentace a správcovská skupina.
5. Pilotní skupina uživatelů, jejich role a zásady klasifikace dokumentů.
6. Rozhodnutí, zda se v první etapě zapnou živé doménové dotazy Director Copilot V2. Závislosti autorizace se posuzují samostatně, i pokud je Copilot vypnutý.

## Akceptační kritéria pilotu

Pilot lze převzít, pokud je splněno vše následující:

- žádná uživatelská ani datová služba není dostupná z internetu;
- AKB a STRATOS vracejí health i readiness a běží z neměnných obrazů;
- oprávněný uživatel se přihlásí a získá povolený rozsah; nepovolený uživatel nezíská přístup k aplikaci nebo chráněným datům;
- centrální SSO, obě politiky relace a odhlášení byly ověřeny ve stejném prohlížeči; volitelný issuer ani mapper se neaktivují bez společné akceptace;
- dokument nelze zveřejnit bez bezpečného skenu a řádného schválení;
- citace, verze, přílohy a historický dotaz vedou ke správnému zdroji;
- záloha i izolovaná obnova byly doloženy;
- monitoring a redigovaný audit jsou funkční;
- při výpadku databáze, indexu, modelu, registru nebo STRATOS zdroje systém nevydá domyšlené údaje ani méně důvěryhodnou náhradu.

Podrobný postup instalace, ověření a rollbacku je v [instalačním postupu pilotu](akb-stratos-instalace-prevzeti-pilotu-cs.md).
