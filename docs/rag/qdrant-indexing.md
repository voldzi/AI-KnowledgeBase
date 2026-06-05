# Qdrant Indexing

## Collection

Default collection:

```text
akl_document_chunks
```

Configuration:

```bash
AKL_QDRANT_BASE_URL=http://qdrant:6333
AKL_QDRANT_COLLECTION=akl_document_chunks
AKL_INGESTION_INDEXER_MODE=qdrant
AKL_RAG_RETRIEVER_MODE=qdrant
```

## Writer

Only Ingestion Service writes document chunks to Qdrant. It reads Registry metadata over HTTP and never reads Registry database tables directly.

Indexing path:

```text
source_file_uri
  -> parser
  -> logical chunks
  -> LLM Gateway embeddings
  -> Qdrant upsert
```

## Payload Contract

Every point payload should include these top-level fields:

```json
{
  "chunk_id": "chunk_...",
  "document_id": "doc_...",
  "document_version_id": "ver_...",
  "document_title": "Směrnice pro správu testovací dokumentace",
  "version_label": "1.0",
  "document_type": "directive",
  "text": "Chunk text.",
  "normalized_text": "chunk text.",
  "page_number": 1,
  "section_path": ["Čl. 2"],
  "section_title": "Schvalování výjimky",
  "article_number": "2",
  "paragraph_number": null,
  "classification": "internal",
  "tags": ["controlled-document"],
  "valid_from": "2026-06-05",
  "valid_to": null,
  "status": "valid",
  "access_scope": ["role:reader"],
  "text_hash": "sha256:..."
}
```

`metadata` is reserved for ingestion provenance such as parser name, chunk index, strategy, and source file hash.

## Retrieval Filters

RAG Retrieval builds Qdrant filters from request filters:

- `classification_max` maps to allowed classifications.
- `document_types` matches payload `document_type`.
- `tags` matches payload `tags`.
- `only_valid=true` requires `status=valid` and `valid_from <= today`.

## Vector Dimensions

The collection vector size is created from the first indexed vector.

Common profiles:

- mock embeddings: 8 dimensions by default via `AKL_MOCK_EMBEDDING_DIMENSIONS=8`
- Ollama `nomic-embed-text`: model-defined dimensions, commonly 768

When switching embedding models, reset the development collection:

```bash
curl -X DELETE http://localhost:6333/collections/akl_document_chunks
```

Then rerun ingestion so the collection is recreated with the correct vector size.

## Smoke Verification

Run:

```bash
python3 scripts/phase_02_controlled_document_smoke.py
```

The smoke test:

- creates and publishes a document version,
- runs ingestion,
- counts Qdrant points for the version,
- scrolls payloads and checks Article 2 metadata,
- verifies RAG cites the created document.
