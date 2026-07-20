# RAG Retrieval Service API

`services/rag-retrieval-service` owns retrieval, answer composition, source-context opening, citation opening, and the employee chat API.

## Scope

Implemented:

- retrieval,
- cited answer generation,
- source context lookup,
- citation opening,
- employee chat, clarification, suggestions, and conversation lookup.
- STRATOS contract extraction proposal API for `contract_financial_v1`.
- STRATOS ArchFlow goal extraction proposal API for
  `archflow_goal_extraction_v1`.
- scoped RAG over STRATOS-compatible external documents, including
  `external_system: "STRATOS_AIIP"` documents once they are authorized and
  indexed.

Contract stubs still present:

- compare documents,
- compliance check.

Out of scope:

- ingestion,
- document registry persistence,
- embedding creation during ingestion,
- governance decision authority.

## Base Path

```text
/api/v1
```

Health/readiness stay outside the versioned prefix.

## Endpoints

```text
POST /api/v1/rag/retrieve
POST /api/v1/rag/query
POST /api/v1/rag/answer
POST /api/v1/rag/compare-documents
POST /api/v1/rag/check-compliance

GET  /api/v1/chunks/{chunk_id}/source-context
GET  /api/v1/citations/{chunk_id}/open

POST /api/v1/assistant/chat
POST /api/v1/assistant/clarify
GET  /api/v1/assistant/suggestions
GET  /api/v1/assistant/conversations/{conversation_id}
GET  /api/v1/assistant/citations/{chunk_id}/open

GET  /api/v1/stratos/extractions/profiles
POST /api/v1/stratos/extractions/contracts/propose
POST /api/v1/stratos/extractions/archflow-goals/propose
GET  /api/v1/stratos/extractions/{extraction_id}
POST /api/v1/stratos/extractions/{extraction_id}/feedback

GET  /health
GET  /ready
```

`/api/v1/assistant/chat` and `/api/v1/assistant/clarify` return the standard
assistant answer contract. For report, table, overview, Excel, PDF, or export
requests, the response may include `report_artifacts`. These artifacts are
bounded table specifications with row-level citations. The AKB web BFF exports
them as `.xlsx` or `.pdf` via `POST /api/assistant/reports/export`.
The web BFF may enrich valid artifacts to `artifact_contract_version:
"report.v2"` with artifact kind, provenance, quality, and row `source_refs`.
Content artifacts require row-level citations before they are shown or exported.

Inventory-style document questions are handled by the AKB web BFF before RAG
when the question can be answered from Registry API metadata, for example
counts, lists, or type breakdowns. Those responses include metadata breakdowns
by topic, document type, classification, owner/steward, and status. They use
the same assistant response and `report_artifacts` shape, but carry
`answer_source: "registry_metadata_summary"` when backed by `GET
/api/v1/documents/metadata-summary`, use `artifact_kind:
"registry_metadata_table"`, carry no chunk citations, and remain view-only
until an immutable metadata-snapshot export contract exists.

## STRATOS Contract Extractions

`POST /api/v1/stratos/extractions/contracts/propose` extracts cited proposed
contract parameters for Budget & Contract. The first supported profile is
`contract_financial_v1`, profile version `2`. It is intentionally conservative:

- it retrieves only authorized chunks through Registry API authz,
- it returns only `proposed` field values,
- it returns each cited payment clause as an independent structured
  `payment_rules` item; call-off and time-and-material clauses without confirmed
  planned drawdown never request automatic cashflow,
- it uses adapter-stable amount/VAT bases and timing enums; unknown VAT basis or
  timing stays explicitly `UNSPECIFIED`,
- `ON_CALL` and `UNSPECIFIED` rules never request automatic cashflow, and event
  rules require a cited ISO `due_date` before they may do so,
- every field proposal includes a citation with `document_id`,
  `document_version_id`, `chunk_id`, page/section where available,
  `quoted_text`, and `viewer_url`,
- when evidence is insufficient, the response is `PARTIAL` with
  `missing_information`/`warnings`, not invented values,
- persistence and feedback are stored through Registry API
  `document_extractions` and `document_extraction_feedback`.

