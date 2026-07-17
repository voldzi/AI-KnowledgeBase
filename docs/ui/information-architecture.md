# AKB Web Frontend - Information Architecture

## App Shell

Knowledge management users work in the persistent STRATOS-style shell. The
shell derives visible modules, submenu entries, Command Center destinations and
quick actions from the current role; the following list is the complete admin
set, not a menu shown to every user:

- Dashboard
- Tasks
- Documents
- Ingestion
- Knowledge chat
- Intelligence
- Audit
- Admin
- Help

The app shell is a work console, not a landing page. Command Center opens only
role-available sections and actions. The top-bar status uses dependency-aware
`/api/ready`, not process liveness alone.

The visual and interaction shell is provided by `@voldzi/stratos-ui@0.3.29`.
At mobile width the shared topbar trigger and bottom app rail open the workspace
drawer; at compact tablet width the left rail opens the same overlay; at desktop
width the sidebar is a persistent column. Close-button, backdrop, Escape, focus
return and popover layering are shared-library behavior rather than AKB CSS.

Employee chat-only users work in the standalone Employee Chat Portal at
`/chat`. This portal intentionally has no side menu or workspace submenu. It
keeps only a compact header with AKB identity, settings, and logout, so the
ordinary employee starts directly in the chat and can reach information through
natural language instead of navigating administrative modules.

## Primary Areas

### Dashboard

Purpose:

- summarize controlled document state
- surface active and failed ingestion jobs
- show audit activity
- remind users that authorization hints come from Registry API
- surface open workflow tasks and overdue blockers

### Tasks

Purpose:

- provide an organizational workflow inbox for document reviews, governance checks, ingestion warnings and audit signals
- show priority, owner/gestor responsibility, due date and source signal
- route users to the authoritative source screen for the task
- read persistent Registry API workflow tasks and merge in ingestion-owned operational warnings
- write Registry-owned task decisions through the workflow action endpoint

### Documents

Purpose:

- list controlled documents
- show type, status, classification, owner, gestor unit and tags
- link to detail and version history
- hide draft/upload actions when authorization hints deny them
- enable new-document creation only with no selected row and version upload
  only with exactly one selected document
- show the selected document by title, type and classification before a
  contextual action; technical IDs are not the primary visible value

### Document Detail

Purpose:

- show authoritative document metadata
- distinguish valid, draft, archived and superseded records
- show version labels, validity windows and change summaries
- show linked ingestion jobs
- show Registry workflow task history for the document
- expose publish/archive actions only when Registry state and authorization allow them

### Upload

Purpose:

- prepare a new version for an existing document
- require an explicit document selected in Registry or document detail; direct
  `/upload` navigation without `document_id` returns to Registry
- collect source file preflight metadata, signed source URI, parser profile and chunking strategy
- queue ingestion through Ingestion Service
- use shared `FileDropzone` while AKB owns all transport and domain decisions

### New Document

Purpose:

- guide operators through document metadata and the first source version in one process
- require one gestor and one distinct approver from the organization directory;
  both assignments are persisted with the Registry draft
- create the Registry document draft, store the original source, create version `1.0` and queue ingestion
- keep the first-version number predictable and remove the old handoff from `/documents/new` to `/upload`
- use the central AKB document type catalog, aligned with the Registry enum, as
  the single web-workflow source for type labels, classifications, tags and
  parser/chunking defaults

### Help

Purpose:

- provide in-app guidance for document managers, owners, gestors and auditors
- describe registry, upload, viewer, citation, workflow, governance and troubleshooting paths
- keep user guidance available without exposing implementation-only service details

### Intelligence Workbench

Route: `/intelligence`

Purpose:

- provide a TOVEK-like analytical work surface without changing existing AKB
  document, chat, STRATOS, citation or audit flows
- keep the global STRATOS shell short and split Intelligence into local
  submenu sections: Overview, Corpus, Search, Cases, Entities, Relationships
  and Quality
