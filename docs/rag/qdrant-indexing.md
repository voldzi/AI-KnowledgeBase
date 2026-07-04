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
AKL_QDRANT_VECTOR_SIZE=1024
AKL_QDRANT_DISTANCE=Cosine
AKL_INGESTION_INDEXER_MODE=qdrant
AKL_INGESTION_EMBEDDING_CLIENT_MODE=http
AKL_INGESTION_DEFAULT_EMBEDDING_MODEL=bge-m3
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
- `only_valid=true` requires `status=valid`. When `valid_from` is present it must be
  less than or equal to today; missing `valid_from` is treated as immediately valid.

## Collection Bootstrap

Ingestion Service creates the collection automatically if it does not exist:

```text
collection: akl_document_chunks
vector size: 1024
distance: Cosine
```

If the collection already exists with another vector size, ingestion fails with a clear `QDRANT_COLLECTION_VECTOR_SIZE_MISMATCH` error before writing points.

## Vector Dimensions

Phase 02 real local RAG uses Ollama `bge-m3`, which returns 1024-dimensional embeddings. The mock/dev-test embedding profile uses 8 dimensions by default via `AKL_MOCK_EMBEDDING_DIMENSIONS=8`.

Mock embeddings must not be used with the real `bge-m3` Qdrant collection. When switching embedding models, reset the development collection:

```bash
curl -X DELETE http://localhost:6333/collections/akl_document_chunks
```

Then rerun ingestion so the collection is recreated with the correct vector size.

`qwen3-embedding:8b` is supported as an enterprise candidate profile. Ollama returns 4096 dimensions by default, but AKB can request 1024 dimensions through the LLM Gateway `dimensions` field and the corresponding service configuration:

```bash
AKL_LLM_DEFAULT_EMBEDDING_DIMENSIONS=1024
AKL_INGESTION_DEFAULT_EMBEDDING_DIMENSIONS=1024
AKL_RAG_EMBEDDING_DIMENSIONS=1024
```

Evaluate Qwen in a parallel collection such as `akl_document_chunks_qwen3_8b_1024`. Do not reuse the `akl_document_chunks` collection unless it has been fully reset and reindexed with the target model and dimension.

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
