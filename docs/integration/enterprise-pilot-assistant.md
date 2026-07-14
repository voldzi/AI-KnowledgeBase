# Phase 04 CSU Enterprise Knowledge Platform

Phase 04 prepares AKB for an enterprise pilot as a central knowledge platform with one employee-facing chat portal and a knowledge-management workspace:

- Knowledge Management/Admin GUI,
- Employee Chat Portal.

## Implemented Scope

- Central backend architecture documented for local development, local production, enterprise pilot, and enterprise production.
- Knowledge domain metadata added to `docs/import-manifest.yaml`.
- `tools/import_docs_folder.py --dry-run` validates and plans governance metadata
  from the manifest; governed application import persists it into Registry.
- RAG Retrieval Service exposes Employee Chat backend API endpoints:
  - `POST /api/v1/assistant/chat`
  - `POST /api/v1/assistant/clarify`
  - `GET /api/v1/assistant/suggestions`
  - `GET /api/v1/assistant/conversations/{conversation_id}`
  - `GET /api/v1/assistant/citations/{chunk_id}/open`
- Registry API persists chat history and sharing:
  - `POST /api/v1/assistant/conversations/{conversation_id}/messages`
  - `GET /api/v1/assistant/conversation-history`
  - `GET /api/v1/assistant/conversation-history/{conversation_id}`
  - `PATCH /api/v1/assistant/conversation-history/{conversation_id}`
  - `PUT /api/v1/assistant/conversation-history/{conversation_id}/shares`
- Employee Chat Portal supports:
  - suggested questions,
  - clarifying questions for vague access, incident, and approval requests,
  - cited answers,
  - handoff recommendation when source support is insufficient,
  - source opening from employee UI,
  - persisted threads with default 180-day retention, archive, and user/group sharing.
- Web UI route `/chat` provides the standalone Employee Chat Portal for ordinary
  users without side menu. Knowledge-management users can still access broader
  AKB workspace routes.
- Legacy route `/assistant` redirects to `/chat` for compatibility.
- Web UI has a global Czech/English language switcher. The Employee Chat Portal passes the selected language to RAG through `response_language`.
- Admin/knowledge-management routes remain available under `/`, `/documents`, `/upload`, `/ingestion`, `/chat`, `/audit`, and `/admin`.

## Assistant Request Example

```bash
curl -sS http://localhost:8082/api/v1/assistant/chat \
  -H 'Content-Type: application/json' \
  -H 'X-AKL-Subject: user_dev' \
  -H 'X-AKL-Roles: admin,document_manager,reader' \
  -d '{
    "user_id": "user_dev",
    "message": "Potřebuji přístup.",
    "context": {"domain": "IT", "user_role": "employee"},
    "response_language": "cs"
  }'
```

Expected response type for the vague request:

```text
clarification_needed
```

English answer/clarification example:

```bash
curl -sS http://localhost:8082/api/v1/assistant/chat \
  -H 'Content-Type: application/json' \
  -H 'X-AKL-Subject: user_dev' \
  -H 'X-AKL-Roles: admin,document_manager,reader' \
  -d '{
    "user_id": "user_dev",
    "message": "I need access.",
    "context": {"domain": "IT", "user_role": "employee"},
    "response_language": "en"
  }'
```

## Audit Events

Implemented assistant events:

- `assistant.question_asked`
- `assistant.clarification_requested`
- `assistant.answer_returned`
- `assistant.no_answer_returned`
- `assistant.handoff_recommended`
- `assistant.citation_opened`

Full question and answer text is not stored in audit metadata by default. Message/answer hashes, citation counts, confidence, warning ids, and cited document ids are acceptable audit metadata.

## Commands

Legacy Phase 01/02 and importer-backed Phase 03 mutation regressions are
retired in every environment. Seed and mutate pilot documents through the
governed application UI/API, then run read-only assistant, citation, and web
checks. No environment/auth override or bearer enables the retired host flows.

Run the Phase 04 Employee Chat smoke:

```bash
python3 scripts/phase_04_employee_assistant_smoke.py
```

Run web checks:

```bash
cd apps/web
npm test
npm run typecheck
```

Run RAG service tests:

```bash
python -m pytest services/rag-retrieval-service/tests
```

## Enterprise Pilot Readiness

Phase 04 is pilot-ready for local and controlled internal evaluation when:

- OIDC is configured for web and service access.
- Registry authorization replaces dev auth for employee users.
- imported documents have reviewed `domain`, `audience`, `classification`, and owner metadata.
- backup/restore is tested against local-prod persistent volumes.
- monitoring captures assistant no-answer, handoff, source-opening, and latency metrics.

## Remaining Production Work

- Add administrative domain management UI.
- Add insight persistence and approval workflow.
- Add native PDF/Office/table viewers beyond extracted text context.
- Add enterprise load tests for parallel assistant queries.
- Harden service credentials, TLS, and SSO group mappings.
