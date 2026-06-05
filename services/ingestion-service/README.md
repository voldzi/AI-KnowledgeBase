# AKL Ingestion Service

Samostatná FastAPI služba pro příjem ingestion jobů, parsing, OCR fallback, logické chunkování, embedding přes LLM Gateway a indexaci chunků do Qdrantu.

Služba nespravuje dokumentový registry, nepublikuje verze dokumentů, nerozhoduje workflow platnosti a negeneruje RAG odpovědi.

## Odpovědnost

- Převzetí ingestion jobu pro konkrétní `DocumentVersion`.
- Validace a načtení zdrojového souboru z object storage abstrakce.
- Parsing TXT/MD/PDF/DOCX přes vyměnitelné parsery.
- OCR fallback přes sidecar text nebo Tesseract image OCR provider.
- Logické chunkování s citovatelnými metadaty.
- Embedding chunků přes LLM Gateway `/api/v1/embeddings`.
- Indexace chunk payloadů a vektorů do Qdrantu.
- Uložení ingestion reportu.
- Reindex skeleton pro explicitně předané položky.

## API

Verzované endpointy jsou pod `/api/v1`.

```text
POST /api/v1/ingestion/jobs
GET  /api/v1/ingestion/jobs/{job_id}
GET  /api/v1/ingestion/jobs/{job_id}/report
POST /api/v1/ingestion/jobs/{job_id}/cancel
POST /api/v1/ingestion/reindex

GET  /health
GET  /ready
```

OpenAPI kontrakt je v `openapi.yaml` a runtime OpenAPI je dostupné jako `/openapi.json`.

## Lokální Spuštění

```bash
cd services/ingestion-service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8090
```

Lokální `mock` režim nepotřebuje Registry API, LLM Gateway ani Qdrant:

```bash
curl http://localhost:8090/health
curl http://localhost:8090/ready
```

## Konfigurace

| Proměnná | Význam |
|---|---|
| `AKL_ENV` | `development`, `test`, nebo `production`. |
| `AKL_AUTH_MODE` | `disabled`, `mock`, `bearer`, nebo `oidc`; produkce odmítá `disabled` a `mock`. |
| `AKL_SERVICE_TOKEN` | Očekávaný inbound bearer token v legacy `bearer` režimu. |
| `AKL_SERVICE_ACCOUNT_SUBJECT` | Fallback subject pro mezislužbová volání bez caller tokenu. |
| `AKL_SERVICE_ACCOUNT_ROLES` | Fallback role pro mezislužbová volání bez caller tokenu. |
| `AKL_INGESTION_REGISTRY_CLIENT_MODE` | `http` nebo `mock`. |
| `AKL_REGISTRY_API_BASE_URL` | Base URL Registry API. |
| `AKL_INGESTION_OBJECT_STORAGE_MODE` | `local`, `http`, nebo `mock`. |
| `AKL_OBJECT_STORAGE_ROOT` | Root pro lokální mapování `s3://bucket/key`. |
| `AKL_INGESTION_OCR_PROVIDER` | `disabled`, `sidecar`, nebo `tesseract`. |
| `AKL_INGESTION_EMBEDDING_CLIENT_MODE` | `http` nebo `mock`. |
| `AKL_LLM_GATEWAY_BASE_URL` | Base URL LLM Gateway. |
| `AKL_INGESTION_INDEXER_MODE` | `qdrant` nebo `mock`. |
| `AKL_QDRANT_BASE_URL` | Qdrant REST base URL. |
| `AKL_QDRANT_COLLECTION` | Název kolekce pro chunk vektory. |
| `AKL_INGESTION_JOB_STORE_PATH` | Lokální adresář pro job/report JSON záznamy. |
| `AKL_INGESTION_PROCESS_JOBS_INLINE` | `true` zpracuje job v requestu; `false` pouze uloží queued job pro budoucí worker. |

`AKL_ENV=production` odmítne start s `AKL_AUTH_MODE=disabled`, `AKL_AUTH_MODE=mock`, mock Registry klientem, mock object storage, mock embedding klientem nebo mock indexerem.

V `AKL_AUTH_MODE=oidc` služba vyžaduje `Authorization: Bearer <jwt>` a caller token předává do Registry API `/authz/check`, čtení metadat a LLM Gateway embedding volání. Audit write preferuje `AKL_SERVICE_ACCOUNT_TOKEN`, pokud je nastavený, jinak použije caller token. Lokální validaci JWT neduplikuje; rozhodnutí nad dokumenty vynucuje Registry API.

## Object Storage

V `local` režimu služba čte:

- `file:///absolute/path/file.pdf`
- absolutní nebo relativní lokální cestu,
- `s3://bucket/path/file.pdf` jako `AKL_OBJECT_STORAGE_ROOT/bucket/path/file.pdf`.

V `http` režimu služba stáhne přímo z předané URI, typicky z presigned URL.

## Parsing A OCR

Nativní parsery:

- TXT/MD přes plain-text parser,
- PDF přes `pypdf`,
- DOCX přes `python-docx`.

OCR fallback se spustí, pokud parser selže nebo extrahuje méně znaků než `AKL_INGESTION_MIN_EXTRACTED_CHARS_BEFORE_OCR` a job má `ocr_enabled=true`.

`sidecar` OCR hledá soubor vedle zdroje:

```text
document.pdf.ocr.txt
document.ocr.txt
```

`tesseract` OCR podporuje image MIME typy. PDF OCR přes rasterizaci je připravené jako provider boundary, ale není v tomto MVP implementované jako interní konverze stránek.

## Chunking

Chunk payload odpovídá `DocumentChunk` kontraktu:

- `chunk_id`
- `document_id`
- `document_version_id`
- `text`
- `normalized_text`
- `page_number`
- `section_path`
- `article_number`
- `paragraph_number`
- `char_start`
- `char_end`
- `text_hash`
- `classification`
- `valid_from`
- `valid_to`
- `access_scope`
- `metadata`

Chunky jsou verzované vůči `DocumentVersion`, obsahují hash normalizovaného textu a metadata parseru/chunkingu.

## Security A Logging

Inbound API může vyžadovat bearer token. Mezislužbová volání propagují:

```text
X-Request-ID
X-Correlation-ID
X-Service-Name
```

Služba přes Registry API volá:

- `POST /api/v1/authz/check`
- `GET /api/v1/documents/{document_id}`
- `GET /api/v1/documents/{document_id}/versions/{version_id}`
- `POST /api/v1/audit/events`

Technické logy obsahují ID jobu, dokumentu/verze, počty chunků, status a latenci. Nelogují obsah dokumentů, embedding input texty, tokeny ani secrets.

## Limity

- Výchozí limit souboru je 50 MiB.
- Výchozí cílová velikost chunku je 1400 znaků.
- Výchozí maximální velikost chunku je 3000 znaků.
- Výchozí maximální počet chunků na job je 5000.
- File-backed job store je MVP persistence, ne náhrada za produkční durable queue.
- Inline processing je vhodný pro lokální/test běh; produkční nasazení má připojit worker/queue ve stejných kontraktech.

## Testy

```bash
cd services/ingestion-service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
pytest
```

Testy ověřují health/readiness, correlation headers, hlavní TXT ingestion tok, OCR sidecar fallback, authz denial report a produkční konfiguraci bez mock dependencies.

## Docker

```bash
docker build -t akl/ingestion-service .
docker run --rm -p 8090:8090 --env-file .env akl/ingestion-service
```
