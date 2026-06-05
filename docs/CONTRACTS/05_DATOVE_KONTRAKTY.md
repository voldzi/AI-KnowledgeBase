# Datové kontrakty

Odkaz na centrální zadání: `../00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

Tento dokument definuje sdílené datové objekty používané napříč službami.

---

## 1. Document

```json
{
  "document_id": "doc_123",
  "title": "Směrnice pro správu dokumentů",
  "document_type": "directive",
  "status": "draft",
  "classification": "internal",
  "owner_id": "user_123",
  "gestor_unit": "IT",
  "tags": ["směrnice"],
  "created_at": "2026-06-05T10:00:00Z",
  "updated_at": "2026-06-05T10:00:00Z"
}
```

### Povolené document_type

```text
directive
regulation
methodology
policy
procedure
manual
knowledge_base_article
meeting_record
contract
attachment
other
```

### Povolené status

```text
draft
review
valid
superseded
archived
cancelled
```

### Povolené classification

```text
public
internal
restricted
confidential
```

---

## 2. DocumentVersion

```json
{
  "document_version_id": "ver_456",
  "document_id": "doc_123",
  "version_label": "1.0",
  "status": "valid",
  "valid_from": "2026-07-01",
  "valid_to": null,
  "source_file_uri": "s3://akl-documents/doc_123/ver_456/file.pdf",
  "file_hash": "sha256:...",
  "change_summary": "První platná verze.",
  "created_at": "2026-06-05T10:00:00Z",
  "published_at": "2026-06-10T10:00:00Z"
}
```

---

## 3. DocumentFile

```json
{
  "file_id": "file_123",
  "document_id": "doc_123",
  "document_version_id": "ver_456",
  "uri": "s3://akl-documents/doc_123/ver_456/file.pdf",
  "filename": "smernice.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 123456,
  "sha256": "...",
  "uploaded_by": "user_123",
  "uploaded_at": "2026-06-05T10:00:00Z"
}
```

---

## 4. DocumentChunk

Chunk musí umožnit přesnou citaci.

```json
{
  "chunk_id": "chunk_789",
  "document_id": "doc_123",
  "document_version_id": "ver_456",
  "document_title": "Směrnice pro správu testovací dokumentace",
  "version_label": "1.0",
  "document_type": "directive",
  "text": "Text chunku.",
  "normalized_text": "normalizovaný text chunku",
  "page_number": 7,
  "section_path": ["Čl. 4", "Odst. 2"],
  "section_title": "Schvalování výjimek",
  "article_number": "4",
  "paragraph_number": "2",
  "char_start": 1200,
  "char_end": 2450,
  "text_hash": "sha256:...",
  "classification": "internal",
  "tags": ["controlled-document"],
  "valid_from": "2026-07-01",
  "valid_to": null,
  "status": "valid",
  "access_scope": ["role:document_reader"],
  "metadata": {
    "parser": "docling",
    "chunking_strategy": "legal_structured"
  }
}
```

---

## 5. RetrievedChunk

```json
{
  "chunk_id": "chunk_789",
  "score": 0.92,
  "retrieval_method": "hybrid",
  "text": "Text chunku.",
  "citation": {
    "document_id": "doc_123",
    "document_version_id": "ver_456",
    "document_title": "Směrnice ...",
    "version_label": "1.0",
    "page_number": 7,
    "section_path": ["Čl. 4", "Odst. 2"],
    "article_number": "4",
    "paragraph_number": "2"
  },
  "metadata": {
    "dense_score": 0.88,
    "sparse_score": 0.76,
    "rerank_score": 0.94
  }
}
```

---

## 6. RAG Answer

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
      "page_number": 7,
      "section_path": ["Čl. 4", "Odst. 2"],
      "chunk_id": "chunk_789"
    }
  ],
  "warnings": [],
  "used_chunks": ["chunk_789"],
  "missing_information": null
}
```

### Povolené confidence

```text
high
medium
low
insufficient_source
conflicting_sources
```

---

## 7. GovernanceResult

Governance vystupy musi byt navrhove a citovatelne.

```json
{
  "result_id": "gov_123",
  "summary": "Detekovany 2 materialni rozdily.",
  "confidence": "medium",
  "citations": [
    {
      "document_id": "doc_123",
      "document_version_id": "ver_456",
      "document_title": "Smernice ...",
      "version_label": "1.0",
      "section_path": ["Cl. 4"],
      "page_number": 7,
      "chunk_id": "chunk_789"
    }
  ],
  "sources": [
    {
      "source_id": "chunk_789",
      "source_type": "retrieved_chunk",
      "document_id": "doc_123",
      "document_version_id": "ver_456",
      "title": "Smernice ... 1.0"
    }
  ],
  "warnings": [],
  "missing_information": null
}
```

Governance result nesmi byt povazovan za publikacni rozhodnuti. Publikace a zmena stavu dokumentu zustava v Registry API workflow.

---

## 8. IngestionJob

```json
{
  "job_id": "ing_123",
  "document_id": "doc_123",
  "document_version_id": "ver_456",
  "status": "queued",
  "source_file_uri": "s3://akl-documents/doc_123/ver_456/file.pdf",
  "parser_profile": "controlled_document",
  "ocr_enabled": true,
  "chunking_strategy": "legal_structured",
  "embedding_profile": "default",
  "created_at": "2026-06-05T10:00:00Z",
  "started_at": null,
  "finished_at": null
}
```

### Povolené ingestion status

```text
queued
running
completed
failed
cancelled
completed_with_warnings
```

---

## 9. IngestionReport

```json
{
  "job_id": "ing_123",
  "status": "completed_with_warnings",
  "documents_processed": 1,
  "pages_processed": 42,
  "chunks_created": 152,
  "tables_detected": 6,
  "ocr_used": false,
  "warnings": [
    {
      "code": "TABLE_LOW_CONFIDENCE",
      "message": "Tabulka na straně 12 byla extrahována s nízkou jistotou."
    }
  ],
  "errors": []
}
```

---

## 10. AuditEvent

```json
{
  "audit_event_id": "audit_123",
  "actor_id": "user_123",
  "event_type": "document.version.published",
  "resource_type": "document_version",
  "resource_id": "ver_456",
  "severity": "info",
  "correlation_id": "corr_123",
  "metadata": {
    "document_id": "doc_123"
  },
  "created_at": "2026-06-05T10:00:00Z"
}
```

---

## 11. EvalQuestion

```json
{
  "question_id": "q_123",
  "dataset_id": "dataset_456",
  "question": "Kdo schvaluje výjimku?",
  "expected_answer": "Výjimku schvaluje ...",
  "required_citations": [
    {
      "document_id": "doc_123",
      "document_version_id": "ver_456",
      "section_path": ["Čl. 4", "Odst. 2"]
    }
  ],
  "forbidden_sources": [],
  "difficulty": "medium",
  "answer_type": "normative"
}
```

---

## 12. Naming conventions

- ID prefixy:
  - `doc_`
  - `ver_`
  - `file_`
  - `chunk_`
  - `ing_`
  - `query_`
  - `audit_`
  - `eval_`
  - `gov_`
  - `cmp_`
  - `con_`
  - `val_`
- Časy ve formátu ISO 8601 UTC.
- Hash formát `sha256:<hash>`.
- URI objektového úložiště ve tvaru `s3://bucket/path`.
