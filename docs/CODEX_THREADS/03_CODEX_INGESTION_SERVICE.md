# CODEX vlákno 03 — Ingestion Service

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

**Ingestion Service**

---

## 2. Cíl

Vytvořit samostatnou službu pro příjem, parsing, OCR, chunking, embedding a indexaci dokumentů.

---

## 3. Odpovědnost služby


- Převzetí ingestion jobu.
- Validace vstupního souboru.
- Parsing PDF/DOCX/TXT/MD.
- OCR fallback.
- Extrakce struktury.
- Logický chunking.
- Tvorba citovatelných metadat chunků.
- Embedding přes LLM Gateway.
- Indexace do Qdrant.
- Ingestion report.
- Bulk import.


---

## 4. Co služba nesmí dělat


- Nespravovat dokumentový registry.
- Nepublikovat dokumenty jako platné.
- Neobcházet oprávnění Registry API.
- Negenerovat finální RAG odpovědi.
- Neřešit frontend.


---

## 5. Závislosti na ostatních službách


- Registry API pro metadata, authz a audit.
- Object Storage pro originální soubory.
- LLM Gateway pro embeddings.
- Qdrant pro vector index.


---

## 6. Povinné výstupy


```text
services/ingestion-service/
services/ingestion-service/app/
services/ingestion-service/parsers/
services/ingestion-service/chunkers/
services/ingestion-service/embeddings/
services/ingestion-service/indexers/
services/ingestion-service/tests/
services/ingestion-service/README.md
services/ingestion-service/.env.example
services/ingestion-service/Dockerfile
services/ingestion-service/openapi.yaml
docs/ingestion/ingestion-pipeline.md
docs/ingestion/chunking-strategy.md
```


---

## 7. API / integrační body


Endpointy minimálně:

```text
POST /api/v1/ingestion/jobs
GET  /api/v1/ingestion/jobs/{job_id}
GET  /api/v1/ingestion/jobs/{job_id}/report
POST /api/v1/ingestion/jobs/{job_id}/cancel
POST /api/v1/ingestion/reindex

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

Tvůj úkol je vytvořit samostatnou službu Ingestion Service.

Služba přijímá ingestion job pro konkrétní DocumentVersion, stáhne nebo načte soubor z object storage, provede parsing, OCR fallback, chunking, embedding a indexaci do Qdrant.

Respektuj:
- centrální zadání
- API kontrakty
- datové kontrakty
- security model

Implementuj:
- FastAPI API pro ingestion jobs
- parser abstraction
- Docling/Tika/plain-text připravené rozhraní
- chunking podle logické struktury
- citovatelná metadata chunků
- embedding klient přes LLM Gateway
- Qdrant indexer
- ingestion report
- bulk import skeleton
- testy
- Dockerfile
- README

Nepublikuj dokumenty jako platné. To je odpovědnost Registry API.
```
