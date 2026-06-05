# CODEX vlákno 04 — RAG Retrieval Service

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

**RAG Retrieval Service**

---

## 2. Cíl

Vytvořit samostatnou službu pro hybridní retrieval, reranking, sestavení odpovědi s citacemi a bezpečnostní filtrování.

---

## 3. Odpovědnost služby


- Query analysis.
- Metadata filtering.
- Permission-aware retrieval.
- Dense vector search.
- Sparse/fulltext compatible interface.
- Hybrid fusion.
- Reranking.
- Context selection.
- Answer composition.
- Citace.
- Confidence.
- No-answer policy.
- Compare documents.
- Check compliance.


---

## 4. Co služba nesmí dělat


- Nevlastnit registry dokumentů.
- Neparsovat dokumenty.
- Nevytvářet trvalé dokumentové metadata.
- Neposkytovat LLM backend napřímo.
- Neobcházet Registry API při kontrole oprávnění.


---

## 5. Závislosti na ostatních službách


- Registry API pro metadata, authz a audit.
- Qdrant pro retrieval.
- LLM Gateway pro generování odpovědí.
- Evaluation Service ji používá pro testy.


---

## 6. Povinné výstupy


```text
services/rag-retrieval-service/
services/rag-retrieval-service/app/
services/rag-retrieval-service/retrievers/
services/rag-retrieval-service/rerankers/
services/rag-retrieval-service/answer_composer/
services/rag-retrieval-service/policies/
services/rag-retrieval-service/tests/
services/rag-retrieval-service/README.md
services/rag-retrieval-service/.env.example
services/rag-retrieval-service/Dockerfile
services/rag-retrieval-service/openapi.yaml
docs/rag/retrieval-design.md
docs/rag/answer-policy.md
docs/rag/no-answer-policy.md
```


---

## 7. API / integrační body


Endpointy minimálně:

```text
POST /api/v1/rag/query
POST /api/v1/rag/retrieve
POST /api/v1/rag/answer
POST /api/v1/rag/compare-documents
POST /api/v1/rag/check-compliance

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

Tvůj úkol je vytvořit RAG Retrieval Service jako samostatně nasaditelnou službu.

Služba musí:
- přijmout dotaz uživatele
- respektovat oprávnění
- vyhledat relevantní chunky v Qdrant
- aplikovat metadata filtry
- provést hybrid retrieval
- provést reranking
- sestavit odpověď přes LLM Gateway
- vrátit citace
- vrátit confidence
- odmítnout odpověď, pokud nejsou zdroje dostatečné
- zapsat audit přes Registry API

Implementuj testovatelnou architekturu s mock klienty pro Registry API, Qdrant a LLM Gateway.

Neimplementuj ingestion ani registry datový model.
```
