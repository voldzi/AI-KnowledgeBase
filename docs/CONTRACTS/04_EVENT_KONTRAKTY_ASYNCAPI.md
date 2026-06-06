# Event kontrakty — AsyncAPI návrh

Odkaz na centrální zadání: `../00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

Tento dokument definuje asynchronní události mezi službami.

---

## 1. Obecný formát eventu

```json
{
  "event_id": "evt_123",
  "event_type": "document.version.published",
  "event_version": "1.0",
  "occurred_at": "2026-06-05T10:00:00Z",
  "producer": "registry-api",
  "correlation_id": "corr_123",
  "payload": {}
}
```

---

## 2. Doporučený mechanismus

Použít:

- PostgreSQL outbox table v Registry API,
- polling worker nebo jednoduchý event dispatcher,
- později nahraditelné message brokerem.

---

## 3. Eventy Registry API

### document.created

```json
{
  "event_type": "document.created",
  "payload": {
    "document_id": "doc_123",
    "title": "Směrnice ...",
    "document_type": "directive",
    "classification": "internal"
  }
}
```

### document.version.created

```json
{
  "event_type": "document.version.created",
  "payload": {
    "document_id": "doc_123",
    "document_version_id": "ver_456",
    "source_file_uri": "s3://..."
  }
}
```

### document.version.published

```json
{
  "event_type": "document.version.published",
  "payload": {
    "document_id": "doc_123",
    "document_version_id": "ver_456",
    "valid_from": "2026-07-01",
    "valid_to": null
  }
}
```

### document.version.archived

```json
{
  "event_type": "document.version.archived",
  "payload": {
    "document_id": "doc_123",
    "document_version_id": "ver_456",
    "archived_at": "2026-06-05T10:00:00Z"
  }
}
```

---

## 4. Eventy Ingestion Service

### ingestion.job.created

```json
{
  "event_type": "ingestion.job.created",
  "payload": {
    "job_id": "ing_123",
    "document_id": "doc_123",
    "document_version_id": "ver_456"
  }
}
```

### ingestion.job.completed

```json
{
  "event_type": "ingestion.job.completed",
  "payload": {
    "job_id": "ing_123",
    "document_id": "doc_123",
    "document_version_id": "ver_456",
    "chunks_count": 152,
    "warnings_count": 2
  }
}
```

### ingestion.job.failed

```json
{
  "event_type": "ingestion.job.failed",
  "payload": {
    "job_id": "ing_123",
    "document_id": "doc_123",
    "document_version_id": "ver_456",
    "error_code": "PARSER_FAILED",
    "error_message": "Document parser failed."
  }
}
```

---

## 5. Eventy RAG Retrieval Service

### rag.query.executed

```json
{
  "event_type": "rag.query.executed",
  "payload": {
    "query_id": "query_123",
    "subject_id": "user_123",
    "answer_mode": "normative_with_citations",
    "used_chunks_count": 6,
    "confidence": "high"
  }
}
```

### rag.no_answer

```json
{
  "event_type": "rag.no_answer",
  "payload": {
    "query_id": "query_123",
    "subject_id": "user_123",
    "reason": "insufficient_source"
  }
}
```

---

## 6. Eventy Evaluation Service

### evaluation.run.completed

```json
{
  "event_type": "evaluation.run.completed",
  "payload": {
    "run_id": "eval_123",
    "dataset_id": "dataset_456",
    "total_questions": 100,
    "citation_accuracy": 0.89,
    "answer_correctness": 0.84
  }
}
```

---

## 7. Eventy Governance Service

### governance.conflict.detected

```json
{
  "event_type": "governance.conflict.detected",
  "payload": {
    "conflict_id": "conf_123",
    "document_ids": ["doc_1", "doc_2"],
    "severity": "medium",
    "summary": "Dokumenty uvádějí rozdílný schvalovací postup."
  }
}
```

### document.validity.expiring

```json
{
  "event_type": "document.validity.expiring",
  "payload": {
    "document_id": "doc_123",
    "document_version_id": "ver_456",
    "valid_to": "2026-12-31",
    "days_remaining": 30
  }
}
```

---

## 8. Event versioning

Eventy jsou verzované přes `event_version`.

Breaking change vyžaduje:

- novou verzi eventu,
- souběžnou podporu staré a nové verze po přechodnou dobu,
- migration note.
