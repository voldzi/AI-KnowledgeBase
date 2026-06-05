# CODEX vlákno 05 — LLM Gateway Service

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

**LLM Gateway Service**

---

## 2. Cíl

Vytvořit jednotnou abstrakční službu nad lokálními nebo OpenAI-compatible LLM backendy.

---

## 3. Odpovědnost služby


- Chat completion.
- Streaming chat completion.
- Embeddings.
- Model listing.
- Provider routing.
- Ollama backend.
- vLLM/OpenAI-compatible backend.
- Mock backend pro testy.
- Timeouty.
- Retry.
- Rate limiting placeholder.
- Bezpečné logování.


---

## 4. Co služba nesmí dělat


- Neprovádět RAG retrieval.
- Neznat dokumentová oprávnění.
- Neuchovávat dokumenty.
- Nevytvářet citace.
- Neřešit UI.


---

## 5. Závislosti na ostatních službách


- Volá Ollama, vLLM nebo jiný OpenAI-compatible endpoint.
- Volají ji Ingestion Service a RAG Retrieval Service.


---

## 6. Povinné výstupy


```text
services/llm-gateway-service/
services/llm-gateway-service/app/
services/llm-gateway-service/providers/
services/llm-gateway-service/tests/
services/llm-gateway-service/README.md
services/llm-gateway-service/.env.example
services/llm-gateway-service/Dockerfile
services/llm-gateway-service/openapi.yaml
docs/llm/llm-gateway.md
docs/llm/model-routing.md
```


---

## 7. API / integrační body


Endpointy minimálně:

```text
GET  /api/v1/models
POST /api/v1/chat/completions
POST /api/v1/embeddings

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

Tvůj úkol je vytvořit LLM Gateway Service.

Služba sjednocuje přístup k LLM backendům:
- Ollama
- vLLM
- OpenAI-compatible endpoint
- mock backend

Implementuj:
- FastAPI službu
- provider abstraction
- chat completion endpoint
- streaming endpoint
- embeddings endpoint
- model listing
- timeouty
- retry
- bezpečné logování bez úniku promptů v produkci
- Dockerfile
- .env.example
- testy

Služba nesmí implementovat RAG logiku ani znát dokumentové registry.
```
