# Enterprise Architecture

Phase 04 positions AKL as a centrally operated knowledge platform for an organization such as CSU.

## Client Model

AKL clients are thin clients. Workstations must not run local LLMs, embedding models, Qdrant, PostgreSQL, or object storage.

Supported client forms:

- primary: intranet web application,
- optional: installable PWA,
- optional: desktop wrapper when workplace integration requires it.

The client is responsible for authentication handoff, rendering, search/chat forms, source viewing, and user-role presentation. All retrieval, permissions, model calls, vector search, ingestion, storage, and audit logging stay in the central AKL backend.

## Central Backend

The central backend owns:

- Document Registry and governed metadata,
- Ingestion Service and source parsing,
- RAG Retrieval Service and employee assistant API,
- LLM Gateway and model routing,
- Qdrant vector storage,
- PostgreSQL transactional storage,
- object storage for source files,
- audit and observability,
- backup and restore.

## Deployment Modes

### Local Development

- Docker Compose.
- Ollama on host.
- Qdrant, PostgreSQL, MinIO.
- dev auth.
- mock profile available for unit/dev-test workflows.

### Local Production

- Docker Compose with local-prod override.
- persistent volumes.
- backup/restore wrappers.
- real local RAG profile:
  - `gemma4:12b` chat model,
  - `bge-m3` embedding model,
  - Qdrant collection `akl_document_chunks` with 1024D Cosine vectors.

### Enterprise Pilot

- central VM/server or managed container host,
- reverse proxy with TLS,
- OIDC/SSO,
- persistent storage,
- role-based access,
- monitoring and log management,
- backup policy.

### Enterprise Production

Architectural target:

- HA PostgreSQL,
- managed object storage,
- Qdrant persistence or cluster,
- LLM runtime pool,
- model lifecycle governance,
- centralized observability,
- disaster recovery,
- hardened OIDC and service-to-service auth.

## Knowledge Domains

Phase 04 uses domain metadata on imported documents and keeps the model extensible:

- IT Governance,
- IT Operations,
- Service Desk,
- Applications,
- Infrastructure,
- Cybersecurity,
- M365 / Collaboration,
- Projects,
- Tasks,
- Data Governance,
- Internal Processes,
- Enterprise Architecture.

Minimum document metadata:

```text
document_type
classification
status
owner
area
domain
audience
language
source_system
source_path
tags
```

The `docs/import-manifest.yaml` manifest assigns `domain`, `area`, `audience`, and tags for the project documentation knowledge base.

## Dual GUI

AKL exposes two web surfaces:

- Knowledge Management/Admin GUI for document managers, knowledge admins, auditors, and IT managers.
- Employee Assistant GUI for employees.

The Employee Assistant GUI is intentionally plain-language. It must not expose implementation terms such as Qdrant, embeddings, chunks, or RAG in employee-facing copy. It asks clarifying questions for vague requests, returns cited answers when sources are sufficient, and recommends handoff when they are not.

Current route split:

- `/` and admin routes: Knowledge Management/Admin GUI.
- `/assistant`: Employee Assistant GUI.

## Assistant API

RAG Retrieval Service exposes:

- `POST /api/v1/assistant/chat`
- `POST /api/v1/assistant/clarify`
- `GET /api/v1/assistant/suggestions`
- `GET /api/v1/assistant/conversations/{conversation_id}`

Response types:

- `answer`,
- `clarification_needed`,
- `no_answer`,
- `restricted`,
- `handoff_recommended`.

Assistant conversation history is persisted in Registry API when available. RAG returns an explicit ephemeral status and warning only when the Registry history lookup or append fails.

## Chat As Organizational Source Of Truth

Target state: the AKB chat is the primary natural-language entry point over
the whole organization. It must answer across finance, contracts, internal
rules, laws, projects, infrastructure, and application documentation without
letting source applications copy binaries, extracted text, chunks, embeddings,
prompts, or RAG logic outside AKB.

Implementation roadmap:

1. Metadata truth layer:
   - Registry API owns exact document inventory, ownership, classification,
     tenant, source system, external entity context, lifecycle status, and audit.
   - Implemented first step: `GET /api/v1/documents/metadata-summary` returns
     permission-scoped aggregate summaries for chat inventory questions.
   - Implemented context step: the metadata summary and AKB web chat pass
     tenant, external system, entity, external ref, and context-tag filters so
     ProjectFlow, Budget, and future STRATOS apps can ask scoped inventory
     questions without copying documents out of AKB.
   - Next optimization: replace in-process aggregation with indexed SQL and
     materialized/search projections for large enterprise datasets.
2. Retrieval truth layer:
   - RAG answers content questions only from authorized chunks and citations.
   - Retrieval must support hybrid search, metadata filters, reranking, and
     strict no-answer policy when evidence is insufficient.
3. Domain intelligence layer:
   - Domain profiles for contracts, finance, project delivery, laws, internal
     policies, infrastructure, and application operations define expected fields,
     terminology, filters, and extraction profiles.
   - Structured outputs are proposed values or report artifacts, not writes to
     source systems without human confirmation.
4. Enterprise chat orchestration:
   - Route inventory/count/list questions to Registry metadata.
   - Route sourced interpretation questions to RAG.
   - Route structured extraction requests to controlled extraction profiles.
   - Route operational/status questions to approved service APIs or telemetry
     projections, never to direct infrastructure secrets.
5. Governance and trust:
   - Every answer must expose source type: registry metadata, cited RAG,
     extraction proposal, telemetry/status, or no-answer.
   - Audit must store correlation ids, source ids, counts, and hashes where
     needed; it must not store document bodies, prompts, answers, tokens, or
     secrets.
   - STRATOS applications remain thin clients and use shared AKB/Stratos UI
     components for viewer, upload, picker, status, citations, and reports.
