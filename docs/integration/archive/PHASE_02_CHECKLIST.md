# Phase 02 Controlled Document MVP Checklist

## Baseline

- [x] Phase 01 smoke test preserved
- [x] Phase 01 smoke test passes after Phase 02 changes
- [x] Services remain independently deployable
- [x] No direct cross-service database access added

## Controlled Document Flow

- [x] Registry document creation works
- [x] Registry document version creation works
- [x] Document version can be published before ingestion
- [x] Test fixture exists at `tests/fixtures/documents/controlled-document-sample.md`
- [x] Ingestion reads the fixture through the object-storage abstraction
- [x] Markdown controlled-document article headings are parsed
- [x] Chunks are created from real document text
- [x] Embeddings are created through LLM Gateway HTTP profile in the integration stack
- [x] Chunks are indexed into Qdrant
- [x] Qdrant payload contains citation and filter metadata
- [x] RAG retrieval reads from Qdrant
- [x] RAG answer returns at least one citation from the created document
- [x] Registry audit event is written for the RAG query
- [x] Smoke completion audit event is written

## Contracts

- [x] Ingestion job list endpoint added: `GET /api/v1/ingestion/jobs`
- [x] Ingestion job response includes source/profile fields for web status views
- [x] Qdrant payload fields promoted to top-level chunk fields
- [x] Ingestion OpenAPI regenerated
- [x] Contract changes documented in Phase 02 docs

## Web

- [x] Document creation page calls real API through web route
- [x] Upload page creates/publishes version and queues ingestion through web route
- [x] Ingestion page reads job status from Ingestion Service
- [x] Chat page submits RAG query through web route
- [x] Production Registry client unwraps Registry list envelopes
- [x] Dev auth subject/roles propagate through web API client headers

## LLM Profiles

- [x] Mock provider remains available for CI/dev
- [x] HTTP LLM Gateway profile used for smoke embeddings and chat
- [x] Ollama profile documented
- [ ] Ollama model pull and non-mock smoke validated

## Auth/AuthZ

- [x] Ingestion calls Registry `/authz/check`
- [x] RAG calls Registry `/authz/filter-documents`
- [x] RAG uses `rag.query` action for document filtering
- [x] Document owner can run `rag.query` on owned documents
- [x] OIDC configuration boundaries documented
- [x] Ingestion/RAG/LLM support explicit `oidc` bearer-required mode
- [x] Caller bearer token is propagated to Registry authz calls
- [x] Registry audit writes can use service-account token fallback
- [x] Registry self-checks ignore request-body role escalation
- [ ] Full browser OIDC login flow implemented

## Verification

- [x] `python3 scripts/phase_01_smoke.py`
- [x] `python3 scripts/phase_02_controlled_document_smoke.py`
- [x] `npm test`
- [x] `npm run typecheck`
- [x] Python syntax checks for touched services
- [ ] Python pytest suite run in local shell
