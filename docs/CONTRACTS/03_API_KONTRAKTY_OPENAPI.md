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

Document status workflow:

```text
draft -> review -> approved -> valid
valid -> archived
any active state -> cancelled
review/approved -> draft when changes are requested
```

`PATCH /documents/{document_id}` odmita neplatne preskoky stavu chybou `409 invalid_document_status_transition`.

Metadata summary endpoint pro chatove inventarni dotazy:

```text
GET /documents?topic=smlouvy&tenant_id=tenant-a&external_system=STRATOS_BUDGET&context_tag=budget-contract:contract-1
GET /documents/metadata-summary?topic=digitalizace&topic=řízení%20projektů
GET /documents/metadata-summary?topic=smlouva&tenant_id=tenant-a&external_system=STRATOS_BUDGET&entity_type=contract&entity_id=contract-1&context_tag=budget-contract:contract-1
```

Endpointy vraci jen dokumenty, na ktere ma volajici `document.read`.
`/documents/metadata-summary` slouzi pro agregace a pocty.
`/documents` se stejnymi filtry slouzi pro seznamove structured outputy
z chatu, napr. "seznam smluv do tabulky".

Podporovane filtry:

- `status`, `classification`, `document_type`, `owner_id`, `tag`,
- opakovany `topic`,
- `tenant_id`,
- `external_system`,
- `entity_type`,
- `entity_id`,
- `external_ref`,
- opakovany `context_tag`.

STRATOS aplikace musi pouzivat wire pole `external_system`; historicke
`source_system` neni kontrakt pro externi integrace.

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

`POST /documents/{document_id}/versions/{version_id}/publish` vyzaduje `Document.status=approved`. Pokud dokument neni schvaleny, vraci `409 publish_requires_approval`. Publikace nastavi verzi na `valid`, dokument na `valid` a predchozi platne verze na `superseded`.

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

### 2.6 Workflow tasks

```text
GET  /workflow/tasks
POST /workflow/tasks/{task_id}/actions
```

`GET /workflow/tasks` vraci autoritativni workflow tasky vlastnene Registry API. Aktivni tasky jsou idempotentne synchronizovane z dokumentovych stavu, klasifikace a auditnich udalosti. Ingestion tasky zustavaji ve vlastnictvi Ingestion Service a web je muze zobrazit ve stejnem inboxu jako provozni doplnek.

Query filtry:

```text
status=open|waiting|blocked|resolved|cancelled
kind=review|draft|ingestion|governance|audit
priority=critical|high|medium|low
document_id=doc_123
owner_id=user_123
include_resolved=false
limit=100
offset=0
```

Workflow task response:

```json
{
  "task_id": "task_123",
  "source_key": "document-review:doc_123",
  "kind": "review",
  "priority": "high",
  "status": "open",
  "title": "Document review required",
  "description": "Review metadata, source context, access classification and publication readiness.",
  "source": "Registry document status",
  "owner_id": "user_123",
  "owner_label": "IT",
  "role": "Owner / gestor",
  "document_id": "doc_123",
  "document_title": "Směrnice pro správu dokumentů",
  "document_version_id": null,
  "audit_event_id": null,
  "job_id": null,
  "due_at": "2026-06-08T10:00:00Z",
  "resolved_at": null,
  "metadata": {
    "derived": true
  },
  "created_at": "2026-06-05T10:00:00Z",
  "updated_at": "2026-06-05T10:00:00Z"
}
```

Task action request:

```json
{
  "action": "resolve",
  "comment": "Reviewed by gestor.",
  "assignee_id": null,
  "metadata": {
    "decision": "accepted"
  }
}
```

Podporovane akce:

```text
assign
request_changes
approve
publish
archive
resolve
```

