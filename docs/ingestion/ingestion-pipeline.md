# Ingestion Pipeline

Tento dokument popisuje implementovaný tok `services/ingestion-service`.

## Tok Jobu

1. `POST /api/v1/ingestion/jobs` přijme `document_id`, `document_version_id`, `source_file_uri`, parser profile, OCR flag, chunking strategy a embedding profile.
2. Služba uloží `IngestionJob` do lokálního job/report store.
3. Pipeline zavolá Registry API authz check pro `document.ingest`.
4. Pipeline načte metadata dokumentu a verze přes Registry API.
5. Object storage klient načte zdrojový soubor.
6. Parser router zvolí HTML/HTM/XHTML, XLSX/XLSM, PPTX, TXT/MD/CSV/JSON/XML, PDF nebo DOCX parser. HTML parser extrahuje nadpisy jako sekce a přeskakuje skripty/styly; XLSX parser extrahuje řádky listů jako tabulkové bloky (oddělovač `|`), s opakováním hlavičky v pokračovacích blocích; PPTX parser extrahuje slidy jako stránky s titulkem slidu jako sekcí, včetně tabulek a poznámek lektora; text parser bezpečně indexuje i strukturované textové zdroje CSV, JSON a XML.
7. OCR fallback se použije při selhání parseru nebo nízkém množství extrahovaného textu. Podporované providery jsou `sidecar`, `tesseract` pro obrázky a `ocrmypdf` pro PDF. OCR výstup ukládá metadata parser enginu, jazyka, počtu stran s textem, prázdných stran a kvality.
8. Pipeline vytvoří `quality` report s `quality_score`, `quality_tier` a `requires_review`; nízká kvalita OCR přidá varování `LOW_OCR_QUALITY` nebo `OCR_EMPTY_PAGES`.
9. Logical chunker vytvoří `DocumentChunk` objekty s citovatelnými metadaty včetně parser/OCR quality evidence.
10. Pravidlová Intelligence entity vrstva `rule_based_v1` doplní do `metadata.intelligence` deterministické entity z chunk textu: `email`, `url`, `ipv4`, `phone`, `date` a `document_number`.
11. Embedding klient pošle normalizované texty na LLM Gateway `/api/v1/embeddings` jako service identity `svc-ingestion`, s audience `llm-gateway-service`, rolí `service_ingestion` a samostatným gateway tokenem. Caller OIDC token se do gateway nepřeposílá. Dávky (`AKL_INGESTION_EMBEDDING_BATCH_SIZE`, default 32) běží paralelně s omezenou souběžností (`AKL_INGESTION_EMBEDDING_CONCURRENCY`, obecný default 2). Produkční docker-home profil používá konzervativní `AKL_INGESTION_EMBEDDING_CONCURRENCY=1`, aby re-index netlačil na jednu Ollama instanci více paralelními embedding požadavky. Pořadí vektorů je zachováno.
12. Indexer uloží chunk payloady podle `AKL_INGESTION_INDEXER_MODE`: do Qdrantu pro vektorové vyhledávání a volitelně do OpenSearch pro fulltext. Entity typy, hodnoty a páry typ-hodnota se promítají také do top-level payload polí `entity_types`, `entity_values` a `entity_pairs`.
13. Služba uloží `IngestionReport` a auditně zapíše start/completed/failed událost přes Registry API.

## Integrační Body

Registry API:

- `POST /api/v1/authz/check`
- `GET /api/v1/documents/{document_id}`
- `GET /api/v1/documents/{document_id}/versions/{version_id}`
- `POST /api/v1/audit/events`

LLM Gateway:

- `POST /api/v1/embeddings`

Qdrant:

- `GET /collections/{collection}`
- `PUT /collections/{collection}`
- `POST /collections/{collection}/points/delete`
- `PUT /collections/{collection}/points`
- provozní backfill existujících point payloadů přes `scripts/backfill_qdrant_entities.py`, který dopočítá stejný `metadata.intelligence` profil a top-level entity pole bez změny vektorů.

OpenSearch:

