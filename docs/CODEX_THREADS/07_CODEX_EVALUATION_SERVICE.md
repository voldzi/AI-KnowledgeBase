# CODEX vlákno 07 — Evaluation Service

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

**Evaluation Service**

---

## 2. Cíl

Vytvořit službu pro měření kvality RAG, retrievalu, citací a odpovědí.

---

## 3. Odpovědnost služby


- Eval datasety.
- Spouštění testovacích dotazů.
- Očekávané odpovědi.
- Očekávané citace.
- Retrieval precision/recall.
- Citation correctness.
- Faithfulness.
- No-answer correctness.
- Reporty JSON/CSV/HTML.


---

## 4. Co služba nesmí dělat


- Neměnit produkční dokumenty.
- Neměnit oprávnění.
- Nezastupovat produkční RAG službu.
- Neprovádět ingestion.


---

## 5. Závislosti na ostatních službách


- RAG Retrieval Service.
- Registry API.
- Volitelně LLM Gateway pro hodnotící model, pokud bude povoleno.


---

## 6. Povinné výstupy


```text
services/evaluation-service/
services/evaluation-service/app/
services/evaluation-service/datasets/
services/evaluation-service/runners/
services/evaluation-service/reports/
services/evaluation-service/tests/
services/evaluation-service/README.md
services/evaluation-service/.env.example
services/evaluation-service/Dockerfile
docs/evaluation/evaluation-methodology.md
```


---

## 7. API / integrační body


Endpointy minimálně:

```text
POST /api/v1/evaluations/runs
GET  /api/v1/evaluations/runs/{run_id}
GET  /api/v1/evaluations/runs/{run_id}/report
GET  /api/v1/evaluations/datasets
POST /api/v1/evaluations/datasets

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

Tvůj úkol je vytvořit Evaluation Service.

Služba má měřit kvalitu RAG systému:
- správnost odpovědi
- správnost citací
- retrieval precision/recall
- faithfulness
- no-answer correctness
- latency

Implementuj:
- eval dataset schema
- runner
- volání RAG Retrieval Service
- vyhodnocení výsledků
- JSON/CSV/HTML report
- API endpointy
- testy
- Dockerfile
- README

Služba nesmí měnit produkční dokumenty ani oprávnění.
```