Action endpoint zapisuje rozhodnuti do `workflow_tasks.metadata`, meni stav tasku podle akce a vytvari audit event `workflow.task.<action>`. `approve` nad review taskem posouva dokument do `approved`, `request_changes` vraci review/approved dokument na `draft`, `publish` vola stejny publish gate jako dokumentovy endpoint a `archive` vola archive endpoint logiku. Idempotentni synchronizace odvozenych tasku smi aktualizovat zdrojova metadata, ale nesmi prepsat `status`, vlastnika ani `last_action` po lidskem rozhodnuti.

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
GET  /citations/{chunk_id}/open
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
  "max_chunks": 8,
  "response_language": "cs"
}
```

`response_language` supports `cs` and `en`; omitted value defaults to Czech (`cs`).

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

Source context response for `GET /citations/{chunk_id}/open`:

```json
{
  "chunk_id": "chunk_789",
  "document_id": "doc_123",
  "document_version_id": "ver_456",
  "document_title": "Směrnice ...",
  "source_file_uri": "s3://akl-documents/doc_123/ver_456/file.pdf",
  "source_file_name": "file.pdf",
  "source_mime_type": "application/pdf",
  "source_sha256": "sha256:...",
  "viewer_mode": "pdf",
  "location": {
    "page_number": 7,
    "section_path": ["Čl. 4", "Odst. 2"],
    "section_title": "Výjimky",
    "paragraph_number": "2",
    "bbox": null
  },
  "chunk_text": "Citovatelný text chunku ...",
  "before_text": "",
  "after_text": "",
  "warnings": []
}
```

### 4.2 Employee Assistant

```text
POST /assistant/chat
POST /assistant/clarify
GET  /assistant/suggestions
GET  /assistant/conversations/{conversation_id}
GET  /assistant/citations/{chunk_id}/open
```

Registry API persists and manages assistant history. The append endpoint keeps
the existing RAG persistence contract; list/detail/share/update use the
`conversation-history` namespace to avoid colliding with the RAG read endpoint:

```text
POST  /assistant/conversations/{conversation_id}/messages
GET   /assistant/conversation-history
GET   /assistant/conversation-history/{conversation_id}
PATCH /assistant/conversation-history/{conversation_id}
PUT   /assistant/conversation-history/{conversation_id}/shares
```

The AKB web BFF exposes the browser-safe chat portal contract under:

```text
GET   /api/assistant/conversations
GET   /api/assistant/conversations/{conversation_id}
PATCH /api/assistant/conversations/{conversation_id}
PUT   /api/assistant/conversations/{conversation_id}/shares
```

History records carry owner, visibility, retention, archive state, messages,
and active user/group shares. New conversations default to private visibility
and 180-day retention.

Assistant chat request:

```json
{
  "user_id": "user_123",
  "conversation_id": null,
  "message": "Potřebuji přístup.",
  "context": {
    "domain": "IT",
    "user_role": "employee"
  },
  "mode": "it_support_answer",
  "response_language": "cs"
}
```

Assistant response:

```json
{
  "response_type": "clarification_needed",
  "conversation_id": "conv_123",
  "answer": null,
  "message": "Potřebuji upřesnit dotaz.",
  "questions": [
    {
      "id": "system",
      "question": "O který systém se jedná?",
      "type": "free_text",
      "options": []
    }
  ],
  "citations": [],
  "report_artifacts": [],
  "confidence": null,
  "warnings": []
}
```

For report/table/Excel/PDF requests, the same response may include bounded
`report_artifacts`:

```json
{
  "response_type": "answer",
  "conversation_id": "conv_123",
  "answer": "Souhrn odpovědi s citacemi.",
  "citations": [
    {
      "document_id": "doc_123",
      "document_version_id": "ver_456",
      "document_title": "Směrnice",
      "version_label": "1.0",
      "document_version": "1.0",
      "section_path": ["Čl. 4"],
      "page_number": 7,
      "chunk_id": "chunk_789"
    }
  ],
  "report_artifacts": [
    {
      "artifact_id": "rpt_abc123",
      "title": "Sestava z odpovědi AKB",
      "description": "Tabulková sestava je vytvořená z citované odpovědi.",
      "columns": [
        { "key": "topic", "label": "Téma", "type": "text" },
        { "key": "summary", "label": "Závěr", "type": "text" },
        { "key": "document", "label": "Zdrojový dokument", "type": "text" }
      ],
      "rows": [
        {
          "row_id": "report_row_1",
          "cells": {
            "topic": "Kdo schvaluje výjimku",
            "summary": "Výjimku schvaluje gestor dokumentu.",
            "document": "Směrnice"
          },
          "citations": []
        }
      ],
      "export_formats": ["xlsx", "pdf"],
      "source_citation_count": 1,
      "warnings": ["REPORT_LIMITED_TO_CITED_SOURCES"]
    }
  ],
  "confidence": "medium",
  "warnings": []
}
```

The artifact source may be either:

- cited RAG answer content, where rows carry chunk citations and warnings such
  as `REPORT_LIMITED_TO_CITED_SOURCES`, or
- Registry API metadata aggregation, where the web BFF answers inventory
  questions such as document counts/lists by topic before calling RAG. Metadata
  reports carry `answer_source: "registry_metadata_summary"` when backed by
  `GET /documents/metadata-summary`, no chunk citations, and warnings such as
  `REGISTRY_METADATA_REPORT`, `REGISTRY_METADATA_SUMMARY`, or
  `REGISTRY_SCAN_LIMIT_REACHED`.

Registry metadata summary:

```text
GET /documents/metadata-summary?topic=digitalizace&topic=řízení%20projektů
```

The endpoint is permission-scoped and returns `total_visible_documents`,
`total_matched_documents`, topic rows, and buckets by document type,
classification, status, and owner/steward. It is the preferred source for exact
document inventory/count/list answers in chat.

The AKB web BFF exports the artifact with:

```text
POST /api/assistant/reports/export
```

The request body is `{ "report": <report_artifact>, "format": "xlsx" }` or
`{ "report": <report_artifact>, "format": "pdf" }`. The response is either
`200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` or
`200 application/pdf`. The export is deterministic, bounded, and contains no
macros, scripts, formulas, or external links.

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
      "model_id": "gemma4:12b",
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
  "model": "gemma4:12b",
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
  "model": "gemma4:12b",
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
- Governance Service pouze ze serveroveho web bridge, ne primo z browseru.

Web bridge pro upload dokumentu vystavuje pouze aplikacni boundary endpointy:

```text
POST /api/controlled-document/upload/preflight
PUT  /api/controlled-document/upload/sessions/{sessionId}/content
POST /api/controlled-document/ingestion
```

`preflight` prijima `document_id`, `file_name`, `file_size`, `file_type` a `sha256`, vraci `upload_session_id`, `source_file_uri`, `upload_url`, expiraci a povinne upload hlavicky. `content` overuje HMAC upload token, velikost a SHA-256 a uklada objekt do storage dostupneho Ingestion Service. `ingestion` pri pritomnosti `upload_token` overi, ze metadata draft verze odpovidaji podepsane upload session.

Web bridge pro governance dokumentu:

```text
POST /api/documents/{documentId}/governance
```

Request obsahuje `action=compare_versions|check_compliance|detect_conflicts` a volitelna `left_version_id`/`right_version_id`. Bridge nacte Registry metadata, doplni subject/context a vola odpovidajici Governance Service endpoint. Aktualni vstup je metadata/source URI/change summary only; odpoved musi obsahovat `source_limitations` s `WEB_BRIDGE_METADATA_CONTENT_ONLY`, dokud web nepredava plny extrahovany text nebo citovatelne chunky.

Web bridge pro source-context v detailu dokumentu:

```text
GET /api/documents/{documentId}/source-context?chunk_id={chunkId}
```

Bridge nacte dokument a jeho verze z Registry API, otevre chunk pres RAG `GET /citations/{chunk_id}/open` a vrati `source_context` pouze tehdy, kdyz `document_id` a `document_version_id` patri k otevrenemu detailu dokumentu. Nesoulad se vraci jako `409 BAD_DOCUMENT_WORKFLOW_REQUEST`.

Web bridge pro signed source opening:

```text
POST /api/documents/{documentId}/versions/{versionId}/source/open
GET  /api/documents/source/content?token={downloadToken}
```

`source/open` nacte dokument, verze a `document.read` hint z Registry API. Pokud verze patri k dokumentu, vytvori kratkodoby HMAC token vazany na `document_id`, `document_version_id`, `source_file_uri`, bucket, object key, filename, MIME typ, volitelny SHA-256 a expiraci. Odpoved vraci `source_open.available=false` a `unavailable_reason=SOURCE_OBJECT_NOT_FOUND`, pokud objekt neni ve storage fyzicky dostupny; browser pak nesmi predstirat funkcni download.

`source/content` token overi, odmita cizi bucket/object traversal, cte pouze z nakonfigurovaneho object-storage rootu a vraci objekt s `Cache-Control: private, no-store`, `Content-Disposition: inline`, `X-AKL-Source-Open-Id` a `X-Content-Type-Options: nosniff`. Pokud Registry metadata obsahuji plny SHA-256, content endpoint kontroluje hash pred vracenim obsahu. Pri HTML navigaci s validne podepsanym, ale expirovanym tokenem endpoint presmeruje na detail dokumentu ve viewer tabu; API/fetch volani nadale dostanou strukturovanou `410 SOURCE_DOWNLOAD_TOKEN_EXPIRED` chybu. `source.open_requested` a `source.opened` jsou zapisovane do Registry audit logu best-effort.

Assistant citation direct-source redirect vraci relativni `Location` na `source/content`, aby reverse proxy nebo Next runtime nemohly do browseru propustit interni Docker hostname. Browser URL se proto resi proti verejnemu originu, na kterem uzivatel AKB skutecne otevrel.

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
