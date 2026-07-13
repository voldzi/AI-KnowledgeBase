# AKL Evaluation Service

Samostatne nasaditelna FastAPI sluzba pro mereni kvality RAG odpovedi, citaci a retrievalu v AKB Platform.

Implementovany rozsah:

- eval dataset schema,
- spousteni testovacich dotazu proti RAG Retrieval Service,
- retrieval precision, recall, hit rate a MRR,
- graded relevance a nDCG,
- false-zero a authorization-leak metriky,
- role/query-category slices a p50/p95 latency,
- draft/silver/gold dataset maturity,
- quality gate a automaticke porovnani s poslednim během datasetu,
- citation precision, recall a correctness,
- odpovedove metriky nad ocekavanymi a zakazanymi termy,
- deterministicky faithfulness proxy nad citacemi a vracenymi chunky,
- no-answer correctness,
- latency per case,
- JSON, CSV a HTML reporty,
- mock RAG a Registry klienti pro lokalni testy.

Mimo rozsah:

- ingestion,
- zmena produkcnich dokumentu,
- zmena opravneni,
- produkcni RAG odpovidani,
- LLM-as-a-judge hodnoceni. To je volitelne rozsireni pro dalsi iteraci.

## API

Health:

- `GET /health`
- `GET /ready`

Evaluations:

- `POST /api/v1/evaluations/runs`
- `GET /api/v1/evaluations/runs`
- `GET /api/v1/evaluations/runs/{run_id}`
- `GET /api/v1/evaluations/runs/{run_id}/report?format=json|csv|html`
- `GET /api/v1/evaluations/datasets`
- `GET /api/v1/evaluations/datasets/{dataset_id}`
- `POST /api/v1/evaluations/datasets`
- `GET /api/v1/evaluations/quality/overview`

OpenAPI specifikace je v `openapi.yaml`.

## Dataset schema

Dataset obsahuje `cases`. Kazdy case definuje:

- `query`,
- `subject_id`,
- RAG `filters`,
- `expected_answer_terms`,
- `forbidden_answer_terms`,
- `expected_citations`,
- `expected_relevant_chunk_ids`,
- `expected_relevant_document_ids` a volitelne graded `relevance_judgments`,
- `expected_forbidden_chunk_ids` pro autorizacni testy,
- `expected_no_answer`.

Pripad dale nese `role`, `query_category` a `judgment_status`. Rezim
`answer_mode=retrieve_only` nevola generacni model a je urcen pro rychle
retrieval baseline.

Minimalni priklad je v `datasets/sample_rag_eval.json`.

## Hlavni tok

`POST /api/v1/evaluations/runs`:

1. Nacte dataset podle `dataset_id` nebo pouzije inline dataset v requestu.
2. Pro kazdy case zavola RAG `/rag/retrieve`.
3. Pro kazdy case zavola RAG `/rag/query`.
4. Vyhodnoti retrieval, citace, odpoved, faithfulness, no-answer a latency.
5. Ulozi JSON run report do `AKL_EVAL_REPORTS_DIR`.
6. Volitelne zapise audit event do Registry API bez plneho query/answer textu.
7. Vrati kompletni `EvaluationRun`.

## Konfigurace

| Promenna | Vychozi | Popis |
|---|---:|---|
| `AKL_ENV` | `development` | `production` vynucuje bearer auth a realny RAG klient. |
| `AKL_AUTH_MODE` | `disabled` | `disabled`, `mock`, `bearer`, nebo produkcni `oidc`. |
| `AKL_SERVICE_TOKEN` | prazdne | Token pro prichozi bearer auth. |
| `AKL_UPSTREAM_BEARER_TOKEN` | prazdne | Token pro volani RAG a Registry API. |
| `AKL_STRATOS_AUTH_ME_URL` | prazdne | Autoritativni STRATOS access projection; povinne pro OIDC. |
| `AKL_STRATOS_ACCESS_TIMEOUT_SECONDS` | `3` | Timeout projekce; chyba nebo timeout znamena fail-closed. |
| `AKL_EVAL_DEPENDENCY_MODE` | `mock` | Vychozi mod klientu: `mock` nebo `http`. |
| `AKL_EVAL_RAG_CLIENT_MODE` | podle dependency mode | RAG klient. |
| `AKL_EVAL_REGISTRY_CLIENT_MODE` | podle dependency mode | Registry audit klient. |
| `AKL_RAG_BASE_URL` | `http://localhost:8002/api/v1` | RAG Retrieval Service base URL. |
| `AKL_REGISTRY_BASE_URL` | `http://localhost:8001/api/v1` | Registry API base URL. |
| `AKL_EVAL_DATASETS_DIR` | `datasets` | Adresar s eval datasety. |
| `AKL_EVAL_SEED_DATASETS_DIR` | prazdne | Read-only adresar se seed datasety kopirovanymi pouze pokud chybi. |
| `AKL_EVAL_REPORTS_DIR` | `reports` | Adresar pro ulozene run reporty. |
| `AKL_EVAL_MAX_CASES_PER_RUN` | `200` | Ochrana proti prilis velkym behum. |
| `AKL_EVAL_CONCURRENCY` | `4` | Maximalni pocet soubeznych eval pripadu. |
| `AKL_EVAL_PASS_THRESHOLD` | `0.75` | Minimalni overall score pro pass. |
| `AKL_EVAL_ANSWER_EXCERPT_CHARS` | `500` | Maximalni delka answer excerptu v reportu. |
| `AKL_EVAL_AUDIT_ENABLED` | `true` | Zapina audit event do Registry API. |

## Spusteni

```bash
cd services/evaluation-service
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

## Testy

```bash
cd services/evaluation-service
python -m pytest
```

## Docker

```bash
docker build -t akl-evaluation-service .
docker run --rm -p 8080:8080 --env-file .env.example akl-evaluation-service
```

## Bezpecnostni poznamky

- Produkce nesmi pouzivat mock RAG klient.
- Produkcni UI pouziva OIDC; Evaluation overi token a povoli Quality Lab jen
  podle aktualni AKB access projection ze STRATOS. Role, staticke token claims a
  `X-STRATOS-*` hlavicky opravneni neudeluji.
- Datasety jsou private/shared a reporty jsou omezeny na vlastnika nebo administratora.
- Sluzba nemeni dokumenty, verze dokumentu ani opravneni.
- Technicke logy neobsahuji plne query, odpovedi, prompty ani dokumenty.
- Audit metadata obsahuji run id, dataset id, stav a agregovane metriky.
- Report obsahuje pouze answer excerpt, citace a ID chunku. Delku excerptu ridi env promenna.
- Chybove odpovedi pouzivaji centralni tvar `{"error": ...}` s `trace_id`.

## Limity

- Retrieval metriky predpokladaji, ze dataset obsahuje relevantni `chunk_id`.
- Faithfulness je deterministicky proxy: kontroluje, zda odpoved cituje chunk vraceny retrieverem nebo uvedeny v `used_chunks`.
- LLM-as-a-judge neni soucasti teto iterace.
- Dataset/report store je filesystem nad perzistentnimi volumes. Pro vice replik je potreba sdilene uloziste nebo databaze vlastnena Evaluation Service.
