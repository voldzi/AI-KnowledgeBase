# Document Workbench Product QA

Validated: 2026-06-06.

## 1. Purpose

This runbook defines the product QA gate for Document Workbench before a PR is merged or a release is tagged. It focuses on organization-grade behavior: controlled upload, registry clarity, workflow control, citations, auditability, help content, failure handling, and predictable performance.

It is intentionally scoped to the current product direction. Old data migrations and legacy compatibility are not acceptance criteria.

## 2. QA Levels

### PR Smoke Gate

Run for every change that touches web UI, Registry API, ingestion, RAG retrieval, governance, upload flow, workflow tasks, or documentation that changes operating behavior.

Required evidence:

- commit SHA,
- branch and PR number,
- Docker profile used,
- result of automated CI checks,
- manual scenario result table,
- list of defects or accepted limitations.

### Release Candidate Gate

Run before a release tag.

Required evidence:

- all PR Smoke Gate evidence,
- screenshots or screen recordings for the critical document paths,
- browser and viewport matrix,
- performance observations,
- known production gaps confirmed against `docs/integration/PHASE_05_DOCUMENT_WORKBENCH.md`.

### Production Readiness Gate

Run before real organizational rollout.

Required evidence:

- release candidate evidence,
- role and permission review,
- restore rehearsal result,
- security configuration review,
- sign-off from product owner, platform owner, and document governance owner.

## 3. Test Environment

Use the Docker stack as the source of truth.

Recommended local profile:

```bash
docker compose --env-file .env.local-prod \
  -f infra/docker-compose/docker-compose.dev.yml \
  -f infra/docker-compose/docker-compose.local-prod.yml \
  up -d --build
```

Expected URLs:

- Web: `http://localhost:3002`
- Registry API: `http://localhost:8001`
- RAG Retrieval Service: `http://localhost:8082`
- LLM Gateway: `http://localhost:8083`
- Qdrant: `http://localhost:6333`

Do not validate against an extra non-Docker frontend instance on another port.

## 4. Test Data

Minimum required data set:

- one ordinary controlled document,
- one restricted or internal document,
- one draft document,
- one document in review,
- one approved document without a valid published version,
- one valid published version,
- one archived version,
- one ingestion warning or failed ingestion case,
- document assignments for owner, gestor, reviewer, approver and auditor,
- one workflow task assigned to a reviewer,
- one workflow task that requires changes.

Reusable fixture:

- `tests/fixtures/documents/controlled-document-sample.md`

Recommended imported corpus for local knowledge validation:

```bash
python3 tools/import_docs_folder.py \
  --source ./docs \
  --manifest docs/import-manifest.yaml \
  --mode reindex \
  --report reports/docs_import_report.json
```

## 5. Role Coverage

### Document Manager

Must be able to:

- create a draft document,
- upload source content through preflight,
- understand validation errors before ingestion starts,
- monitor ingestion state,
- maintain document responsibilities, SLA and escalation metadata,
- send the document into review,
- see the next required action from the detail page.

### Reviewer Or Owner

Must be able to:

- find assigned review work in `/tasks`,
- open the related document detail,
- request changes with a clear reason,
- approve the document,
- confirm that publish is blocked until approval exists.

### Auditor

Must be able to:

- inspect document state and version history,
- see workflow decisions,
- identify source file metadata and ingestion evidence,
- verify that restricted classifications are visible in the UI.

### Employee Knowledge User

Must be able to:

- ask a knowledge question,
- see citations,
- open a cited source context,
- understand when the system refuses to answer because citations are missing or confidence is insufficient.

## 6. Critical Scenarios

