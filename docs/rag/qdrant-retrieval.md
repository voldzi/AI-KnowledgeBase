# Qdrant Retrieval

Phase 02A adds a real Qdrant retrieval path to `services/rag-retrieval-service`.

## Modes

Mock retrieval for deterministic tests:

```env
AKL_RAG_DEPENDENCY_MODE=mock
AKL_RAG_RETRIEVER_MODE=mock
AKL_RAG_LLM_CLIENT_MODE=mock
AKL_RAG_REGISTRY_CLIENT_MODE=mock
```

Qdrant retrieval for controlled-document MVP:

```env
AKL_RAG_DEPENDENCY_MODE=http
AKL_RAG_RETRIEVER_MODE=qdrant
AKL_RAG_LLM_CLIENT_MODE=http
AKL_RAG_REGISTRY_CLIENT_MODE=http
AKL_QDRANT_BASE_URL=http://qdrant:6333
AKL_QDRANT_COLLECTION=akl_document_chunks
AKL_LLM_GATEWAY_BASE_URL=http://llm-gateway-service:8080/api/v1
AKL_REGISTRY_BASE_URL=http://registry-api:8000/api/v1
```

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
2. Qdrant `/collections/{collection}/points/search` returns candidate points.
3. Metadata filters restrict classification, document type, tags, and validity.
4. Registry API authz filters candidate document IDs with action `rag.query`.
5. Lexical reranking is applied inside the RAG service.
6. Answer composer receives only authorized chunks above `AKL_RAG_NO_ANSWER_MIN_SCORE`.

## Empty Results

An empty Qdrant result, an empty authorized result, or a best score below `AKL_RAG_NO_ANSWER_MIN_SCORE` produces a controlled no-answer response.