- bulk index chunk dokumentů do `AKL_OPENSEARCH_INDEX`, pokud je zapnutý v `AKL_INGESTION_INDEXER_MODE`.
- idempotentní mapping pro `entity_types`, `entity_values` a `entity_pairs` nad existujícím indexem.
- servisní read-only endpoint `GET /api/v1/intelligence/entities/facets` pro Intelligence Workbench facety nad OpenSearch indexem.
- servisní read-only endpoint `POST /api/v1/intelligence/analyst/search` pro
  pokročilé analytické hledání nad autorizovanými chunk payloady. Podporuje
  režimy `smart`, `boolean`, `phrase`, `proximity` a `fielded`; fielded dotazy
  používají auditovatelné aliasy `title:`, `body:`, `section:`, `entity:`,
  `source:`, `type:` a `class:`. Endpoint vždy vyžaduje
  `allowed_document_ids`, které server-side web bridge odvozuje z Registry API.
- servisní read-only endpoint `POST /api/v1/intelligence/entities/search` pro citované entity/fulltext nálezy nad chunk payloady. Endpoint vždy vyžaduje `allowed_document_ids`; server-side web bridge je odvozuje z Registry API dokumentů dostupných aktuálnímu uživateli a výsledky ještě jednou ořeže podle stejného seznamu.
- servisní read-only endpoint `POST /api/v1/intelligence/entities/relationships` pro evidence-backed vztahy mezi entitami. První profil vytváří nedirekcionální `co_occurs` hrany z entit ve stejném chunku, počítá počet důkazů/dokumentů a vrací citované evidence chucky. Endpoint stejně jako search vyžaduje `allowed_document_ids`.
- provozní backfill existujících chunků přes `scripts/backfill_opensearch_entities.py`, který dopočítá `metadata.intelligence`, top-level entity pole a `search_text` přímo v OpenSearch bez změny Registry, Qdrantu, OCR výstupů nebo embeddingů.

Object storage:

- lokální `file://` a mapované `s3://bucket/key`,
- HTTP/presigned URL režim.

## Stavový Model

Podporované statusy odpovídají centrálnímu datovému kontraktu:

```text
queued
running
completed
failed
cancelled
completed_with_warnings
```

`completed_with_warnings` se používá například při OCR fallbacku, parser warnings nebo nízké kvalitě OCR. `failed` se ukládá do reportu s chybovým kódem bez obsahu dokumentu.

## Bezpečnost

Služba nesmí publikovat dokument jako platný. Publikace zůstává odpovědností Registry API workflow.

Do logů a audit metadata nejdou celé dokumenty ani embedding input texty. Audit metadata obsahují jen ID dokumentu/verze, počet chunků, OCR flag, quality score/tier, status a error code.

Produkční konfigurace odmítá mock Registry, mock object storage, mock embedding i mock indexer.

## Entity Backfill Pro Existující Indexy

Nová entity vrstva se do nově ingestovaných chunků zapisuje automaticky do
Qdrantu i OpenSearch. Pro existující OpenSearch index lze použít idempotentní
backfill:

```bash
python scripts/backfill_opensearch_entities.py \
  --opensearch-url http://opensearch:9200 \
  --opensearch-index akl_document_chunks \
  --batch-size 500
```

Před produkčním během použijte read-only kontrolu:

```bash
python scripts/backfill_opensearch_entities.py \
  --opensearch-url http://opensearch:9200 \
  --opensearch-index akl_document_chunks \
  --batch-size 200 \
  --limit 500 \
  --dry-run
```

Backfill čte `text` nebo `normalized_text`, spouští profil `rule_based_v1`,
zachovává existující `metadata`, přidává `metadata.intelligence`, promítá
`entity_types`, `entity_values` a `entity_pairs` do top-level polí a aktualizuje
`search_text`, aby fulltext zachytil i normalizované entity. Neloguje text
dokumentů ani hodnoty entit; průběžný výstup obsahuje pouze počty.

Pro existující Qdrant vektorovou kolekci použijte:

```bash
python scripts/backfill_qdrant_entities.py \
  --qdrant-url http://qdrant:6333 \
  --collection akl_document_chunks \
  --batch-size 256
```

Qdrant backfill mění pouze payload pointů: `metadata.intelligence`,
`entity_types`, `entity_values` a `entity_pairs`. Vektory, embedding model ani
identita pointů se nemění. Před produkčním během lze použít `--dry-run` a po
doběhu `--missing-only --dry-run`, který má vrátit `updated=0`.

Tento postup neopravuje špatně vytěžený zdrojový text. Dokumenty s nízkou OCR
kvalitou je potřeba reingestovat po zlepšení OCR/parsing vrstvy.
