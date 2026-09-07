# Předání AKB → STRATOS: příjem ProjectFlow a ArchFlow

Stav k 6. 9. 2026: rozhraní a zpracování jsou implementovány v AKB. STRATOS musí doplnit zdrojové adaptéry a níže popsanou autoritu. Úspěšné jednotkové testy s testovací autoritou nejsou společnou akceptací. Příjem v integračním prostředí zůstává uzavřený do jejího dokončení.

## Závazné soubory

- Veřejné rozhraní AKB: `contracts/stratos/source-document-intake/openapi.json`.
- Požadované rozhraní autority STRATOS: `contracts/stratos/source-document-intake/stratos-authority.openapi.json`. Jde o požadavek k implementaci na STRATOS, nikoli tvrzení o existujícím endpointu.
- Celkový kontrakt AKB: `openapi/openapi.json`.
- Příklady: `contracts/stratos/source-document-intake/examples/`.
- Rozhodnutí: `docs/adr/0024-source-document-intake.md`.

Všechny cesty jsou relativní ke kořeni AKB. STRATOS má převzít tyto aktuální soubory, zaznamenat jejich SHA-256 a aktualizovat svůj contract pin. Starý hash OpenAPI z předání Budgetu už není aktuální. Generátory: `.venv/bin/python scripts/generate_source_intake_contract.py --check` a `ruby scripts/generate_openapi_index.rb --check`.

## Požadavek pro STRATOS

Implementujte skutečné nahrávání příloh z ProjectFlow a ArchFlow přes společný příjem AKB. Prostředí je prázdné: nezachovávejte starý upload, obecný zápis odkazu ani převod na smlouvu Budgetu jako náhradní cestu. Nevytvářejte výjimku bez TLP.

Přesný transportní postup, ve společném lokálním prostředí s base URL `http://localhost:3220/akb` pro hostitelského klienta a `http://web:3000/akb` mezi kontejnery:

1. Backend zdrojové aplikace zavolá `POST /api/stratos/source-upload/preflight` s typovaným `document`, přesnými údaji `file`, `source_revision`, `version_label`, `version_profile`, `actor_subject_id` a `correlation_id`.
2. Použije vrácenou `upload_url`, metodu `PUT` a všechny `required_headers`. Jde o existující jediný binární endpoint `/api/document-intake/v1/sessions/{sessionId}/content`. Přidá servisní a uživatelskou autorizaci; soubor neposílá na jinou cestu. Vrácená cesta už obsahuje `/akb`; tento prefix nepřidávejte podruhé. Relativní upload cestu vyhodnoťte vůči nakonfigurovanému důvěryhodnému AKB originu.
3. Po úspěšném skenu zavolá `POST /api/stratos/source-upload/sessions/{sessionId}/confirm`. Tělo obsahuje pouze původní `upload_token` a vrácený `upload_receipt`. URI, hash, metadata a předchůdce jsou vázány podpisem; klient je nepřepisuje.
4. Stav sleduje přes `POST /api/stratos/source-upload/documents/{documentId}/status` s `actor_subject_id` a `correlation_id`. Stav obsahuje přesnou verzi a její aktuální pokus o zpracování. Starý pokus se nevydává za zpracování nové verze.

Každý požadavek jde server–server: `Authorization: Bearer <source-service-token>` a oddělený `X-STRATOS-Actor-Authorization: Bearer <current-person-token>`. Servisní tajemství, upload tokeny a receipts nepatří do prohlížeče ani logů. Source backend obslouží běžnou uživatelskou relaci a předá její skutečný aktuální bearer. Samostatný Chat tyto upload endpointy nevystavuje.

Při přerušení nebo ztracené odpovědi uchovejte původní token a receipt v chráněném backendovém stavu a zopakujte stejné potvrzení. Nevytvářejte automaticky jinou revizi. Pro stejnou zdrojovou revizi nelze vyměnit obsah, autora uploadu, příjmový receipt ani metadata. Po expiraci tokenu nebo konfliktu vraťte uživateli srozumitelný stav a znovu načtěte stav dokumentu; nezakládejte duplicitní revize jako obcházení konfliktu.

`source_revision` je neměnná revize konkrétní přílohy, nikoli proměnlivý název, čas přenosu nebo číslo pokusu. Změna obsahu vyžaduje novou zdrojovou revizi. `source_document_id` je stabilní identita přílohy napříč revizemi. Hash souboru musí odpovídat skutečně odesílaným bajtům.

Běžný upload v AKB odmítne tyto dokumenty před přijetím souboru (`SOURCE_INTAKE_REQUIRED`). Metadata nelze použít k přejmenování zdroje na AKB ani k přesunu pod jiný zdrojový záznam či autoritu (`409 source_provenance_immutable`).

## Identity a oprávnění

| Zdroj | Přesný servisní klient | Audience / role | Jediný Registry route grant |
|---|---|---|---|
| ProjectFlow | `stratos-projectflow-akb-service` | `akl-api` / `service_ingestion` | `stratos-source-intake` |
| ArchFlow | `stratos-archflow-akb-service` | `akl-api` / `service_ingestion` | `stratos-source-intake` |

Nepřidělovat těmto službám obecné `documents-write`, `external-documents-write` ani uživatelská oprávnění. Budget klient `stratos-akb-service` nesmí vstupovat do nového příjmu a nové identity nesmějí do Budget uploadu. Klientské přihlašovací údaje musí zůstat v konfiguraci backendů.

AKB v rámci společné akceptace doplní tyto přesné identity do společného IdP, allowlistu a route grants. Nepřepisujte společné identity, klíče ani volumes z prostředí `stratos-local`. Pro pozitivní testy potřebujeme skutečné pisatele, vlastníky a gestory s aktuálními oprávněními ve zdroji i AKB; dosavadní SSO reader účty nestačí.

