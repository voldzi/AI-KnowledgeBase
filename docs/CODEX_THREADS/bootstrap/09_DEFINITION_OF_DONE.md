# Definition of Done

Odkaz na centrální zadání: `00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

---

## 1. Obecná Definition of Done pro každou službu

Služba je považována za dokončenou v dané iteraci pouze pokud:

- jde spustit lokálně,
- jde spustit v Dockeru,
- má `README.md`,
- má `.env.example`,
- má `Dockerfile`,
- má healthcheck,
- má testy,
- má dokumentované API,
- má dokumentovanou konfiguraci,
- má bezpečné logování,
- neobsahuje hardcoded secrets,
- respektuje service boundaries,
- respektuje datové kontrakty,
- má popsané limity.

---

## 2. Kvalita kódu

- jasná struktura,
- malé moduly,
- pojmenování podle doménového slovníku,
- oddělená business logika od transportní vrstvy,
- validace vstupů,
- typed schemas / DTO,
- error handling,
- testovatelné klienty závislostí.

---

## 3. API

Pokud služba vystavuje API:

- OpenAPI musí být dostupné,
- endpointy musí být verzované,
- chyby musí mít jednotný formát,
- musí být podporován request id / correlation id,
- musí být popsány auth požadavky.

---

## 4. Bezpečnost

- žádné secrets v repozitáři,
- env konfigurace,
- authz checks tam, kde služba pracuje s dokumenty,
- bezpečné logování,
- produkce nesmí používat mock auth,
- auditní body tam, kde se mění nebo čte citlivý obsah.

---

## 5. Testy

Minimálně:

- unit testy hlavní business logiky,
- test konfigurace,
- test healthchecku,
- mock test hlavních integračních klientů,
- test chybového stavu.

---

## 6. Dokumentace

Každá služba má dokumentovat:

- účel,
- odpovědnost,
- co služba nedělá,
- API,
- konfiguraci,
- spuštění,
- testy,
- závislosti,
- limity,
- bezpečnostní poznámky.

---

## 7. RAG-specifická DoD

RAG funkcionalita musí:

- vracet citace,
- respektovat authz,
- umět no-answer,
- uvádět confidence,
- auditovat query,
- logovat použité chunk IDs, pokud je to povoleno,
- netvrdit odpověď bez zdroje.

---

## 8. Ingestion-specifická DoD

Ingestion musí:

- uložit ingestion report,
- zachytit chyby parseru,
- chunkovat s citovatelnými metadaty,
- verzovat výsledek vůči DocumentVersion,
- nezveřejnit dokument jako platný bez Registry workflow.

---

## 9. Frontend-specifická DoD

Frontend musí:

- nezobrazovat akce, na které uživatel nemá oprávnění,
- zobrazovat citace,
- zobrazovat stav ingestion,
- zobrazovat verzi a platnost dokumentu,
- rozlišovat platný / archivní / draft dokument.
