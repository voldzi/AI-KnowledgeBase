# AKB Architecture

Portable architecture, runtime inventory and the supported-mode boundary for a
foreign installation are documented in
`docs/deployment/external-environment-architecture.md`. The current supported
production mode is integrated with STRATOS identity/access/policy; the local
development profile is not an autonomous production security profile.

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

Before a document question enters RAG, the web bridge deterministically maps
ordinary employee language to a bounded document task such as procedure,
resource, support channel, owner, responsibility, deadline, obligation, or
policy lookup. The task selects an existing citation-bound answer mode and
retrieval-only vocabulary expansion. It never changes authorization or source
precedence: Registry and Information Policy still select the allowed current or
historically effective versions, and only retrieved chunks may support the
answer. Task state can continue across a referential follow-up and page reload,
but a self-contained new topic resets it.

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
- Registry document lists and ordinary metadata summaries load only the
  relationships required for authorization and display. Version/publication
  collections are loaded for readiness and RAG authorization paths that need
  them. Metadata-topic search builds each document search representation once
  per request and reuses it across requested topics.
- Intelligence Workbench is an analytical surface in `apps/web` over
  permission-scoped Registry document lists, metadata summaries, readiness
  aggregates, analyst-owned cases, saved queries, evidence references, and
  Ingestion-owned OpenSearch Intelligence endpoints. It does not mutate
  controlled document records, versions or source files, and it does not
  replace RAG/citation workflows.
- Ingestion does not publish document versions or answer RAG queries.
- RAG does not mutate document registry state except audit events.
- Director Copilot does not read source databases. The AKB server calls
  deterministic and read-only source-application endpoints with
  separate service and actor credentials. It accepts only closed contracts,
  normalizes authorized facts into an immutable evidence snapshot and uses the
  source-provided context tags for dependent AKB retrieval. The assistant
  planner uses a versioned semantic catalog, a closed machine-readable domain
  tool/metric/relation catalog and a bounded
  `ConversationQueryState` for source, metric, period, requested operation
  (`summary`, `list`, `count`, `rank`), per-source granularity, grouping,
  ordering and narrowing entity filters. The planner composes approved domain concepts and inflected
  aliases rather than enumerating complete user sentences. Source ownership
  disambiguates generic terms, and generated positive and negative routing
  matrices guard the catalog. Routing itself is deterministic and does not
  require an LLM. V2 discovers the exact source-owned tool surface from
  schema-validated, revision-pinned manifests for Budget, ProjectFlow and
  ArchFlow. ArchFlow owns both needs and submitted ideas. It correlates only
  byte-identical canonical identities or typed
  manifest relationships and never calculates source-owned financial totals.
  When a question spans several domains, the selected Budget, ProjectFlow and
  ArchFlow nodes execute concurrently and receive their own entity shape; for
  example, a need-project-finance question requests needs from ArchFlow and
  project-level facts from ProjectFlow and Budget. Synthesis joins a need to a project only
  through `archflow.need.linked_project`, joins Budget and ProjectFlow only by
  their byte-identical `stratos:project:*` identity, and presents a ProjectFlow
  document relation only after independent AKB document authorization.
  Requested data shape is independent from authorization coverage: an
  organization-wide grant can authorize item-level results without converting
  an item question into an organization aggregate. AKB verifies the returned
  entity type before presentation and fails closed on a shape mismatch. The
  continuation state focuses an entity only when the source returned exactly
  one candidate or a complete, comparable ranking produced one winner. Broad
  lists never become dozens of implicit filters on the next turn. Before any
  live answer is rendered, an evidence gate checks source revision and time,
  candidate completeness, item and fact provenance, declared relationships,
  requested entity shape and operation-specific count/rank guarantees. The
  query state never carries authorization;
  every turn reloads the current STRATOS access projection and every source
  applies its local PEP. Explicit live-data questions and contextual follow-ups
  are routed before the document router. Missing source access, an unconnected
  ArchFlow tool, disabled federation or source failure is reported
  explicitly; a live-data question is never silently answered from historical
  documents.
- Live-source answer sections expose the authorized scope, complete versus
  partial result shape, source timestamp and safe detail links. Lists disclose
  displayed versus matching counts. Desktop support panels are resizable and
  collapsible; compact layouts use focus-safe drawers so navigation and source
  context do not reduce the transcript to an unusable column.
- A compound management question is decomposed into bounded source questions
  before execution. Each node carries its own operation, period, metric,
  granularity and source scope, so a count requested from Budget cannot change
  a ProjectFlow summary in the same turn. The global conversation state remains
  only the bounded continuation state. Nodes still perform their own fresh
  authorization and evidence checks. Current live-source data older than seven
  days remains attributable but is shown with a visible staleness warning.
- Director Copilot V2 is the sole live-data path after joint production
  acceptance. A slow, failed, denied or contract-drifting source returns its
  explicit V2 result and cannot be substituted by document RAG. The runtime
  does not retain a V1 baseline, shadow comparison or fallback execution path.
- Assistant planning separates source selection from the user's answer goal.
  Analytical goals may run the pinned live-data tools and authorized document
  retrieval concurrently, but their evidence is rendered in separate sections.
  Document citations cannot supply a missing live value, and live facts cannot
  become an uncited recommendation, causal claim or scenario calculation.
- The semantic catalog is enriched by an immutable local SSP snapshot with
  source attribution and a content SHA-256. The full imported vocabulary is
  context only. Only separately reviewed concept bindings may influence a
  STRATOS source or metric, and those bindings cannot carry identity,
  capabilities, scopes, classifications or Information Policy decisions.
  Production query processing never calls the public SSP endpoint. See
  `docs/OPERATIONS/semantic-registry.md`.
- LLM Gateway does not own retrieval, authorization, document storage, or UI.
- Web/API bridge mediates browser access; browser clients do not call internal
  storage, Registry, Ingestion, Qdrant, or LLM services directly unless the
  route is an approved AKB public bridge.
- Official public-source collection discovery and download also remain inside
  the web backend. The browser selects only a code-reviewed collection and a
  discovered candidate; it cannot expand the host allowlist or provide a
  trusted storage URI. See `docs/ingestion/official-public-sources.md`.
- Temporal controlled documentation combines immutable document versions into
  effective-dated packages. Registry owns the source hierarchy, human-reviewed
  cited rules and conflict-safe consumer projection; RAG only proposes cited
  rules from exact authorized versions. Chat and application consumers use the
  same `valid_on` semantics and default to the current effective state. See
  `docs/ARCHITECTURE/temporal-controlled-documentation.md`.

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
- `docs/ARCHITECTURE/standalone-chat-pwa.md`
- `docs/integration/STRATOS_EXTERNAL_DOCUMENTS_API.md`
- `docs/29_STRATOS_SHARED_LIBRARIES.md`
# Object storage

Production document binaries use the native S3 adapter against the internal
SeaweedFS gateway. Registry remains the metadata and authorization authority;
S3 is never exposed directly to browsers. Local filesystem mode remains for
development and rollback. The migration and compatibility model is documented
in [Central S3 Object Storage](OPERATIONS/central-s3-object-storage.md).
