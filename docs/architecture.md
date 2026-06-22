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
| `apps/web` | Next.js web frontend, AKB web/API bridge, auth callback handling, document viewer, employee chat portal, and admin workspace. |
| `services/registry-api` | Document registry, versions, assignments, authorization checks, external document references, workflow tasks, audit events. |
| `services/ingestion-service` | Ingestion jobs, source parsing, OCR fallback, logical chunking, embeddings, Qdrant indexing, ingestion reports. |
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
- Keycloak/STRATOS OIDC is the enterprise identity provider.

## Core Data Flow

```text
browser -> AKB web bridge -> Registry API
browser -> AKB web bridge -> upload session -> AKB object storage
Registry document/version -> Ingestion Service -> parser/OCR/chunker
Ingestion Service -> LLM Gateway embeddings -> Qdrant
question -> RAG Retrieval Service -> Registry authz -> Qdrant -> LLM Gateway
citation/source open -> AKB web bridge/viewer -> signed AKB source endpoint
```

## Service Boundaries

- Registry does not parse documents, create embeddings, call LLMs, or write to
  Qdrant.
- Ingestion does not publish document versions or answer RAG queries.
- RAG does not mutate document registry state except audit events.
- LLM Gateway does not own retrieval, authorization, document storage, or UI.
- Web/API bridge mediates browser access; browser clients do not call internal
  storage, Registry, Ingestion, Qdrant, or LLM services directly unless the
  route is an approved AKB public bridge.

## Authentication And Authorization

Local development can use mock/dev auth. Production and STRATOS integration use
OIDC/service tokens. Authorization is enforced by AKB backend services, not by
STRATOS host applications or browser-only checks.

Detailed security model: `docs/security.md` and
`docs/security/enterprise-security-model.md`.

## Deployment Model

Local development and production-like deployment use Docker Compose. Production
on `docker.home.cz` is documented under `docs/deployment/`.

Detailed architecture references:

- `docs/ARCHITECTURE/01_ARCHITEKTURA_DISTRIBUOVANYCH_SLUZEB.md`
- `docs/ARCHITECTURE/02_SERVICE_BOUNDARIES.md`
- `docs/ARCHITECTURE/enterprise-architecture.md`
- `docs/integration/STRATOS_EXTERNAL_DOCUMENTS_API.md`
- `docs/29_STRATOS_SHARED_LIBRARIES.md`
