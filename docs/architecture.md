# AKB Architecture

AKB is the Document AI backend for controlled documents and STRATOS knowledge
workflows. It owns document metadata, versions, source-file references,
ingestion, extraction, chunking, embeddings, Qdrant indexing, retrieval,
citations, source opening, governance helpers, and audit events.

## Product Boundary

AKB is the source of truth for Document AI assets and evidence. STRATOS
applications such as ProjectFlow and Budget remain the source of truth for
their business entities, but they must reference AKB for documents, ingestion,
RAG, citations, and source previews.

Existing `AKL_*` environment variables and selected service identifiers remain
technical compatibility prefixes unless an explicit migration changes them.

## Main Components

| Component | Responsibility |
| --- | --- |
| `apps/web` | Next.js web frontend, AKB web/API bridge, auth callback handling, document viewer, employee chat portal, Intelligence Workbench, and admin workspace. |
| `services/registry-api` | Document registry, versions, assignments, authorization checks, external document references, workflow tasks, audit events, permission-scoped document readiness aggregates, and Intelligence analyst cases with saved queries/evidence references. |
| `services/ingestion-service` | Ingestion jobs, source parsing, OCR fallback, logical chunking, embeddings, Qdrant/OpenSearch indexing, ingestion reports. |
| `services/rag-retrieval-service` | Permission-aware retrieval, answer composition, source context, citation opening, employee chat APIs. |
| `services/llm-gateway-service` | LLM provider routing, model management, chat completions, embeddings. |
| `services/evaluation-service` | RAG quality evaluations, datasets, runs, reports. |
| `services/governance-service` | Version comparison, compliance checks, conflict detection, KB draft proposals, validity alerts. |
| `services/platform-infrastructure` | Operational health, readiness, metrics, and shallow dependency checks. |

## Data Stores

- PostgreSQL stores registry, workflow, audit, evaluation, and governance data.
- Object storage stores document sources, upload-session files, previews, and
  ingestion artifacts. Local and production-like profiles map `s3://` URIs to
  configured storage roots; production targets SeaweedFS/S3-compatible storage.
- Qdrant stores indexed chunk vectors and citation payload metadata.
- The centrally operated OpenSearch 3.7 cluster stores the same chunks through
  the managed `akl_document_chunks` alias as a BM25/fulltext index for exact titles,
  document numbers, sections, abbreviations, Czech lexical recall, Intelligence
  entity facets, analyst search and evidence-backed relationship exploration.
  It is rebuildable from Qdrant/canonical AKB data. Production ingestion uses a
  write-only role where appropriate, RAG uses a read-only role, and both verify
  TLS with the mounted cluster CA. See
  `docs/OPERATIONS/central-opensearch.md`.
- Keycloak/STRATOS OIDC is the enterprise identity provider.

## Core Data Flow

```text
browser -> AKB web bridge -> Registry API
browser -> AKB web bridge -> upload session -> AKB object storage
approved official collection -> allowlisted discovery -> immutable AKB version -> Ingestion Service
Registry document/version write -> STRATOS GovernedInformationResource registration
Registry document/version -> Ingestion Service -> parser/OCR/chunker
Ingestion Service -> LLM Gateway embeddings -> Qdrant
Ingestion Service -> OpenSearch fulltext index
question -> RAG Retrieval Service -> Registry authz -> Qdrant/OpenSearch -> LLM Gateway
citation/export -> Registry fresh version/scope/policy decision -> STRATOS policy decision
citation/source open -> AKB web bridge/viewer -> signed AKB source endpoint
intelligence workbench -> AKB web route -> Registry metadata/readiness/case APIs
intelligence workbench -> AKB web bridge -> Ingestion OpenSearch intelligence endpoints
director copilot -> AKB orchestrator -> authorized read-only STRATOS domain tools -> evidence snapshot -> answer/artifact
```

## Portable Knowledge Bundles

