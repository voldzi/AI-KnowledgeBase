# AKB Web Frontend - Screens

## Shell Layout

The AKB workspace shell uses the STRATOS shared navigation pattern:

- the global topbar stays visible at the top of the viewport
- the application rail and workspace submenu stay fixed while users scroll
- only the right-side workspace content area scrolls
- workspace content uses the full available width next to the submenu, with page padding inside the content area instead of centered max-width spacing

## Dashboard

Route: `/`

Content:

- metrics for valid documents, active ingestion, failed jobs and restricted documents
- recent controlled documents table
- ingestion and audit timeline
- service readiness notes

## Document Registry

Route: `/documents`

Content:

- table of documents
- status badges
- classification and owner
- tags
- links to detail and version history
- action visibility from authorization hints

## Document Detail

Route: `/documents/[documentId]`

Content:

- document metadata
- status, classification and tags
- current version
- version history
- linked ingestion status
- guided version panel with current state and recommended next step

## New Document And First Version

Route: `/documents/new`

Content:

- guided document creation and first-version upload flow
- quick choices for common document scenarios such as directive, methodology, policy, contract and project documentation
- inline question-mark help for officer-facing fields such as classification, gestor unit, version, reading mode and citation segmentation
- draft metadata form
- document type
- classification
- gestor unit
- original source file selection, SHA-256 calculation and upload preflight
- first version label fixed to `1.0`
- parser profile and chunking strategy
- submission creates document, stores source file, creates first version and queues ingestion
- success state guides the operator to open the document, track ingestion, upload the next version, or create another document
- save action disabled when document update or ingestion permission is denied

## Upload Wizard

Route: `/upload`

Content:

- document selector
- optional `document_id` query parameter preselects the document when upload starts from document detail
- guided version increment and validity
- inline question-mark help for file selection, document selection, version increment, validity, source location, reading mode, citation segmentation and guided change fields
- signed source URI
- parser profile
- chunking strategy
- guided change type, impact and next-step selectors that produce `change_summary`
- upload/process submission state

## Ingestion Status

Route: `/ingestion`

Content:

- user-facing processing status for document managers
- document title, localized status, reading method and processing result
- report metrics phrased as read pages and prepared citation segments
- technical job/version/profile identifiers hidden under an operations detail disclosure

## Knowledge Chat

Route: `/chat`

Content:

- AKB Assistant thread list
- new-thread action
- share-thread dialog
- chat transcript and composer
- answer panel in the active thread
- confidence badge
- warning/no-answer state
- right-side citation/source panel
- report artifact preview for table/report/Excel/PDF requests
- metadata inventory reports for document counts and lists by topic
- Excel and PDF export from bounded report artifacts
- citation viewer and direct source document opening

## Audit Viewer

Route: `/audit`

Content:

- event type
- severity
- actor
- resource
- correlation id
- created timestamp

## Admin Skeleton

Route: `/admin`

Content:

- service health cards
- role mapping placeholder
- OIDC setup placeholder
- policy hints placeholder

## Health

Routes:

- `/api/health`
- `/api/ready`
