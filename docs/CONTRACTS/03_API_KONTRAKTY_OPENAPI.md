# API kontrakty — OpenAPI návrh

Odkaz na centrální zadání: `../00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

Tento dokument definuje minimální API kontrakty mezi službami.

---

## 1. Obecné API zásady

- Všechna API používají JSON.
- Všechna API jsou verzovaná přes `/api/v1`.
- Každá služba vystavuje:
  - `GET /health`
  - `GET /ready`
  - `GET /metrics`, pokud je povoleno.
- Chybová odpověď má jednotný tvar.

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {},
    "trace_id": "string"
  }
}
```

---

## 2. Identity & Document Registry API

Base URL:

```text
https://registry-api.local/api/v1
```

### 2.1 Documents

```text
POST   /documents
GET    /documents
GET    /documents/{document_id}
PATCH  /documents/{document_id}
DELETE /documents/{document_id}
```

Create document request:

```json
{
  "title": "Směrnice pro správu dokumentů",
  "document_type": "directive",
  "owner_id": "user_123",
  "gestor_unit": "IT",
  "classification": "internal",
  "tags": ["směrnice", "dokumentace"]
}
```

Document response:

```json
{
  "document_id": "doc_123",
  "title": "Směrnice pro správu dokumentů",
  "document_type": "directive",
  "status": "draft",
  "classification": "internal",
  "owner_id": "user_123",
  "gestor_unit": "IT",
  "created_at": "2026-06-05T10:00:00Z",
  "updated_at": "2026-06-05T10:00:00Z"
}
```

### 2.2 Document versions

```text
POST /documents/{document_id}/versions
GET  /documents/{document_id}/versions
GET  /documents/{document_id}/versions/{version_id}
POST /documents/{document_id}/versions/{version_id}/publish
POST /documents/{document_id}/versions/{version_id}/archive
```

Create version request:

```json
{
  "version_label": "1.0",
  "valid_from": "2026-07-01",
  "valid_to": null,
  "source_file_uri": "s3://akl-documents/doc_123/ver_1/file.pdf",
  "change_summary": "První platná verze."
}
```

### 2.3 Authorization check

```text
POST /authz/check
```

Request:

```json
{
  "subject_id": "user_123",
  "action": "document.read",
  "resource": {
    "document_id": "doc_123",
    "document_version_id": "ver_456",
    "classification": "internal"
  }
}
```

Response:

```json
{
  "allowed": true,
  "reason": "role document_reader grants access",
  "constraints": {
    "max_classification": "internal"
  }
}
```

### 2.4 Bulk authorization filter

```text
POST /authz/filter-documents
```

Request:

```json
{
  "subject_id": "user_123",
  "action": "document.read",
  "candidate_document_ids": ["doc_1", "doc_2", "doc_3"]
}
```

Response:

```json
{
  "allowed_document_ids": ["doc_1", "doc_3"],
  "denied_document_ids": ["doc_2"]
}
```

### 2.5 Audit

```text
POST /audit/events
GET  /audit/events
GET  /audit/events/{event_id}
```

Audit event request:

```json
{
  "actor_id": "user_123",
  "event_type": "rag.query.executed",
  "resource_type": "rag_query",
  "resource_id": "query_123",
  "severity": "info",
  "metadata": {
    "service": "rag-retrieval-service"
  }
}
```

---

## 3. Ingestion Service API

Base URL:

```text
https://ingestion.local/api/v1
```

### 3.1 Jobs

```text
POST /ingestion/jobs
GET  /ingestion/jobs
GET  /ingestion/jobs/{job_id}
GET  /ingestion/jobs/{job_id}/report
POST /ingestion/jobs/{job_id}/cancel
POST /ingestion/reindex
```

Create ingestion job request:

```json
{
  "document_id": "doc_123",
  "document_version_id": "ver_456",
  "source_file_uri": "s3://akl-documents/doc_123/ver_456/file.pdf",
  "parser_profile": "controlled_document",
  "ocr_enabled": true,
  "chunking_strategy": "legal_structured",
  "embedding_profile": "default"
}
```

Job response:

```json
{
  "job_id": "ing_123",
  "status": "queued",
  "document_id": "doc_123",
  "document_version_id": "ver_456",
  "source_file_uri": "s3://akl-documents/doc_123/ver_456/file.pdf",
  "parser_profile": "controlled_document",
  "ocr_enabled": true,
  "chunking_strategy": "legal_structured",
  "embedding_profile": "default",
  "created_at": "2026-06-05T10:00:00Z"
}
```

