# Production UI Plan

The Web UI is organized as a local production work surface for knowledge and document operations.

Phase 04+ uses one employee-facing chat portal and a separate knowledge-management
workspace:

- Employee Chat Portal for ordinary users at `/chat`.
- `/assistant` is a legacy compatibility route that redirects to `/chat`.
- Knowledge Management/Admin GUI for document managers, knowledge admins, auditors, and IT/admin roles.

## Implemented Baseline

### Language

- The application has a global Czech/English switcher.
- Selected language is stored in the browser and updates the shell, admin work surfaces, and Employee Chat Portal labels.
- Employee Chat Portal sends `response_language` to RAG so answers are generated in the selected language.
- Source excerpts remain in the original source language and are not translated by the viewer.

### Employee Chat Portal

- Route: `/chat`.
- Primary AKB Assistant surface for user-owned threads, thread switching, citation review, and share-thread controls.
- Default scope is all authorized knowledge. Imported project documentation uses the `akb-docs` tag when the local docs import manifest is used.
- `project_documentation` is included in default document types.
- Suggested questions are loaded from `GET /api/v1/assistant/suggestions`.
- Questions are sent through `POST /api/v1/assistant/chat`.
- Clarifying answers continue through `POST /api/v1/assistant/clarify`.
- Citations are clickable.
- Clicking a citation opens the source-context panel.
- The document action opens the original signed source document through the assistant citation redirect.
- For PDF sources, the redirect includes the cited page and a search phrase from the citation text so supported PDF viewers can highlight the cited text; exact bbox/text-layer highlighting remains available in the AKB source-context/native preview.
- Thread sharing is represented in the UI as session-local working state until a dedicated backend sharing contract is added.
- On tablet/mobile breakpoints, the shared shell hamburger is a true open/close toggle. A closed workspace submenu must be visually hidden, non-interactive and not reachable through keyboard focus.
- The source-context panel shows:
  - document title,
  - version id,
  - source URI,
  - viewer mode,
  - section path,
  - page if known,
  - exact chunk text,
  - warnings such as missing source metadata.
- The employee UI avoids implementation terms such as RAG, chunk, Qdrant, embeddings, retriever, and model provider.
- The assistant can return:
  - answer,
  - clarification needed,
  - no answer,
  - restricted,
  - handoff recommended.

### Citation Viewer

The Citation Viewer now represents the first Document Viewer increment:

```text
RAG answer -> citation -> open citation -> source-context -> exact chunk text
```

Markdown sources render as formatted documents with GFM tables, a generated contents panel and citation highlighting. Text, CSV, JSON and XML sources display safe extracted content. PDF sources render the cited page through the STRATOS-compatible `StratosPdfViewer`, backed by pdf.js with text/bbox highlighting. DOCX/XLSX/XLSM/PPTX sources currently use structured extraction rather than pixel-perfect Office rendering.

### Document Workbench

Phase 05 introduces the Document Workbench direction:

- `/documents` now supports registry metrics, search, filters, and work views.
- Registry create/version actions are contextual: create is available with no
  selection, while version upload requires exactly one selected document.
- Document detail is split into overview, viewer, workflow, insights, versions, and ingestion sections.
- `/documents/new` guides operators through metadata plus the first source file in one process, then creates version `1.0` and queues ingestion.
- New documents require exactly one gestor and one distinct approver selected
  through the shared organization directory workflow component. Registry
  persists both assignments and their audit metadata atomically with the draft.
- `/upload` accepts an explicit `document_id`; it never asks the user to choose
  a second document after the action was started from Registry or detail.
- Upload has file preflight metadata, SHA-256 calculation, a signed upload session, browser PUT upload and then the workflow request.
- Both native AKB upload flows use the shared `FileDropzone`. AKB still owns
  preflight, object transfer, confirm, ingestion, classification, DLP and audit.
- `/help` provides in-app help for document managers, owners/gestors, and auditors.

The current upload bridge stores the source object in shared local object storage, creates a draft version and queues ingestion. Publishing is separated behind the Registry API approval state and publish gate.

Upload preflight accepts common document source types: PDF, DOC/DOCX, XLSX/XLSM, PPTX, Markdown/text/CSV/JSON/XML/HTML/XHTML, RTF and main web image formats. Full ingestion extraction is implemented for PDF, DOCX, XLSX/XLSM, PPTX, HTML, Markdown/text/CSV/JSON/XML and image/OCR fallback. Legacy binary `.doc/.xls/.ppt` files still need a conversion layer before they can be treated as first-class indexed sources.