- show permission-scoped corpus metrics, Registry metadata facets, readiness
  issue distributions and issue samples
- expose advanced analyst search over authorized OpenSearch chunk payloads and
  links back to the authoritative document detail
- provide AKB Query Composer in the Search section so analysts can build
  structured OpenSearch queries from visual boxes/chips, permission-scoped
  suggestions, field aliases, entities and saved case queries
- show a live authorized hit estimate before execution and offer tested query
  broadening actions when the estimate is zero
- keep raw query syntax/mode/field controls under an advanced disclosure and
  keep entity-specific evidence search in the Entities section
- persist analyst cases, saved queries and selected evidence references through
  Registry API while keeping document records unchanged
- surface metadata-derived candidate entities, OpenSearch entity facets,
  cited evidence hits and evidence-backed relationship edges as steps toward
  graph, timeline, watchlist and case workflows
- keep all source review inside AKB document detail/viewer rather than
  duplicating source files or bypassing Registry authorization

### Retrieval Quality Lab

Route: `/intelligence/quality`

Purpose:

- keep retrieval evaluation in a dedicated Intelligence submenu instead of
  extending the already dense Workbench page
- create a private silver baseline from Registry-visible document titles
- run repeatable retrieval/citation evaluations with the current OIDC identity
- show quality-gate checks, regressions, role slices and failed-case diagnostics
- combine retrieval metrics with Registry corpus-readiness issues without
  treating draft metadata as a retrieval failure

### Ingestion

Purpose:

- show queued, running, completed, warning, failed and cancelled jobs
- show report metrics such as pages, chunks and warnings
- keep parser and chunking choices visible

### Knowledge Chat

Purpose:

- provide the ChatGPT/Copilot-like AKB Employee Chat Portal at `/chat`
- let users start, return to, archive, and share assistant threads
- load persisted conversation history from Registry API through the web BFF
- keep share-thread controls visible as the product path for collaborative work with retention policy
- ask RAG Retrieval Service for answers through the assistant API
- offer each indexed document title at most once in the suggested-question area,
  even when the retrieval index contains several versions or chunks of the same document
- show confidence, warnings and no-answer states inside the active thread
- display citations with document id, version id, section path, page and chunk id
- keep source-context and direct source-document opening available from the answer
- on mobile, place the composer before the transcript/suggestion area and keep
  the thread list behind an explicit thread-panel button

### Audit

Purpose:

- show metadata-level audit activity
- support auditor workflows without exposing sensitive document content in logs
- filter by text, event type and severity and export only the currently visible,
  already authorized event rows to CSV

### Admin

Purpose:

- search the organization directory and assign supported AKB roles
- activate or remove Registry-owned role mappings
- show current identity, role and status information without exposing OIDC
  secrets or Keycloak administrative credentials to the browser

## Role-Aware Navigation

| Role family | Primary visible areas |
| --- | --- |
| employee/reader | Knowledge chat, Help |
| reviewer | Dashboard, Tasks, Documents, Knowledge chat, Help |
| owner/gestor | Dashboard, Tasks, Documents, Knowledge chat, Help |
| document manager | Operations, Documents, Ingestion, Intelligence, Chat, Help |
| analyst | Dashboard, Documents, Intelligence, Chat, Help |
| auditor/service governance | Dashboard, Tasks, Documents, Intelligence, Audit, Chat, Help |
| admin | All areas including Administration |

Navigation visibility reduces cognitive load and prevents dead-end affordances.
It is not an authorization boundary. Page routes, web bridge routes and backend
services continue to enforce their own access checks.

Version upload is intentionally absent from the workspace navigation and
Command Center. It is a contextual document action enabled only for one
selected Registry record.

## Service Boundaries

The frontend never calls PostgreSQL, Qdrant, Ollama, vLLM or internal MinIO APIs. All data arrives through Registry API, Ingestion Service, RAG Retrieval Service, Evaluation Service or Governance Service.
