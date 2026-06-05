# AKL RAG Retrieval Service

Samostatne nasaditelna FastAPI sluzba pro RAG retrieval tok v AKL Platform.

Implementovany rozsah teto iterace:

- permission-aware retrieval,
- hybrid score kombinujici dense a sparse signal,
- metadata filtering podle RAG kontraktu,
- reranking,
- answer composition pres LLM Gateway klienta,
- citace podle `DocumentChunk` metadat,
- confidence,
- no-answer policy,
- audit eventy pres Registry API klienta,
- mock klienti pro Registry API, Qdrant/retrieval a LLM Gateway.

Mimo rozsah teto iterace:

- ingestion,
- parsovani dokumentu,
- vytvareni embeddingu pri ingestion,
- vlastni registry datovy model,
- zmena opravneni,
- compare-documents a check-compliance logika. Endpointy existuji, ale vraci `501 NOT_IMPLEMENTED`.

## API

Health:

- `GET /health`
- `GET /ready`

RAG:

- `POST /api/v1/rag/query`
- `POST /api/v1/rag/retrieve`
- `POST /api/v1/rag/answer`
- `POST /api/v1/rag/compare-documents`
- `POST /api/v1/rag/check-compliance`

OpenAPI specifikace je v `openapi.yaml`.

## Hlavni tok

`POST /api/v1/rag/query`:

1. Vytvori `query_id`.
2. Ziska query embedding z LLM Gateway klienta.
3. Spusti retriever nad Qdrant nebo mock indexem.
4. Aplikuje metadata filtry.
5. Posle kandidatni `document_id` do Registry API `/authz/filter-documents`.
6. Zahodi neautorizovane chunky pred rerankingem a pred LLM.
7. Provede reranking.
8. Vyhodnoti no-answer policy.
9. Pokud jsou zdroje dostatecne, sestavi prompt a zavola LLM Gateway chat completion.
10. Vrati odpoved, confidence, citace, `used_chunks`, warnings a `missing_information`.
11. Zapise audit event pres Registry API. Do auditu jde hash odpovedi, ID chunku a ID dokumentu, ne plny text odpovedi.

## Konfigurace

Zkopirujte `.env.example` a nastavte hodnoty podle prostredi.

| Promenna | Vychozi | Popis |
|---|---:|---|
| `AKL_ENV` | `development` | `production` odmítá `disabled`/`mock` auth a vynucuje http klienty. |
| `AKL_AUTH_MODE` | `disabled` | `disabled`, `mock`, `bearer`, nebo `oidc`. |
| `AKL_SERVICE_TOKEN` | prazdne | Token pro legacy prichozi `bearer` auth. |
| `AKL_UPSTREAM_BEARER_TOKEN` | prazdne | Fallback token pro volani Registry API a LLM Gateway, kdyz neni caller token. |
| `AKL_SERVICE_ACCOUNT_SUBJECT` | `svc-rag` | Fallback service subject pro dev/service-token volani. |
| `AKL_SERVICE_ACCOUNT_ROLES` | `service_rag` | Fallback service role pro dev/service-token volani. |
| `AKL_RAG_DEPENDENCY_MODE` | `mock` | Vychozi mod pro vsechny zavislosti: `mock` nebo `http`. |
| `AKL_RAG_REGISTRY_CLIENT_MODE` | podle dependency mode | Registry klient. |
| `AKL_RAG_RETRIEVER_MODE` | podle dependency mode | `mock`, `http`, nebo explicitni `qdrant`. |
| `AKL_RAG_LLM_CLIENT_MODE` | podle dependency mode | LLM Gateway klient. |
| `AKL_REGISTRY_BASE_URL` | `http://localhost:8001/api/v1` | Registry API base URL. |
| `AKL_QDRANT_BASE_URL` | `http://localhost:6333` | Qdrant base URL. |
| `AKL_QDRANT_COLLECTION` | `akl_document_chunks` | Qdrant collection s payloadem chunku. |
| `AKL_LLM_GATEWAY_BASE_URL` | `http://localhost:8080/api/v1` | LLM Gateway API base URL. |
| `AKL_RAG_NO_ANSWER_MIN_SCORE` | `0.35` | Minimalni rerank score pro odpoved. |
| `AKL_RAG_MAX_CONTEXT_CHARS` | `12000` | Maximalni velikost kontextu pro LLM. |

Phase 02 compatibility aliases jsou take podporovane:

| Promenna | Priklad | Popis |
|---|---:|---|
| `RAG_RETRIEVAL_MODE` | `mock` nebo `qdrant` | Alias pro retriever mode. |
| `RAG_MOCK_MODE` | `true` | Vynuti mock dependency default. |
| `QDRANT_URL` | `http://qdrant:6333` | Alias pro Qdrant URL. |
| `QDRANT_COLLECTION` | `akl_document_chunks` | Alias pro Qdrant kolekci. |
| `REGISTRY_API_URL` | `http://registry-api:8000` | Alias pro Registry API root; `/api/v1` se doplni automaticky. |
| `LLM_GATEWAY_URL` | `http://llm-gateway:8080` | Alias pro LLM Gateway root; `/api/v1` se doplni automaticky. |
| `RAG_TOP_K` | `8` | Alias pro vychozi `max_chunks`. |
| `RAG_MIN_SCORE` | `0.35` | Alias pro no-answer relevance threshold. |
| `RAG_ENABLE_RERANKING` | `true` | Zapne/vypne lexical reranking. |
| `RAG_AUTHZ_MODE` | `dev` nebo `registry` | Dev pouzije mock authz, registry pouzije Registry API klienta. |

## Spusteni

```bash
cd services/rag-retrieval-service
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

## Testy

```bash
cd services/rag-retrieval-service
python -m pytest
```

Testy pouzivaji mock Registry API, mock retriever a mock LLM Gateway.

Phase 02 controlled-document smoke test:

```bash
python3 scripts/phase_02_controlled_document_smoke.py
```

Smoke test vyzaduje bezici Registry API, Ingestion Service, Qdrant, RAG Retrieval Service a LLM Gateway.

## Docker

```bash
docker build -t akl-rag-retrieval-service .
docker run --rm -p 8080:8080 --env-file .env.example akl-rag-retrieval-service
```

## Bezpecnostni poznamky

- Produkce nesmi pouzivat mock auth ani mock dependency klienty.
- LLM nikdy nedostane chunky, ktere neprosly Registry authz filtrem.
- V `AKL_AUTH_MODE=oidc` sluzba vyzaduje `Authorization: Bearer <jwt>` a caller token predava do Registry API `/authz/filter-documents` a LLM Gateway volani. Audit write preferuje `AKL_UPSTREAM_BEARER_TOKEN`, pokud je nastaveny, jinak pouzije caller token.
- RAG lokalne neduplikuje validaci podpisu JWT; Registry API je enforcement bod pro dokumentova rozhodnuti.
- Technicke logy neobsahuji plny query text, prompt, odpoved ani dokumenty.
- Audit metadata obsahuji ID zdroju a hash odpovedi.
- Chybove odpovedi pouzivaji centralni tvar `{"error": ...}` s `trace_id`.

## Limity

- Qdrant HTTP retriever ocekava payload kompatibilni s `DocumentChunk` kontraktem.
- Sparse/fulltext cast je v teto iteraci kompatibilni rozhrani a lokalni lexical score nad vracenymi kandidaty.
- Konflikty mezi dokumenty nejsou detekovany; confidence `conflicting_sources` je rezervovana pro dalsi iteraci.
- `compare-documents` a `check-compliance` jsou jen kontraktni stuby s `501`.