AKB supports a STRATOS profile for Open Knowledge Format as a portable
Markdown/YAML concept layer. OKF bundles can describe policies, processes,
contracts, metrics, systems, runbooks, API concepts, risks, and decisions while
AKB remains the authority for controlled source files, versions, authorization,
ingestion, citations, and audit.

Profile and tooling details: `docs/integration/STRATOS_OKF_PROFILE.md`.

## Service Boundaries

- Registry does not parse documents, create embeddings, call LLMs, or write to
  Qdrant/OpenSearch.
- Registry may derive corpus readiness reports from metadata, assignments,
  policies, versions, source hashes, external ingestion status, and quality
  flags. These reports are governance evidence; they do not inspect document
  bodies.
- Intelligence Workbench is an analytical surface in `apps/web` over
  permission-scoped Registry document lists, metadata summaries, readiness
  aggregates, analyst-owned cases, saved queries, evidence references, and
  Ingestion-owned OpenSearch Intelligence endpoints. It does not mutate
  controlled document records, versions or source files, and it does not
  replace RAG/citation workflows.
- Ingestion does not publish document versions or answer RAG queries.
- RAG does not mutate document registry state except audit events.
- Director Copilot does not read source databases. The AKB server calls fixed,
  deterministic and read-only Budget/ProjectFlow application endpoints with
  separate service and actor credentials. It accepts only closed contracts,
  normalizes authorized facts into an immutable evidence snapshot and uses the
  source-provided context tags for dependent AKB retrieval. The assistant
  planner supports both the governed Budget + ProjectFlow + contract-risk
  correlation and a ProjectFlow-only live portfolio status intent. Explicit
  ProjectFlow questions, natural project-status questions and contextual
  follow-ups are routed to the source tool before the document router. Missing
  source access, disabled federation or source failure is reported explicitly;
  a live-data question is never silently answered from historical documents.
- LLM Gateway does not own retrieval, authorization, document storage, or UI.
- Web/API bridge mediates browser access; browser clients do not call internal
  storage, Registry, Ingestion, Qdrant, or LLM services directly unless the
  route is an approved AKB public bridge.
- Official public-source collection discovery and download also remain inside
  the web backend. The browser selects only a code-reviewed collection and a
  discovered candidate; it cannot expand the host allowlist or provide a
  trusted storage URI. See `docs/ingestion/official-public-sources.md`.

## Authentication And Authorization

Local development can use mock/dev auth. Production and STRATOS integration use
OIDC/service tokens for verified identity. User authorization is loaded from
the current STRATOS access projection and delegated service operations use the
central STRATOS policy decision endpoint. Authorization is enforced by AKB
backend services, not by static token claims, client headers, STRATOS host
applications, or browser-only checks.

Every new policy-bearing document and immutable version is registered in the
central governed-resource lineage before the local write completes. The scope
must already exist. A service caller must supply a validated delegated actor;
`akb:upload` does not imply `akb:assign_policy`, and failed registration aborts
the write rather than creating readable pending content.

Detailed security model: `docs/security.md` and
`docs/security/enterprise-security-model.md`.

## Deployment Model

Local development and production-like deployment use Docker Compose. Production
on `docker.home.cz` is documented under `docs/deployment/`.

Detailed architecture references:

- `docs/ARCHITECTURE/01_ARCHITEKTURA_DISTRIBUOVANYCH_SLUZEB.md`
- `docs/ARCHITECTURE/02_SERVICE_BOUNDARIES.md`
- `docs/ARCHITECTURE/enterprise-architecture.md`
- `docs/ARCHITECTURE/professional-knowledge-chat-plan.md`
- `docs/ARCHITECTURE/director-copilot-implementation-plan.md`
- `docs/ARCHITECTURE/standalone-chat-pwa.md`
- `docs/integration/STRATOS_EXTERNAL_DOCUMENTS_API.md`
- `docs/29_STRATOS_SHARED_LIBRARIES.md`