| ID | Area | Scenario | Acceptance Criteria |
| --- | --- | --- | --- |
| DW-01 | Registry | Open `/documents` with real data. | List renders without runtime errors, status metrics match visible data, filters do not reset unexpectedly. |
| DW-02 | Registry | Search and filter by status, type, and classification. | Results update predictably, empty states are explicit, active filters are visible. |
| DW-03 | Upload | Upload a supported document through preflight. | File name, MIME type, size, SHA-256 hash, session id, and upload token are produced before ingestion is requested. |
| DW-04 | Upload | Try an unsupported or inconsistent upload. | User sees a precise error and no draft version is silently published. |
| DW-05 | Ingestion | Start ingestion for uploaded content. | Draft version is created, ingestion job is visible, automatic publish does not happen. |
| DW-06 | Detail | Open `/documents/{documentId}`. | Overview, viewer, workflow, insights, versions, and ingestion sections render coherent data. |
| DW-07 | Viewer | Open source preview or citation context. | Source metadata is visible and the user can distinguish preview from full native viewer capability. |
| DW-08 | Workflow | Approve a review task from `/tasks`. | Registry API records the action, task state changes, document workflow state is reflected in detail. |
| DW-09 | Publish Gate | Try to publish before approval. | Publish is blocked with clear explanation. |
| DW-10 | Publish Gate | Publish an approved document version. | Version becomes valid, previous state is not ambiguous, action is auditable. |
| DW-11 | Archive | Archive a valid version. | Archive is allowed only for the current valid version and the resulting state is visible. |
| DW-12 | Governance | Trigger or inspect governance action panel. | Current limitation is clear; no fake success state is shown when service integration is not implemented. |
| DW-13 | Assignments | Inspect and update document responsibilities. | Owner/reviewer/approver/auditor roles, SLA and escalation metadata are visible and saved through Registry API. |
| DW-14 | RAG | Ask a question that should be answered from imported documents. | Answer includes citations and opens source context. |
| DW-15 | RAG | Ask a question outside the corpus. | System refuses or asks for clarification instead of inventing an answer. |
| DW-16 | Help | Open `/help`. | Help content covers quick start, roles, registry, upload, viewer, workflow, governance, chat, warnings, and errors. |
| DW-17 | Language | Switch language if available in the active UI context. | Help and main document surfaces use the same language context. |
| DW-18 | Error Handling | Stop or misconfigure one backend service. | Web UI reports degraded state without a blank page or misleading success. |
| DW-19 | Audit | Inspect audit-related surfaces. | Workflow decisions, assignment changes and document state changes are traceable to a source action. |

## 7. Viewport And Browser Matrix

Required before release tag:

| Surface | Desktop 1440px | Laptop 1280px | Tablet 768px | Mobile 390px |
| --- | --- | --- | --- | --- |
| `/documents` | Required | Required | Required | Required |
| `/documents/{documentId}` | Required | Required | Required | Required |
| `/upload` | Required | Required | Required | Required |
| `/tasks` | Required | Required | Optional | Optional |
| `/assistant` | Required | Required | Required | Required |
| `/help` | Required | Required | Required | Required |

Acceptance criteria:

- no overlapping text,
- no clipped primary actions,
- no card-in-card layout regressions,
- filters and tabs remain usable,
- long document names and task titles wrap without breaking layout.

## 8. Performance Expectations

Record observations on the Docker stack. Do not fail a PR only because local hardware is slower, but investigate any major regression against the previous release.

Baseline expectations for warm local runs:

- `/documents` interactive within 3 seconds,
- `/documents/{documentId}` interactive within 3 seconds for normal metadata payloads,
- client-side filter feedback within 250 ms for current page data,
- upload preflight starts immediately and keeps the UI responsive while hashing,
- API proxy errors return within 10 seconds with a clear message,
- no repeated polling loop that keeps the browser busy after leaving a page.

## 9. Accessibility And Usability Checks

Required checks:

- keyboard focus reaches primary navigation and page actions,
- buttons expose clear visible labels or recognizable icons with accessible labels,
- color is not the only signal for workflow state,
- error messages name the failed operation,
- destructive actions require clear intent,
- help content answers "what do I do next" for each core role.

## 10. Defect Severity

### Blocker

- data loss,
- unauthorized access,
- silent publish without approval,
- hallucinated answer presented as sourced fact,
- blank page on critical route,
- release CI failure.

### Major

- workflow task action fails without recoverable explanation,
- upload validation allows inconsistent metadata,
- citation opens wrong source context,
- important mobile layout blocks a primary action,
- performance regression above 2x previous release baseline.

### Minor

- confusing copy,
- non-critical alignment issue,
- optional filter edge case,
- missing screenshot evidence.

## 11. Release Sign-Off Template

Copy this block into the release notes or PR comment:

```text
Document Workbench QA

Date:
Commit:
PR:
Docker profile:
Browser:
Viewport coverage:
Imported data set:

Automated checks:
- CI:
- Web typecheck/test:
- Service tests:
- Compose config:

Manual scenarios:
- Passed:
- Failed:
- Not run:

Known limitations:

Decision:
- pass / pass with accepted limitations / block
```

## 12. Automation Backlog

Automated in `apps/web/e2e/document-workbench.spec.ts`:

- DW-01 registry render and filters.
- DW-06 document detail tabs.
- DW-08 workflow task approval.
- DW-09 publish gate blocked before approval.
- DW-13 cited RAG answer opens source context.
- DW-15 help center renders role-based guidance.

Run locally:

```bash
npm --prefix apps/web run test:e2e
```

Convert these scenarios to automated E2E tests first:

1. DW-03 upload preflight success.
2. DW-04 upload validation failure.
3. DW-07 viewer source metadata.
4. DW-12 governance limitation state.
5. DW-14 no-answer state outside the corpus.
6. DW-17 degraded backend error handling.
7. DW-18 audit traceability.

The current automated implementation runs against mocked web clients in CI. A second suite can later run against the Docker stack as a nightly or release-candidate gate.