---

## 4. RAG Retrieval Service API

Base URL:

```text
https://rag.local/api/v1
```

### 4.1 Query

```text
POST /rag/query
POST /rag/retrieve
POST /rag/answer
POST /rag/compare-documents
POST /rag/check-compliance
```

RAG query request:

```json
{
  "subject_id": "user_123",
  "query": "Jaký je postup při schválení výjimky?",
  "filters": {
    "document_types": ["directive", "methodology"],
    "only_valid": true,
    "classification_max": "internal",
    "tags": []
  },
  "answer_mode": "normative_with_citations",
  "max_chunks": 8
}
```

RAG query response:

```json
{
  "query_id": "query_123",
  "answer": "Výjimku schvaluje ...",
  "confidence": "high",
  "citations": [
    {
      "document_id": "doc_123",
      "document_version_id": "ver_456",
      "document_title": "Směrnice ...",
      "version_label": "1.0",
      "section_path": ["Čl. 4", "Odst. 2"],
      "page_number": 7,
      "chunk_id": "chunk_789"
    }
  ],
  "warnings": [],
  "used_chunks": ["chunk_789"],
  "missing_information": null
}
```

---

## 5. LLM Gateway API

Base URL:

```text
https://llm-gateway.local/api/v1
```

### 5.1 Models

```text
GET /models
```

Response:

```json
{
  "models": [
    {
      "model_id": "qwen2.5:14b",
      "provider": "ollama",
      "capabilities": ["chat"],
      "context_window": 32768
    }
  ]
}
```

### 5.2 Chat completion

```text
POST /chat/completions
```

Request:

```json
{
  "model": "qwen2.5:14b",
  "messages": [
    {
      "role": "system",
      "content": "Odpovídej pouze z poskytnutých zdrojů."
    },
    {
      "role": "user",
      "content": "Jaký je postup?"
    }
  ],
  "temperature": 0.1,
  "stream": false,
  "metadata": {
    "purpose": "rag_answer"
  }
}
```

Response:

```json
{
  "id": "cmpl_123",
  "model": "qwen2.5:14b",
  "content": "Postup je ...",
  "finish_reason": "stop",
  "usage": {
    "prompt_tokens": 1200,
    "completion_tokens": 220,
    "total_tokens": 1420
  }
}
```

### 5.3 Embeddings

```text
POST /embeddings
```

Request:

```json
{
  "model": "bge-m3",
  "input": ["Text jednoho chunku."]
}
```

Response:

```json
{
  "model": "bge-m3",
  "data": [
    {
      "index": 0,
      "embedding": [0.01, 0.02, 0.03]
    }
  ]
}
```

---

## 6. Governance / Compliance Service API

Base URL:

```text
https://governance.local/api/v1
```

### 6.1 Governance workflows

```text
POST /governance/compare-versions
POST /governance/check-compliance
POST /governance/detect-conflicts
POST /governance/generate-kb-article
GET  /governance/validity-alerts
```

Kazdy governance vystup musi obsahovat:

```json
{
  "result_id": "gov_123",
  "citations": [],
  "sources": [],
  "confidence": "high",
  "warnings": [],
  "missing_information": null
}
```

Poznamky:

- sluzba nesmi publikovat dokumenty ani menit opravneni,
- pri praci s dokumenty musi pouzit Registry authz,
- kontrolni zdroje pro compliance musi byt citovatelne,
- audit se zapisuje pres Registry API a nesmi obsahovat plny obsah dokumentu.

---

## 7. Web Frontend API usage

Frontend nevolá přímo:

- PostgreSQL,
- Qdrant,
- MinIO interní API, pokud nejde o podepsané upload/download URL,
- Ollama/vLLM.

Frontend volá:

- Registry API,
- RAG Retrieval Service,
- Ingestion Service.

---

## 8. Verzionování API

Každé breaking change musí:

- zvýšit major verzi API,
- mít migration note,
- aktualizovat OpenAPI kontrakt,
- aktualizovat klienty,
- uvést dopad na služby.

---

## 9. Povinné hlavičky

Doporučené hlavičky:

```text
Authorization: Bearer <token>
X-Request-ID: <uuid>
X-Correlation-ID: <uuid>
X-Service-Name: <service>
```

---

## 10. Traceability

Každá služba musí propagovat:

- `X-Request-ID`,
- `X-Correlation-ID`.

Auditní události musí obsahovat correlation id, aby šlo dohledat celý tok:

```text
frontend -> registry -> rag -> llm -> registry audit
```
