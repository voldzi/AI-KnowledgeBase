# Ingestion Pipeline

Tento dokument popisuje implementovaný tok `services/ingestion-service`.

## Tok Jobu

1. `POST /api/v1/ingestion/jobs` přijme `document_id`, `document_version_id`, `source_file_uri`, parser profile, OCR flag, chunking strategy a embedding profile.
2. Služba uloží `IngestionJob` do lokálního job/report store.
3. Pipeline zavolá Registry API authz check pro `document.ingest`.
4. Pipeline načte metadata dokumentu a verze přes Registry API.
5. Object storage klient načte zdrojový soubor.
6. Parser router zvolí HTML/HTM, XLSX/XLSM, TXT/MD, PDF nebo DOCX parser. HTML parser extrahuje nadpisy jako sekce a přeskakuje skripty/styly; XLSX parser extrahuje řádky listů jako tabulkové bloky (oddělovač `|`), s opakováním hlavičky v pokračovacích blocích.
7. OCR fallback se použije při selhání parseru nebo nízkém množství extrahovaného textu.
8. Logical chunker vytvoří `DocumentChunk` objekty s citovatelnými metadaty.
9. Embedding klient pošle normalizované texty na LLM Gateway `/api/v1/embeddings`.
10. Qdrant indexer uloží vektory a chunk payloady.
11. Služba uloží `IngestionReport` a auditně zapíše start/completed/failed událost přes Registry API.

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

`completed_with_warnings` se používá například při OCR fallbacku nebo parser warnings. `failed` se ukládá do reportu s chybovým kódem bez obsahu dokumentu.

## Bezpečnost

Služba nesmí publikovat dokument jako platný. Publikace zůstává odpovědností Registry API workflow.

Do logů a audit metadata nejdou celé dokumenty ani embedding input texty. Audit metadata obsahují jen ID dokumentu/verze, počet chunků, OCR flag, status a error code.

Produkční konfigurace odmítá mock Registry, mock object storage, mock embedding i mock indexer.
