# AKB source intake: implementace a místní ověření, 6. 9. 2026

AKB implementovalo příjem ProjectFlow/ArchFlow a běží s ním ve společném Docker projektu `akb-stratos-test`. Přesné rozhraní a pokyn jsou v [předání STRATOS](../integration/STRATOS_SOURCE_DOCUMENT_INTAKE_V1.md). Pozitivní průchod přes skutečné nové adaptéry a autoritu STRATOS ještě ověřen není; neoznačujeme integraci za otevřenou.

## Implementace

- Preflight s přesným zdrojem, profilem dokumentu, TLP, vlastníkem, gestorem a evidencí verze; oddělené servisní a aktuální person credentials.
- Povinná čerstvá nonce/hash-bound autorita STRATOS před přípravou, přijetím bajtů a potvrzením. Prázdná konfigurace či nedostupná autorita příjem uzavře.
- Běžný AKB upload odmítá zdrojové dokumenty ještě před čtením souboru. Úprava metadat nemůže odstranit ani přesměrovat jejich zdrojový původ; cílené testy ověřují systém, záznam i rodičovský zdroj.
- Společný binární endpoint a ClamAV; žádný fallback do Budgetu ani obecného externího zápisu.
- Společná evidence kořene/verze, podepsaný intake receipt, původní příloha a revize, ochrana před záměnou, opakováním s odlišným obsahem a návratem ke starší aktuální verzi. Zdrojová revize používá existující databázovou unikátní intake identitu; není nutná nová migrace.
- Status konkrétní verze a jejího zpracování s aktuálním ověřením čtení. Úspěšné potvrzení spustí zpracování, verze zůstává `draft` pro běžný proces kontroly/schválení.
- Strojové kontrakty, příklady s odpovídajícím textovým souborem a ADR 0024. Obecné fixture testy používají STRATOS_PLATFORM; samostatné testy dokazují, že generic write nemůže obejít nové source rozhraní.

## Ověření

| Kontrola | Výsledek |
|---|---|
| Web typecheck | Prošel |
| Web testy | 1001 prošlo, 0 vynecháno |
| Registry testy | 713 prošlo, 2 vynechány: destruktivní migrační PostgreSQL fixture a souběžný native replay vyžadují samostatný explicitní testovací databázový endpoint |
| Nové cílené Registry/source/OpenAPI testy | 35 prošlo: všechny čtyři zdrojové tvary, replay, změna obsahu, odebrání oprávnění, token separation, neplatná autorita, generic bypass, shoda runtime a kontraktu |
| OpenAPI/generátor source kontraktu, skeleton, diff whitespace | Prošlo |
| Přesné Docker obrazy web, chat-web, registry-api | Sestaveny a spuštěny, identity v příloze |
| Běžící prostředí | 21 služeb běží, služby s healthcheckem jsou zdravé |
| Anonymní source prepare/confirm/status | 401 |
| Skutečný Budget OIDC service → ProjectFlow source endpoint | 403 `SOURCE_SYSTEM_NOT_ALLOWED` |
| ClamAV clean/EICAR | Čistý vzorek povolen, standardní testovací signatura zachycena |
| Budget → ProjectFlow → ArchFlow → AKB → Budget | Prošlo, jediné zadání přihlašovacích údajů |
| STRATOS → Chat, pět nových karet, AKB ↔ Chat | Prošlo |
| Uživatel bez ProjectFlow grantu | Pracovní prostředí odmítnuto, bootstrap 403 |
| Počty společných dokumentů/verzí | 0 / 0 |
| Příjmová readiness | STRATOS 503 `DOCUMENT_ADMISSION_CATALOG_NOT_READY`, AKB 503 `document_profile_admission_unavailable` |

Registry ověření nezahrnovalo dvě samostatné integrační sady pro destruktivní cleanup/MinIO, které tato změna nemění. Skipped PostgreSQL případy ani tyto sady nejsou uváděny jako prošlé. Pozitivní source testy ověřují skutečné HTTP/SQL/profile/receipt implementace s výslovnou testovací odpovědí upstream autority. Nejsou důkazem připraveného skutečného STRATOS source adapteru.

## Nálezy v místním prostředí a opravy

První požadavek po startu předběhl připravenost Next.js; source smoke nyní před kontrolami vyčká na zdraví aplikace. Nový Playwright runtime neměl odpovídající stažený Chromium build; navigace byla ověřena izolovaným headless profilem již instalovaného Google Chrome, se stejným lokálním CA/SPKI omezením. Uživatelský browser profil nebyl použit.

Budget service token postrádal `service_ingestion`, proto první odmítnutí mělo kód `AUTH_ROLE_REQUIRED`. Do existujícího lokálního servisního účtu byla přes Keycloak doplněna tato role a `roles` client scope. Token nyní roli skutečně obsahuje; následný test prokázal přesné odmítnutí cizího zdroje. Generátor místního prostředí je opravený, credentials nebyly rotovány a obecné Registry write grants nebyly přidány.

Docker VM má přibližně 8 GB RAM. Při souběžném sestavování obrazů došlo k OOM a zániku ClamAV daemonu; kontejner s patnácti tolerovanými neúspěšnými healthchecky ještě hlásil healthy. Skener byl znovu spuštěn se zachováním signatur a skutečný INSTREAM clean/EICAR test poté prošel. Lokální healthcheck nově toleruje jen tři neúspěšné kontroly po startovací lhůtě. Nový příkaz `scripts/local_acceptance.py build <služby>` sestavuje vyjmenované obrazy postupně, aby omezil paměťovou špičku. Žádné oslabení skenování ani zásah do globálního nastavení Docker Desktopu.

## Omezení a navazující práce

STRATOS musí implementovat nové source authority rozhraní, aktuální source-aware admission/revalidation a adaptéry podle předaných kontraktů. Společné ProjectFlow/ArchFlow servisní identity a skuteční pisatelé/vlastníci/gestoři budou připraveni pro společný pozitivní test; reader SSO identity nejsou náhradou. Podněty mimo skutečnou entitu ArchFlow `need` vyžadují explicitní mapování/rozšíření kontraktu.

Zůstává ověřit reálný zdroj → příjem → schválení → indexace → Chat s přesnou citací a odebráním přístupu po indexaci. V této etapě se znovu neměřily lhůty globálního logoutu; předchozí měření 0.5.1 není zárukou okamžitého odhlášení.

`BUDGET_AKB_DOCUMENT_INTAKE_ENABLED` zůstává vypnutý, source-authority URL je prázdná a příjmová readiness uzavřená. Produkce nebyla nasazena. STRATOS běží ze zmrazeného kandidáta `2e15bba7`; jeho repozitář ani `stratos-local` nebyly měněny. AKB runtime vychází z aktuální pracovní větve nad `4712376`; zbývající pracovní změny nebyly publikovány. Fetch Gitea selhal na SSH public key, baseline kontrola proti uloženému origin/main `398aec0` prošla.

Důkazy bez tokenů, hesel a obsahu uživatelských dokumentů: [source-intake-2026-09-06](source-intake-2026-09-06/). Otisky kontraktů jsou v `contract-hashes.json`, image identity v `image-identities.txt`.
