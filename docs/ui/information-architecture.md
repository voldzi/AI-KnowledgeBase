# AKB Web Frontend - Information Architecture

## App Shell

Knowledge management users work in the persistent STRATOS-style shell:

- Dashboard
- Tasks
- Documents
- Upload
- Ingestion
- Knowledge chat
- Audit
- Admin
- Help

The app shell is a work console, not a landing page. Search, health state and timezone live in the top bar.

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
- collect source file preflight metadata, signed source URI, parser profile and chunking strategy
- queue ingestion through Ingestion Service

### New Document

Purpose:

- guide operators through document metadata and the first source version in one process
- create the Registry document draft, store the original source, create version `1.0` and queue ingestion
- keep the first-version number predictable and remove the old handoff from `/documents/new` to `/upload`

### Help

Purpose:

- provide in-app guidance for document managers, owners, gestors and auditors
- describe registry, upload, viewer, citation, workflow, governance and troubleshooting paths
- keep user guidance available without exposing implementation-only service details

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
- show confidence, warnings and no-answer states inside the active thread
- display citations with document id, version id, section path, page and chunk id
- keep source-context and direct source-document opening available from the answer

### Audit

Purpose:

- show metadata-level audit activity
- support auditor workflows without exposing sensitive document content in logs

### Admin

Purpose:

- skeleton for role mappings, OIDC setup and policy hints
- make production safety boundaries visible

## Service Boundaries

The frontend never calls PostgreSQL, Qdrant, Ollama, vLLM or internal MinIO APIs. All data arrives through Registry API, Ingestion Service or RAG Retrieval Service.
