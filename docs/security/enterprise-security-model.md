# Enterprise Security Model

Phase 04 keeps security centralized. Clients do not hold privileged service credentials and do not run local knowledge stores.

## Authentication

Local development can use dev auth. Enterprise pilot and production must use OIDC/SSO.

Expected identity inputs:

- user subject id,
- roles,
- groups,
- access token,
- request id,
- correlation id.

Service-to-service calls must preserve correlation headers and must not log full user questions, answers, source text, secrets, or access tokens.

## Roles

Initial role model:

- `employee`: can use Employee Chat Portal and open authorized sources.
- `reader`: can read allowed documents and ask sourced questions.
- `document_manager`: can create documents, versions, imports, and reindex jobs.
- `knowledge_admin`: can manage domains, metadata rules, and knowledge quality.
- `it_manager`: can access operational and managerial views.
- `auditor`: can inspect audit trails and governed evidence.
- `admin` / `global_admin`: can manage platform configuration.

## Authorization

Authorization is enforced in the backend, not in the browser.

RAG retrieval filters chunks through Registry authorization before answer composition. If sources are denied or insufficient, the assistant must return a no-answer or handoff state instead of inventing an answer.

Local real RAG profile uses:

```text
AKL_RAG_AUTHZ_MODE=dev
```

Enterprise pilot should move to Registry/OIDC backed authorization before employee rollout.

## Classification

Documents use:

- `public`,
- `internal`,
- `restricted`,
- `confidential`.

Employee Chat Portal defaults to `classification_max=internal` until enterprise policy maps roles and groups to higher classifications.

## Assistant Audit Events

The assistant workflow emits these event types:

- `assistant.question_asked`
- `assistant.clarification_requested`
- `assistant.answer_returned`
- `assistant.no_answer_returned`
- `assistant.handoff_recommended`
- `assistant.citation_opened`

Employee Chat Portal source opening uses `GET /api/v1/assistant/citations/{chunk_id}/open` and audits `assistant.citation_opened`. Admin/technical citation viewer flows can still use the generic `citation.opened` event.

Audit metadata may include hashes, counts, ids, confidence, warnings, and cited document ids. It must not store full question or answer text by default.

## Production Hardening Backlog

- Replace dev auth with OIDC in pilot.
- Add service credentials and audience-bound tokens for backend calls.
- Add audit review dashboards for no-answer, handoff, and source-opening events.

## Implemented Chat Security Controls

- Assistant conversations are persisted only with explicit ownership, default
  180-day retention, archive support, and user/group sharing records.
- Server-side web route guards redirect employee chat-only users away from
  knowledge-management and admin surfaces.
- Mutating web BFF routes for document administration, governance, workflow
  actions, upload preflight, and admin access require management/admin roles.
- Regression tests cover restricted and confidential document filtering for
  reader metadata reports so chat inventory answers cannot count or list
  documents outside the caller's AKB permissions.
