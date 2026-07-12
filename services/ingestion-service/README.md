# AKL Ingestion Service

Samostatná FastAPI služba pro příjem ingestion jobů, parsing, OCR fallback, logické chunkování, embedding přes LLM Gateway a indexaci chunků do Qdrantu.

Služba nespravuje dokumentový registry, nepublikuje verze dokumentů, nerozhoduje workflow platnosti a negeneruje RAG odpovědi.

## Odpovědnost

- Převzetí ingestion jobu pro konkrétní `DocumentVersion`.
- Validace a načtení zdrojového souboru z object storage abstrakce.
- Parsing TXT/MD/PDF/DOCX přes vyměnitelné parsery.
- OCR fallback přes sidecar text, Tesseract image OCR nebo OCRmyPDF PDF provider.
- Logické chunkování s citovatelnými metadaty.
- Embedding chunků přes LLM Gateway `/api/v1/embeddings`.
- Indexace chunk payloadů a vektorů do Qdrantu.
- Volitelná souběžná indexace stejných chunků do OpenSearch pro BM25/fulltext.
- Read-only Intelligence entity facety a citované entity/fulltext evidence search
  nad OpenSearch chunk payloady.
- Read-only Intelligence analyst search nad OpenSearch chunk payloady s režimy
  smart, boolean, phrase, proximity a fielded.
- Read-only Intelligence relationship graph z entity co-occurrence v autorizovaných
  chuncích, včetně citovaných evidence chunků.
- Uložení ingestion reportu.
- Auditovaná synchronizace posledního ingestion jobu a výsledného stavu do
  Registry external-document reference.
- Reindex skeleton pro explicitně předané položky.

## API

Verzované endpointy jsou pod `/api/v1`.

```text
POST /api/v1/ingestion/jobs
GET  /api/v1/ingestion/jobs/{job_id}
GET  /api/v1/ingestion/jobs/{job_id}/report
POST /api/v1/ingestion/jobs/{job_id}/cancel
POST /api/v1/ingestion/reindex
GET  /api/v1/intelligence/entities/facets
POST /api/v1/intelligence/analyst/search
POST /api/v1/intelligence/entities/search
POST /api/v1/intelligence/entities/relationships

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
| `AKL_SERVICE_TOKEN` | Očekávaný inbound bearer token při `AKL_AUTH_MODE=bearer`. |
| `AKL_SERVICE_ACCOUNT_SUBJECT` | Fallback subject pro mezislužbová volání bez caller tokenu. |
| `AKL_SERVICE_ACCOUNT_ROLES` | Fallback role pro mezislužbová volání bez caller tokenu. |
| `AKL_INGESTION_REGISTRY_CLIENT_MODE` | `http` nebo `mock`. |
| `AKL_REGISTRY_API_BASE_URL` | Base URL Registry API. |
| `AKL_INGESTION_OBJECT_STORAGE_MODE` | `local`, `http`, nebo `mock`. |
| `AKL_OBJECT_STORAGE_ROOT` | Root pro lokální mapování `s3://bucket/key`. |
| `AKL_INGESTION_OCR_PROVIDER` | `disabled`, `sidecar`, `tesseract`, nebo `ocrmypdf`. |
| `AKL_INGESTION_OCR_LANGUAGE` | Jazyk OCR, výchozí `ces+eng`. |
| `AKL_INGESTION_OCRMYPDF_COMMAND` | Cesta k `ocrmypdf` pro PDF OCR provider. |
| `AKL_INGESTION_OCR_TIMEOUT_SECONDS` | Timeout OCR zpracování jednoho dokumentu. |
| `AKL_INGESTION_DEFAULT_EXTRACTION_PROFILE` | Výchozí auditovatelný profil vytěžení dokumentu. |
| `AKL_INGESTION_PDF_ENGINE` | `auto`, `pymupdf`, nebo `pypdf`; `auto` preferuje layout-aware PyMuPDF a vrací se na `pypdf`. |
| `AKL_INGESTION_EMBEDDING_CLIENT_MODE` | `http` nebo `mock`. |
| `AKL_LLM_GATEWAY_BASE_URL` | Base URL LLM Gateway. |
| `AKL_LLM_GATEWAY_TOKEN` | Audience-bound service token pouze pro LLM Gateway. |
| `AKL_LLM_GATEWAY_AUDIENCE` | Cílová audience gateway; výchozí `llm-gateway-service`. |
| `AKL_INGESTION_INDEXER_MODE` | `qdrant`, `qdrant,opensearch`, nebo `mock`. |
| `AKL_QDRANT_BASE_URL` | Qdrant REST base URL. |
| `AKL_QDRANT_COLLECTION` | Název kolekce pro chunk vektory. |
| `AKL_OPENSEARCH_BASE_URL` | OpenSearch base URL pro fulltext index. |
| `AKL_OPENSEARCH_INDEX` | Název OpenSearch indexu pro chunk dokumenty. |
| `AKL_INGESTION_JOB_STORE_PATH` | Lokální adresář pro job/report JSON záznamy. |
| `AKL_INGESTION_PROCESS_JOBS_INLINE` | `true` zpracuje job v requestu; `false` pouze uloží queued job pro budoucí worker. |

