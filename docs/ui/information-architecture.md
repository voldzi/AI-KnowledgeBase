# AKB Web Frontend - Information Architecture

## App Shell

Persistent navigation:

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

- prepare a new document version
- collect source file preflight metadata, signed source URI, parser profile and chunking strategy
- queue ingestion through Ingestion Service

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

- ask RAG Retrieval Service for answers
- show confidence
- show warnings and no-answer states
- display citations with document id, version id, section path, page and chunk id

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
