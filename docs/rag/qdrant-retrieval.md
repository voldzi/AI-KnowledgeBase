# Qdrant Retrieval

RAG Retrieval Service uses a real Qdrant retrieval path for the local knowledge base profile.

## Modes

Mock retrieval for deterministic tests:

```env
AKL_RAG_DEPENDENCY_MODE=mock
AKL_RAG_RETRIEVER_MODE=mock
AKL_RAG_LLM_CLIENT_MODE=mock
AKL_RAG_REGISTRY_CLIENT_MODE=mock
```

Qdrant retrieval for controlled documents:

```env
AKL_RAG_DEPENDENCY_MODE=http
AKL_RAG_RETRIEVER_MODE=qdrant
AKL_RAG_FULLTEXT_MODE=opensearch
AKL_RAG_LLM_CLIENT_MODE=http
AKL_RAG_REGISTRY_CLIENT_MODE=http
AKL_RAG_CHAT_MODEL=gemma4:12b-mlx
AKL_RAG_HIGH_QUALITY_CHAT_MODEL=gemma4:31b-mlx
AKL_RAG_HIGH_QUALITY_MIN_CONTEXT_CHUNKS=6
AKL_RAG_EMBEDDING_MODEL=bge-m3
AKL_RAG_AUTHZ_MODE=dev
AKL_QDRANT_BASE_URL=http://qdrant:6333
AKL_QDRANT_COLLECTION=akl_document_chunks
AKL_OPENSEARCH_BASE_URL=http://opensearch:9200
AKL_OPENSEARCH_INDEX=akl_document_chunks
AKL_LLM_GATEWAY_BASE_URL=http://llm-gateway-service:8080/api/v1
AKL_REGISTRY_BASE_URL=http://registry-api:8000/api/v1
```

The retriever query embedding must use the same embedding model as ingestion. In the real local RAG profile this is `bge-m3` with a 1024-dimensional Qdrant collection. Do not query a `bge-m3` collection with mock embeddings.

## Payload Contract

Qdrant points must store a payload compatible with `DocumentChunk`.

Required citation fields:

```json
{
  "chunk_id": "chunk_789",
  "document_id": "doc_123",
  "document_version_id": "ver_456",
  "document_title": "Smernice pro spravu testovaci dokumentace",
  "version_label": "1.0",
  "text": "Vyjimku ze smernice schvaluje reditel odboru...",
  "page_number": 1,
  "section_path": ["Clanek 2 - Schvalovani vyjimky"],
  "article_number": "2",
  "paragraph_number": null,
  "classification": "internal",
  "valid_from": "2026-06-05",
  "valid_to": null,
  "status": "valid",
  "document_type": "directive",
  "tags": ["phase02-smoke"]
}
```

The retriever preserves these fields in `RetrievedChunk.citation`; answer citations are derived from the selected retrieved chunks, not from LLM-generated text.

## Query Flow

1. RAG creates a query embedding through LLM Gateway.
2. Dense Qdrant `points/search` runs in parallel with the lexical backend. The
   current real local profile uses OpenSearch `_search` with BM25 over title,
   section, article, paragraph and chunk text fields. If
   `AKL_RAG_FULLTEXT_MODE=qdrant`, the lexical backend falls back to Qdrant
   `points/scroll` fulltext match on `normalized_text`.
3. Dense and lexical rankings are fused with Reciprocal Rank Fusion (RRF,
   k=60). The fused order decides ranking; `chunk.score` keeps the calibrated
   hybrid value used by the no-answer policy and confidence thresholds. The
   RRF value is exposed as `metadata.rrf_score`.
4. Metadata filters restrict classification, document type, tags, validity,
   `document_id`, and `document_version_id` in Qdrant and OpenSearch. Explicit
   STRATOS extraction uses both identifiers so chunks from another version
   cannot consume the result limit before the requested version is evaluated.
   Mock retrieval applies the same filter semantics.
5. Registry API authz filters candidate document IDs with action `rag.query`.
6. Lexical reranking is applied inside the RAG service.
7. Answer composer receives only authorized chunks above `AKL_RAG_NO_ANSWER_MIN_SCORE`.

## Text Normalization and Czech Recall

Ingestion stores `normalized_text` with whitespace collapsed, lowercased, and
diacritics stripped — the same normalization the retrieval side applies to the
query. The lexical scroll matches both the diacritics-stripped and the
lowercase-original query variants (`should` clause), so documents indexed
before the normalization was unified keep matching until they are reindexed.

The sparse lexical score is inflection-tolerant for fusional languages: query
and text tokens match when they share a prefix of at least 4 characters and
differ only in a suffix of up to 3 characters (vyjimka/vyjimku,
smernice/smernici). Term-frequency adds a small saturated bonus. The same
layer applies conservative controlled-document synonym bonuses for terms such
as `RMO`, `gestor`, `ucinnost`, `clanek`, `odstavec` and `priloha`, so acronym
queries can still score chunks that use the expanded legal or organizational
wording.

## Source Context Neighbours

`GET /api/v1/citations/{chunk_id}/open` and the chunk source-context endpoint
fill `before_text` and `after_text` from neighboring chunks inside the same
`document_version_id`, based on `metadata.chunk_index`. The default window is
one chunk on each side and can be changed with `AKL_RAG_SOURCE_CONTEXT_WINDOW`.
Ingestion creates an integer payload index on `metadata.chunk_index` to keep
the neighbour lookup efficient. Neighbour lookup failures degrade gracefully
to empty context.

## Empty Results

An empty Qdrant result, an empty authorized result, or a best score below `AKL_RAG_NO_ANSWER_MIN_SCORE` produces a controlled no-answer response.
