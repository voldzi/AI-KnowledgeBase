# Production UI Plan

The Web UI is organized as a local production work surface for knowledge and document operations.

Phase 04 adds a dual GUI model:

- Employee Assistant for employees at `/assistant`.
- Knowledge Management/Admin GUI for document managers, knowledge admins, auditors, and IT/admin roles.

## Implemented Baseline

### Language

- The application has a global Czech/English switcher.
- Selected language is stored in the browser and updates the shell, admin work surfaces, Employee Assistant, and Knowledge Chat labels.
- Employee Assistant and Knowledge Chat send `response_language` to RAG so answers are generated in the selected language.
- Source excerpts remain in the original source language and are not translated by the viewer.

### Knowledge Chat

- Default scope is `akl-docs` for imported project documentation.
- `project_documentation` is included in default document types.
- Citations are clickable.
- Clicking a citation opens the source-context panel.
- The source-context panel shows:
  - document title,
  - version id,
  - source URI,
  - viewer mode,
  - section path,
  - page if known,
  - exact chunk text,
  - warnings such as missing source metadata.

### Employee Assistant

- Route: `/assistant`.
- Plain-language employee surface.
- Suggested questions are loaded from `GET /api/v1/assistant/suggestions`.
- Questions are sent through `POST /api/v1/assistant/chat`.
- Clarifying answers continue through `POST /api/v1/assistant/clarify`.
- Source opening uses `GET /api/v1/assistant/citations/{chunk_id}/open`.
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

For Markdown/text sources it displays the extracted source paragraph/chunk. For PDF/DOCX it shows the extracted text context and source metadata; richer native previews remain future work.

### Document Workbench

Phase 05 introduces the Document Workbench direction:

- `/documents` now supports registry metrics, search, filters, and work views.
- Document detail is split into overview, viewer, workflow, insights, versions, and ingestion sections.
- Upload has file preflight metadata, SHA-256 calculation, a signed upload session, browser PUT upload and then the workflow request.
- `/help` provides in-app help for document managers, owners/gestors, and auditors.

The current upload bridge stores the source object in shared local object storage, creates a draft version and queues ingestion. Publishing is separated behind the Registry API approval state and publish gate.

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
- Knowledge Chat: answer modes, filters, citations, warnings, export.
- Employee Assistant: simple chat, clarifying questions, cited answers, handoff.
- Citation Viewer: source context and source metadata.
- Document Insights: obligations, risks, roles, deadlines, FAQ, checklist.
- Local AI Models: provider/model inventory and pull/test actions.
- System Health: service readiness and dependency health.
- Audit Log: searchable event stream.
- Settings: local profile and safe configuration state.
- Help: role-based usage guidance, document workflow, viewer/citation behavior, governance checks, and troubleshooting.

## Viewer Roadmap

- Markdown/text: rendered Markdown, raw text, highlighted chunk, section jump.
- PDF: browser PDF preview, page jump, text-side citation panel, OCR bbox when available.
- DOCX/ODT/RTF: extracted structured text and optional HTML preview.
- HTML: sanitized preview with highlighted chunk.
- CSV/XLS/XLSX: sheet/table context.
- PPT/PPTX: slide text and preview when available.
- Images/scans: original image plus OCR text and bbox highlighting.
