# CODEX vlákno 08 — Governance / Compliance Service

Odkaz na centrální zadání: `../00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

Před zahájením práce přečti také:

- `../ARCHITECTURE/01_ARCHITEKTURA_DISTRIBUOVANYCH_SLUZEB.md`
- `../ARCHITECTURE/02_SERVICE_BOUNDARIES.md`
- `../CONTRACTS/03_API_KONTRAKTY_OPENAPI.md`
- `../CONTRACTS/05_DATOVE_KONTRAKTY.md`
- `../CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`
- `../08_INTEGRATION_RULES_FOR_CODEX_THREADS.md`
- `../09_DEFINITION_OF_DONE.md`

---

## 1. Název služby

**Governance / Compliance Service**

---

## 2. Cíl

Vytvořit pokročilou službu pro řízení dokumentace, porovnání verzí, detekci rozporů a kontrolu souladu.

---

## 3. Odpovědnost služby


- Porovnání verzí dokumentů.
- Sumarizace změn.
- Detekce rozporů mezi dokumenty.
- Kontrola návrhu dokumentu vůči platným směrnicím.
- Návrh KB článků z řízených dokumentů.
- Hlídání končící platnosti.
- Governance reporty.


---

## 4. Co služba nesmí dělat


- Nepublikovat dokumenty bez Registry workflow.
- Neměnit oprávnění.
- Nevydávat AI návrhy za autoritativní rozhodnutí.
- Nepřeskakovat citace.


---

## 5. Závislosti na ostatních službách


- Registry API.
- RAG Retrieval Service.
- LLM Gateway nepřímo přes RAG nebo přímo jen pro schválené governance workflow.


---

## 6. Povinné výstupy


```text
services/governance-service/
services/governance-service/app/
services/governance-service/document_diff/
services/governance-service/conflict_detection/
services/governance-service/compliance/
services/governance-service/kb_generation/
services/governance-service/tests/
services/governance-service/README.md
services/governance-service/.env.example
services/governance-service/Dockerfile
docs/governance/governance-service.md
docs/governance/compliance-checks.md
```


---

## 7. API / integrační body


Endpointy minimálně:

```text
POST /api/v1/governance/compare-versions
POST /api/v1/governance/check-compliance
POST /api/v1/governance/detect-conflicts
POST /api/v1/governance/generate-kb-article
GET  /api/v1/governance/validity-alerts

GET /health
GET /ready
```


---

## 8. Definition of Done pro toto vlákno

Služba musí dodat:

- samostatný adresář služby,
- `README.md`,
- `.env.example`,
- `Dockerfile`,
- healthcheck endpoint,
- testy,
- dokumentované API nebo integrační kontrakty,
- bezpečné logování,
- correlation id,
- žádné hardcoded secrets,
- jasně popsané limity,
- kompatibilitu s centrálními kontrakty.

---

## 9. Úvodní prompt pro CODEX

```text
Pracuješ na projektu AKL Platform — AI Knowledge Library.

Tvůj úkol je vytvořit Governance / Compliance Service.

Služba poskytuje pokročilé funkce:
- porovnání verzí dokumentu
- sumarizace změn
- detekce rozporů mezi dokumenty
- kontrola souladu návrhu dokumentu s platnou dokumentací
- návrh KB článku
- upozornění na končící platnost

Každý výstup musí obsahovat citace, zdroje a míru jistoty.
Služba nesmí autoritativně měnit dokumenty bez Registry API workflow.
```
