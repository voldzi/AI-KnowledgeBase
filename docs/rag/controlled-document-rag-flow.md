# Controlled Document RAG Flow

## Goal

Answer a user question from one or more controlled documents and return citations backed by real indexed chunks.

## Sequence

```text
Client / Web
  -> Registry API: create document
  -> Registry API: create document version
  -> Registry API: publish version
  -> Ingestion Service: create ingestion job
  -> Registry API: authz check document.ingest
  -> Object storage abstraction: read source_file_uri
  -> Ingestion parser/chunker
  -> LLM Gateway: embeddings
  -> Qdrant: upsert chunk points
  -> RAG Retrieval: query
  -> LLM Gateway: query embedding and answer composition
  -> Qdrant: search chunks
  -> Registry API: filter documents for rag.query
  -> RAG Retrieval: answer with citations
  -> Registry API: audit event
```

## Minimum Document State

For `only_valid=true` retrieval, the document version must be published before ingestion:

- document status: `valid`
- version status: `valid`
- `valid_from`: set to today or earlier
- `valid_to`: `null` or future date

The controlled-document smoke test publishes the version before ingestion so Qdrant receives `status=valid`.

## Real Local RAG Profile

The verified real profile uses:

```text
chat model: gemma4:12b-mlx
embedding model: bge-m3
RAG chat model: gemma4:12b-mlx
Qdrant collection: akl_document_chunks
Qdrant vector size: 1024
Qdrant distance: Cosine
AKL_RAG_AUTHZ_MODE=dev
```

Ingestion creates the Qdrant collection if it is missing. If the collection exists with a different vector size, ingestion returns a vector-size mismatch error instead of writing incompatible points. Mock embeddings are 8-dimensional by default and must not be mixed with the real `bge-m3` collection.

## Source Fixture

The canonical smoke fixture is:

```text
tests/fixtures/documents/controlled-document-sample.md
```

Expected support for the question `Kdo schvaluje výjimku ze směrnice?` is Article 2:

```text
Výjimku ze směrnice schvaluje ředitel odboru po předchozím stanovisku gestora dokumentace.
```

## API Endpoints

Registry API:

- `POST /api/v1/documents`
- `POST /api/v1/documents/{document_id}/versions`
- `POST /api/v1/documents/{document_id}/versions/{version_id}/publish`
- `POST /api/v1/authz/check`
- `POST /api/v1/authz/filter-documents`
- `POST /api/v1/audit/events`

Ingestion Service:

- `POST /api/v1/ingestion/jobs`
- `GET /api/v1/ingestion/jobs`
- `GET /api/v1/ingestion/jobs/{job_id}`
- `GET /api/v1/ingestion/jobs/{job_id}/report`

RAG Retrieval Service:

- `POST /api/v1/rag/query`
- `POST /api/v1/rag/retrieve`

LLM Gateway:

- `GET /api/v1/models`
- `POST /api/v1/embeddings`
- `POST /api/v1/chat/completions`

## Web Workflow

The web frontend uses internal API bridge routes:

- `POST /api/controlled-document/documents`
- `POST /api/controlled-document/ingestion`
- `POST /api/controlled-document/query`

These routes call service API clients server-side and do not access databases, Qdrant, or model runtimes directly.

## Citation Contract

RAG answers include:

```json
{
  "answer": "string",
  "confidence": "high|medium|low|insufficient_source|conflicting_sources",
  "citations": [
    {
      "document_id": "doc_...",
      "document_version_id": "ver_...",
      "document_title": "string",
      "version_label": "1.0",
      "document_version": "1.0",
      "section_path": ["Čl. 2"],
      "page_number": 1,
      "chunk_id": "chunk_..."
    }
  ],
  "warnings": [],
  "used_chunks": ["chunk_..."],
  "missing_information": null
}
```

## No-Answer Behavior

RAG must not answer when:

- no chunks are retrieved,
- all chunks are denied by Registry authz,
- top chunk relevance is below the configured threshold,
- chunks lack citation metadata,
- LLM Gateway returns an empty answer.

In those cases the response uses `confidence=insufficient_source` and returns warnings plus `missing_information`.