## Souřadnice zdroje

| Zdrojový záznam | `entity_type` | Kanonický `external_ref` | Rozsah |
|---|---|---|---|
| Projekt | `project` | `project:{projectId}:document:{sourceDocumentId}` | `project`, přesný projectId |
| Úkol | `task` | `project:{projectId}:task:{taskId}:document:{sourceDocumentId}` | `project`, přesný projectId |
| Projektový report | `status_report` | `project:{projectId}:status-report:{reportId}:document:{sourceDocumentId}` | `project`, přesný projectId |
| Potřeba ArchFlow | `need` | `archflow-need:{needId}:document:{sourceDocumentId}` | autoritativní `organization/org_stratos` nebo `own/ownerSubjectId` |

`entity_id`, provenience `sourceRecordId` a `parent_governed_resource_id` musejí patřit témuž skutečnému záznamu. Úkol/report musí skutečně patřit danému projektu. U podnětů potvrďte jejich doménové mapování: pokud jsou v ArchFlow samostatným typem mimo `need`, vraťte přesný typ, identitu a autorizační pravidla pro doplnění kontraktu; nepřejmenovávat jinou entitu na `need`.

Audience dokumentu a zdrojový rozsah jsou oddělené. Povolena je autoritativní organizace, explicitní `recipient_set`, nebo u ProjectFlow přesný projekt. TLP:RED vyžaduje explicitní příjemce a původce. Zdrojová autorita musí ověřit skutečnou efektivní politiku, ne pouze formální shodu polí.

## Nová autorita STRATOS

Implementujte `POST /api/v1/information-governance/source-document-intake/authorize` podle samostatného OpenAPI. AKB ji volá svou existující pevnou identitou `service:akb`, nikoli přístupovým tokenem zdrojové služby. Aktuální person bearer je samostatně v `X-STRATOS-Actor-Authorization`. Parametr AKB `AKL_STRATOS_SOURCE_INTAKE_AUTHORITY_URL` je zatím prázdný; bez něj je výsledek 503 a příjem se neotevře.

Pro každé `stage=prepare/upload/confirm` musí autorita znovu ověřit:

- Aktivní uživatelskou relaci, členství, oprávnění v příslušné aplikaci a právo přiložit tuto verzi konkrétnímu záznamu. Hodnota subjectu v JSON není důkaz identity.
- Přesný servisní klient/subject určený aplikaci, organizaci, skutečnou existenci a aktivitu zdroje, rodiče a přílohy; u ProjectFlow také vazbu na projekt.
- Neměnnou revizi přílohy, aktuální hash/velikost/typ souboru a to, že ji zdroj skutečně připravil pro příjem. Nebude stačit vytvořit libovolný JSON se známým ID projektu.
- Aktuální efektivní policy binding/hash, povinné TLP, příjemce, původce a omezení zpracování. Bez nahrazení TLP výchozí hodnotou.
- Ověřitelnou provenienci, autora/evidenci autorství, aktivního vlastníka a gestora, schvalovatele tam, kde jej profil vyžaduje, a úplné údaje zvoleného dokumentového profilu včetně pravidel platnosti/revize/uchování.

Přepočítejte `request_hash`: `sha256:` nad UTF-8 JSON všech členů žádosti kromě `request_hash`, s rekurzivně seřazenými klíči a bez mezer. Pole zachovávají pořadí. Vracejte přesné `nonce` a `request_hash`, `allowed=true`, verzi schématu a `expires_at` nejvýše 60 sekund dopředu. Bez cache rozhodnutí a bez pouhého vrácení vstupu bez ověření. Odmítnutí 403, nedostupná autorita 503; nepovažovat chybu za povolení.

Současně doplňte existující atomické document admission/revalidation pro oba zdrojové profily. Registrace kořene a verze v AKB nadále používá běžný `information-resources/akb` kontrakt s `documentAdmission`; zde se používá `document_version`, nikoli Budget `document-version`. Při každém pozdějším ověření pro čtení, zpracování, export a Chat ověřte také aktuální zdroj a jeho ochranu. Explicitní binding AKB nesmí umožnit obejít změněnou politiku nebo zneplatněný zdrojový záznam. Nová source-authority operace nenahrazuje existující nonce-bound admission/profile protokol.

## Životní cyklus a testy

Nově přijatá verze má stav `draft`. Úspěšný upload ani dokončená indexace neznamenají schválení, publikaci, právní účinnost nebo povolení pro Chat. Zdrojové UI má tento rozdíl srozumitelně ukázat a odkázat na `canonical_open_url` pro kontrolu a schválení v AKB. Nevyplňovat neznámou platnost datem uploadu; použít pravdivý profil a jeho povinnou evidenci.

Dodat implementační commit a report. Ve společném `akb-stratos-test` následně ověříme všechny zdroje včetně Budgetu: jediné přihlášení, pozitivní příjem, zamítnutí bez TLP/autora/vlastníka/gestora, cizí projekt/recipient, odebrání oprávnění mezi kroky, ztracenou odpověď a replay, novou revizi a konflikt, ClamAV a nedostupnost autority, zpracování a schválení, odpověď Chatu s přesnou citací a odebrání přístupu po indexaci.

Do té doby ponechat `BUDGET_AKB_DOCUMENT_INTAKE_ENABLED=false`, nepovolovat nové zdrojové adaptéry a neoznačovat readiness jako splněnou. Žádné produkční nasazení, fallback upload nebo výjimka bez TLP.