`AKL_ENV=production` odmítne start s `AKL_AUTH_MODE=disabled`, `AKL_AUTH_MODE=mock`, mock Registry klientem, mock object storage, mock embedding klientem nebo mock indexerem.

V `AKL_AUTH_MODE=oidc` služba ověří podpis, issuer a audience bearer JWT a
caller token používá pro dokumentovou autorizaci vůči Registry API. Capability,
scope a active hodnoty z tokenu nebo `X-STRATOS-*` hlaviček v OIDC režimu
ignoruje; autoritativní projekci načítá Registry ze STRATOS. Embedding volání
je oddělené: vždy používá `AKL_LLM_GATEWAY_TOKEN`, subject
`AKL_SERVICE_ACCOUNT_SUBJECT`, role `AKL_SERVICE_ACCOUNT_ROLES` a audience
`AKL_LLM_GATEWAY_AUDIENCE`. Původní caller se předává pouze jako auditní
`X-AKL-On-Behalf-Of`, nikdy jako gateway credential. Audit write preferuje
`AKL_SERVICE_ACCOUNT_TOKEN`, pokud je nastavený, jinak použije caller token.
Stejný caller kontext se používá pro synchronizaci external-document lifecycle;
Registry tím znovu ověří `document.ingest` a zapíše `INGESTING`, `INDEXED` nebo
`FAILED` spolu s aktuálním job id.

## Object Storage

V `local` režimu služba čte:

- `file:///absolute/path/file.pdf`
- absolutní nebo relativní lokální cestu,
- `s3://bucket/path/file.pdf` jako `AKL_OBJECT_STORAGE_ROOT/bucket/path/file.pdf`.

V `http` režimu služba stáhne přímo z předané URI, typicky z presigned URL.

## Parsing A OCR

Nativní parsery:

- TXT/MD přes plain-text parser,
- PDF přes layout-aware PyMuPDF v režimu `AKL_INGESTION_PDF_ENGINE=auto|pymupdf`, s fallbackem na `pypdf`,
- DOCX přes `python-docx`.

Ingestion report obsahuje `quality` blok s použitým `extraction_profile`, parserem,
počtem stran s textem, prázdnými stranami, délkou extrahovaného textu, detekovanými
tabulkami, `quality_score`, `quality_tier` (`good`, `review`, `poor`) a
`requires_review`. Stejné profilové údaje se ukládají do metadata chunků, aby šlo
zpětně auditovat, jakým profilem a parserem byla konkrétní citace vytvořena.

OCR fallback se spustí, pokud parser selže nebo extrahuje méně znaků než `AKL_INGESTION_MIN_EXTRACTED_CHARS_BEFORE_OCR` a job má `ocr_enabled=true`.

`sidecar` OCR hledá soubor vedle zdroje:

```text
document.pdf.ocr.txt
document.ocr.txt
```

`tesseract` OCR podporuje image MIME typy.

`ocrmypdf` OCR podporuje PDF. Provider volá `ocrmypdf` s českým/anglickým jazykem,
deskew a rotate-pages, čte vytvořený sidecar text a uloží do reportu metadata
`parser_engine=ocrmypdf`, `ocr_language`, `quality_score`, `quality_tier` a
`requires_review`. Pokud OCR vrátí prázdné stránky nebo nízké skóre, job skončí s
varováním `OCR_EMPTY_PAGES` nebo `LOW_OCR_QUALITY`, aby dokument nebyl používán
jako primární zdroj odpovědí bez kontroly.

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