Imported external corpora should preserve original sources. The Markdown folder importer remains a Markdown importer; where Markdown files are derivatives of raw PDFs, `tools/import_original_pdf_versions.py` migrates available raw PDFs into current controlled source versions after ingestion succeeds.

### STRATOS UI Integration

AKB consumes `@voldzi/stratos-ui@0.3.29` from the public npm registry. The
application shell imports `AppShell`, `AppRail`, `GlobalTopbar`,
`useRailSectionSidebarController`, `WorkspaceSidebar`, `WorkspaceNav`,
`CommandCenterTrigger`, `GlobalTopbarBreadcrumb` and `TopbarStatusGroup`
directly. Local code owns only role filtering, routing, labels and commands.

The shared stylesheet owns shell layout, compact and mobile breakpoints,
drawer, backdrop, focus management, topbar popovers and mobile bottom rail.
AKB does not maintain local copies or CSS repairs for these behaviors. Small
adapters remain only where a feature-level props API differs from the shared
component. Other shared imports include `CommandCenter`, `SelectField`,
`SettingsSurface`, `SurfaceModeMenu`, `DataTable`, `HelpHint`,
`FieldLabelWithHelp`, `AccessAuditList`, `AccessEffectiveMatrix`,
`GovernanceIssueList`, `StratosPdfViewer`, and the single root import of
`@voldzi/stratos-ui/styles.css`.

Document workflows additionally use `FileDropzone` and
`WorkflowParticipants`. AKB supplies localized role definitions, controlled
assignments and permission-scoped `DirectorySubjectOption` records; the shared
library owns selection, drag/drop, validation presentation and directory UI.

Governance findings are operational/admin oversight data. AKB renders them with
`GovernanceIssueList` in document governance surfaces and keeps the executive
dashboard focused on aggregate workflow status, not detailed findings. The
global shell uses the shared `GlobalTopbarBreadcrumb` and
`CommandCenterTrigger`; responsive sidebar state follows the `AppShell`
`inert` contract so closed overlay navigation cannot receive focus.

### Workflow Inbox

The first organizational workflow increment adds `/tasks`:

- dashboard surfaces open workflow task count and overdue blockers,
- navigation includes `Tasks / Úkoly`,
- tasks are deterministically derived from document status, classification, ingestion state and audit severity,
- Registry API now provides persistent workflow task list/action endpoints for document, governance and audit tasks,
- filters cover priority, status and task type,
- task detail links back to the document workbench, ingestion board or audit viewer,
- Registry-owned tasks can be assigned, returned for changes, approved or resolved from the inbox,
- document workflow tab shows task history for the selected document,
- document workflow tab exposes publish only for `approved` documents and archive only for the current `valid` version.

Ingestion-owned operational tasks are still merged in the web layer until Ingestion Service publishes task signals into Registry API. The backend contract supports `publish` and `archive`; UI exposure is guarded by document/version state and Registry authorization hints.

## Target Screens

- Dashboard: counts, health, model status, imports, recent queries, ingestion errors.
- Tasks: workflow inbox for reviews, governance checks, ingestion warnings and audit signals.
- Documents: search and filters by type, status, classification, area.
- Document Detail: metadata, versions, ingestion report, chunks, citations, insights, relations, audit.
- Upload / Import Wizard: preflight, signed upload session and import flow.
- Ingestion Jobs: job state, reports, warnings, errors.
- Employee Chat Portal: answer modes, filters, citations, warnings, export, clarifying questions, cited answers, handoff.
- Citation Viewer: source context and source metadata.
- Document Insights: obligations, risks, roles, deadlines, FAQ, checklist.
- Local AI Models: provider/model inventory and pull/test actions.
- System Health: service readiness and dependency health.
- Audit Log: searchable event stream.
- Settings: local profile and safe configuration state.
- Help: role-based usage guidance, document workflow, viewer/citation behavior, governance checks, and troubleshooting.

## Viewer Roadmap

- Markdown/text/JSON/XML: rendered Markdown or safe raw text, highlighted chunk, section jump.
- PDF: STRATOS-compatible pdf.js citation-page render, page jump, text-side citation panel, source-location bbox overlay and text-layer highlighting when available.
- DOCX/ODT/RTF: extracted structured text and optional HTML preview.
- HTML: sanitized preview with highlighted chunk.
- CSV/XLSX/XLSM: sheet/table context.
- PPTX: slide text and preview when available.
- Images/scans: original image plus OCR text and bbox highlighting.
- Legacy `.doc/.xls/.ppt`: conversion or parser integration before first-class ingestion/rendering.
