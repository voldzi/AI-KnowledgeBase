# AKB Web Frontend - Screens

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

## New Document Draft

Route: `/documents/new`

Content:

- draft metadata form
- document type
- classification
- gestor unit
- save action disabled when `document.update` is denied

## Upload Wizard

Route: `/upload`

Content:

- document selector
- version label and validity
- signed source URI
- parser profile
- chunking strategy
- guided change type, impact and next-step selectors that produce `change_summary`
- upload/process submission state

## Ingestion Status

Route: `/ingestion`

Content:

- ingestion jobs table
- document mapping
- parser and chunking profiles
- report metrics
- cancel action for running jobs

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