Chunky jsou verzované vůči `DocumentVersion`, obsahují hash normalizovaného textu a metadata parseru/chunkingu. Chunk metadata nově obsahují také blok `metadata.intelligence` z pravidlové entity extrakce `rule_based_v1`. První profil extrahuje jen entity s vysokou deterministickou oporou: `email`, `url`, `ipv4`, `phone`, `date` a `document_number`. Osoby, organizace a volné vztahy nejsou v tomto profilu automaticky zapisované, dokud nebude hotová validace aliasů a evidence-backed review.

Indexery zároveň promítají `metadata.intelligence.entity_types` a
`metadata.intelligence.entity_values` do top-level payload polí `entity_types`,
`entity_values` a `entity_pairs`. Páry mají tvar `typ:normalizovaná_hodnota`
například `document_number:RMO12/2024`, aby OpenSearch facety zachovaly vazbu
mezi typem a hodnotou i u chunků s více typy entit.

## OpenSearch Fulltext

Při `AKL_INGESTION_INDEXER_MODE=qdrant,opensearch` služba zapisuje každý chunk
do Qdrantu i OpenSearch. Qdrant zůstává vektorový index pro dense retrieval,
OpenSearch ukládá stejné citační a filtrovací pole (`chunk_id`, `document_id`,
`document_version_id`, `document_title`, `document_type`, `classification`,
`status`, `tags`, `valid_from`, `page_number`, `section_path`, `entity_types`,
`entity_values`, `entity_pairs`, zdrojová URI a text). OpenSearch index se
vytváří idempotentně s českým analyzérem, asciifoldingem a stemmingem. U
existujícího indexu služba idempotentně zajišťuje mapping pro `entity_types`,
`entity_values` a `entity_pairs`.

Read-only endpoint `GET /api/v1/intelligence/entities/facets` vrací agregace
entit z OpenSearch indexu pro Intelligence Workbench. Endpoint je servisně
autentizovaný stejně jako ostatní ingestion API a nevrací text dokumentů ani
embeddingy. Existující dokumenty získají nová entity metadata až po reingestu
nebo backfillu chunk indexů.

Read-only endpoint `POST /api/v1/intelligence/analyst/search` poskytuje
pokročilé OpenSearch hledání nad autorizovanými chunk payloady. Podporované
režimy jsou `smart` (BM25 s fuzziness), `boolean`, `phrase`, `proximity` a
`fielded`. Fielded dotazy přijímají aliasy `title:`, `body:`, `section:`,
`entity:`, `source:`, `type:` a `class:`. Volající musí předat
`allowed_document_ids`; web bridge je získává z Registry API a výsledky ještě
jednou filtruje před odesláním do browseru.

Existující OpenSearch chunky lze doplnit bez reingestu zdrojových dokumentů:

```bash
python scripts/backfill_opensearch_entities.py \
  --opensearch-url http://opensearch:9200 \
  --opensearch-index akl_document_chunks \
  --batch-size 500
```

Backfill je idempotentní, zachovává existující metadata a mění pouze
OpenSearch chunk dokumenty: `metadata.intelligence`, `entity_types`,
`entity_values`, `entity_pairs` a `search_text`. Neprovádí OCR, nevytváří nové
embeddingy a nemění Registry ani Qdrant.

Historické Qdrant payloady lze dorovnat samostatně:

```bash
python scripts/backfill_qdrant_entities.py \
  --qdrant-url http://qdrant:6333 \
  --collection akl_document_chunks \
  --batch-size 256
```

Qdrant backfill mění pouze point payload (`metadata.intelligence`,
`entity_types`, `entity_values`, `entity_pairs`). Nemění vektory, point ID,
embeddingy, Registry ani OpenSearch.

Při reindexu se podle `document_version_id` smaže stará verze v obou indexech,
pokud jsou zapnuté výchozí volby `AKL_QDRANT_DELETE_EXISTING_VERSION=true` a
`AKL_OPENSEARCH_DELETE_EXISTING_VERSION=true`.

## Security A Logging

Inbound API může vyžadovat bearer token. Mezislužbová volání propagují:

```text
X-Request-ID
X-Correlation-ID
X-Service-Name
X-AKL-Subject
X-AKL-Roles
X-AKL-Audience
X-AKL-On-Behalf-Of
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
- File-backed job store je lokální persistence, ne náhrada za produkční durable queue.
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
