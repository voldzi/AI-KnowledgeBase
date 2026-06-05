# Phase 02 Controlled Document MVP

Validated on 2026-06-05.

## 1. Summary

Phase 02 adds the first real controlled-document path:

`Registry document/version -> Ingestion parsing/chunking -> LLM Gateway embeddings -> Qdrant indexing -> RAG retrieval from Qdrant -> answer with citation -> Registry audit`.

The Phase 01 smoke test still passes. The new Phase 02 smoke test validates a real indexed Markdown controlled document with article-level citation metadata.

## 2. Implemented Flow

- Registry API creates a document and version, then publishes the version.
- Ingestion Service reads the source file through the object-storage abstraction.
- Text parser recognizes Markdown headings such as `## Článek 2` as article sections.
- Chunker emits first-class Qdrant payload fields for title, version, type, tags, validity, and status.
- Ingestion indexes vectors and payloads into `akl_document_chunks`.
- RAG Retrieval uses Qdrant and Registry authz filtering before answer composition.
- Registry stores ingestion, RAG, and smoke completion audit events.

## 3. Real Ingestion Result

Smoke fixture: `tests/fixtures/documents/controlled-document-sample.md`

Latest smoke output:

```text
OK ingestion_job_id= ing_18e3a994d537458d99435afe0013fc18
OK chunks_created= 4
```

## 4. Qdrant Indexing Result

The smoke test verified 4 Qdrant points for the created version in collection `akl_document_chunks`.

Required top-level payload fields now include:

- `document_id`, `document_version_id`, `document_title`, `version_label`
- `document_type`, `classification`, `tags`, `status`
- `valid_from`, `valid_to`
- `section_path`, `section_title`, `article_number`, `paragraph_number`
- `text`, `normalized_text`, `text_hash`

## 5. RAG Retrieval Result

Latest smoke output:

```text
OK cited_chunk_id= chunk_f936674c5d06eedc492de5d5c4a15f22
OK answer_confidence= medium
```

The query was:

```text
Kdo schvaluje výjimku ze směrnice?
```

The returned citation pointed to the run-created document and Article 2 chunk.

## 6. LLM Provider Result

Validated smoke path used LLM Gateway over HTTP with the mock provider:

- embeddings: `mock-embedding`
- chat: `mock-chat`

The non-mock Ollama profile is documented in `docs/deployment/llm-profiles.md`. It is configuration-ready, but this run did not validate pulled Ollama models.

## 7. Web Workflow Result

Web baseline now has real API-backed workflow points:

- `/documents/new` creates Registry document metadata through `/api/controlled-document/documents`.
- `/upload` creates and publishes a version, then queues ingestion through `/api/controlled-document/ingestion`.
- `/ingestion` reads real ingestion jobs via `GET /api/v1/ingestion/jobs`.
- `/chat` submits RAG queries through `/api/controlled-document/query`.

The frontend still uses source URIs rather than direct browser file upload.

## 8. Auth/AuthZ Result

- Dev mode propagates `X-AKL-Subject` and `X-AKL-Roles` from the web API client.
- Ingestion calls Registry `/authz/check` for `document.ingest`.
- RAG calls Registry `/authz/filter-documents` for `rag.query`.
- Registry now allows document owners to run `rag.query` on their own documents.
- OIDC remains a configurable profile; full browser login/token refresh is not completed in this phase.

## 9. Smoke Test Result

Commands run:

```bash
python3 scripts/phase_01_smoke.py
python3 scripts/phase_02_controlled_document_smoke.py
npm test
npm run typecheck
```

Results:

- Phase 01 smoke: passed.
- Phase 02 smoke: passed.
- Web tests: 11 passed.
- Web typecheck: passed after cleaning stale `.next/dev` generated files.

Host Python did not have `pytest` installed, so Python unit tests were not run through `pytest` in this shell. Python syntax checks passed for touched services.

## 10. Issues Found

| ID | Severity | Area | Description | Proposed Fix |
|---|---|---|---|---|
| P2-001 | P1 | AuthZ | RAG `rag.query` filtering initially denied owner-created Phase 01 documents. | Added owner permission for `rag.query`. Add explicit regression tests when pytest is available. |
| P2-002 | P1 | Frontend | Production Registry client expected arrays, while Registry returns list envelopes. | Fixed production client unwrapping for documents, versions, and audit events. |
| P2-003 | P1 | Frontend | Upload and chat screens were preview-only. | Added internal web API bridge routes and client submit handlers. |
| P2-004 | P2 | Tooling | Local Python environment lacks pytest. | Use service containers or install dev dependencies before running Python unit tests locally. |
| P2-005 | P2 | LLM | Ollama profile is documented but not model-validated in this run. | Pull documented models and run a non-mock smoke pass. |

## 11. Remaining Open Points

- Add CI-ready Python pytest execution for all services.
- Add browser-level Playwright verification for the web workflow.
- Add direct file upload/signed upload flow; current web workflow expects an existing source URI.
- Validate Ollama embeddings/chat with a fresh Qdrant collection sized for the selected embedding model.
- Complete OIDC login and token propagation from the browser session.

## 12. Recommendation for Phase 03

Phase 03 should focus on hardening the MVP path: browser-level workflow tests, real upload storage, non-mock model validation, OIDC enforcement, and regression evaluation over a small controlled-document dataset.