For rolling deployments the endpoint also accepts profile version `1` and
advertises both versions in `GET /api/v1/stratos/extractions/profiles`.
Version `1` keeps its original `payment_frequency`, `recurring_amount`,
`one_time_amount` and `payment_schedule` response. Version `2` is the current
contract for new Budget callers. Because `profile_version` is part of extraction
idempotency, requesting both versions for the same document does not overwrite
either result.

Budget remains the source of truth for structured contract entities. AKB never
writes Budget tables directly; Budget accepts, edits, or rejects proposals after
authorized human confirmation and sends feedback through
`POST /api/v1/stratos/extractions/{extraction_id}/feedback`.

## STRATOS ArchFlow Goal Extractions

`POST /api/v1/stratos/extractions/archflow-goals/propose` extracts cited
proposals for ArchFlow goals, capabilities, obligations, requirements, metrics,
legal or methodological basis, and risks. The supported profile is
`archflow_goal_extraction_v1`.

`POST /api/v1/stratos/extractions/architecture-package/propose` extracts cited
review findings for architecture packages. The supported profile is
`architecture_package_review_v1`.

`POST /api/v1/stratos/extractions/architecture-handover/propose` extracts cited
handover and as-built evidence. The supported profile is
`architecture_handover_v1`.

The endpoint is deliberately proposal-only:

- it retrieves only authorized chunks through Registry API authorization,
- it accepts `external_system: "STRATOS_ARCHFLOW"` and never `source_system`,
- it supports `ArchitectureArtifact`, `ArchflowSourceSet`,
  `ArchflowGoalCatalogVersion`, and `ArchflowNeed` contexts,
- it filters by `tenant_id`, `external_system`, `entity_type`,
  `artifact_type`, and `context_tags` supplied by ArchFlow,
- it returns only `proposed` values with citations,
- every proposal includes `document_id`, `document_version_id`, `chunk_id`,
  page/section where available, a short `quoted_text`, and a viewer URL,
- when evidence is insufficient, the response is `PARTIAL` with warnings such
  as `INSUFFICIENT_CITABLE_ARCHFLOW_GOAL_EVIDENCE`,
  `INSUFFICIENT_CITABLE_ARCHITECTURE_PACKAGE_EVIDENCE`,
  `INSUFFICIENT_CITABLE_ARCHITECTURE_HANDOVER_EVIDENCE`, or
  `TARGET_DOCUMENT_NOT_RETRIEVED`,
- persistence and feedback use the shared Registry API
  `document_extractions` and `document_extraction_feedback` tables.

ArchFlow stores only references:

- `tenant_id`,
- `external_system = STRATOS_ARCHFLOW`,
- `entity_type`, `entity_id`, and optional `need_id`,
- `external_ref`, for example
  `archflow-need:<needId>:architecture-artifact:<artifactId>`,
- `document_id`, `document_version_id`, canonical AKB URL and citation URL,
- `artifact_type`, `review_status`, `baseline_status`, and `context_tags`.

Supported architecture artifact types are:

- `TARGET_ARCHITECTURE`
- `SOLUTION_ARCHITECTURE`
- `INTEGRATION_SPEC`
- `DATA_SECURITY_ASSESSMENT`
- `ARCHITECTURE_DECISION`
- `AS_BUILT_ARCHITECTURE`
- `HANDOVER_PACKAGE`

ArchFlow remains the source of truth for final goals, requirements, and
relationships. It writes final records only after authorized human confirmation
and then sends `accepted`, `edited`, or `rejected` feedback through
`POST /api/v1/stratos/extractions/{extraction_id}/feedback` with
`source_app: "STRATOS_ARCHFLOW"`.

AKB remains the only Document AI backend. ArchFlow must not store binary
documents, extracted text, chunks, embeddings, prompts, or RAG/LLM output copies
outside AKB.

## Integration Notes

- Filters candidate documents through Registry API authorization.
- Calls LLM Gateway for answer generation and embeddings.
- Reads chunks from Qdrant-compatible retrieval backends.
- Provides the source-context and citation-open contract consumed by Employee Chat Portal.
- Persists STRATOS extraction proposals and feedback through Registry API; the
  source app receives only metadata and cited proposals, never binary content,
  extracted full text, chunks, embeddings, or prompts.

## Canonical Sources

```text
services/rag-retrieval-service/README.md
services/rag-retrieval-service/openapi.yaml
GET /openapi.json
```
