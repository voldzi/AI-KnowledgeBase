# Registry API

`services/registry-api` implementuje Identity & Document Registry API pro AKB Platform.

## Rozsah

Implementováno:

- Document registry.
- DocumentVersion registry.
- DocumentFile datový model pro evidenci URI a file metadat.
- DocumentAccessPolicy datový model a vyhodnocení.
- DocumentAssignment datový model pro owner/gestor/reviewer/approver/auditor/steward role, SLA a eskalace.
- Authorization check a bulk filter API.
- Perzistentní Intelligence analyst cases, saved queries a evidence sety.
- AuditEvent API a interní auditní body.
- Health/readiness, jednotný error envelope a correlation id.

Neimplementováno:

- ingestion joby,
- parsing/OCR/chunking,
- embeddingy,
- RAG retrieval,
- LLM volání,
- zápis do Qdrantu.

## Base path

```text
/api/v1
```

## Endpointy

```text
POST   /documents
GET    /documents
GET    /documents/{document_id}
PATCH  /documents/{document_id}
DELETE /documents/{document_id}

GET    /documents/{document_id}/assignments
PUT    /documents/{document_id}/assignments

POST   /documents/{document_id}/versions
GET    /documents/{document_id}/versions
GET    /documents/{document_id}/versions/{version_id}
POST   /documents/{document_id}/versions/{version_id}/publish
POST   /documents/{document_id}/versions/{version_id}/archive
PATCH  /documents/{document_id}/external-references/current

POST   /authz/check
POST   /authz/filter-documents

GET    /intelligence/cases
POST   /intelligence/cases
GET    /intelligence/cases/{case_id}
PATCH  /intelligence/cases/{case_id}
POST   /intelligence/cases/{case_id}/saved-queries
POST   /intelligence/cases/{case_id}/evidence

POST   /audit/events
GET    /audit/events
GET    /audit/events/{event_id}

GET    /user-profiles/me/settings
PUT    /user-profiles/me/settings
```

`GET /audit/events` podporuje filtry `actor_id`, `event_type`, `resource_type`, `resource_id`, `limit` a `offset`.

`GET /health` a `GET /ready` jsou mimo verzovaný prefix.

## Chyby

Chybová odpověď odpovídá centrálnímu kontraktu:

```json
{
  "error": {
    "code": "forbidden",
    "message": "no role grants action document.create",
    "details": {
      "max_classification": "public"
    },
    "trace_id": "corr_123"
  }
}
```

`trace_id` je `X-Correlation-ID`, případně `X-Request-ID`.

## Integrační body

- Web Frontend používá `/documents`, `/versions`, `/workflow/tasks`, `/documents/{document_id}/assignments` a auditní list. Detail dokumentu filtruje auditní události podle resource id a metadat dokumentu/verze/tasku.
- Ingestion Service čte metadata dokumentů, zapisuje auditní události a přes
  `/documents/{document_id}/external-references/current` synchronizuje poslední
  job i stavy `INGESTING`, `INDEXED` a `FAILED` do všech odpovídajících
  externích referencí stejné verze.
- RAG Retrieval Service volá `/authz/filter-documents` a zapisuje auditní události.
- Evaluation a Governance služby používají registry metadata, authorization check a audit.
- Workflow inbox bere odpovednost, SLA a eskalacni metadata z `document_assignments`, pokud jsou pro dokument nastavena.
- Intelligence Workbench ukládá analytické spisy, uložené dotazy a evidence
  sety přes `/intelligence/cases`. Evidence ukládá odkazy na
  `document_id`, `document_version_id`, `chunk_id`, stránku/sekci a bounded
  snippet; nemění dokumentové záznamy ani zdrojové soubory.
- RAG Retrieval Service uklada STRATOS Document AI navrhy do
  `/document-extractions` a nasledny feedback do
  `/document-extractions/{extraction_id}/feedback`.
- AKB web bridge uklada sdilene STRATOS profilove nastaveni do
  `/user-profiles/me/settings`. Hodnoty jsou rozdelene na `settings.core` a
  `settings.apps.akb`; role a skupiny se vraci read-only z aktualni identity a
  nejsou autoritou ulozenych nastaveni.

Služby nesmí importovat interní Python kód registry API; komunikace je přes REST/OpenAPI.

## Document Extraction Persistence

Registry API stores extraction results as generic AKB records. It does not run
retrieval, OCR, chunking, embedding, or LLM logic.

```text
POST /api/v1/document-extractions
GET  /api/v1/document-extractions/{extraction_id}
POST /api/v1/document-extractions/{extraction_id}/feedback
```

Identity is idempotent over:

```text
tenant_id + external_system + external_ref + document_id + document_version_id + profile + profile_version
```

When a new `document_version_id` is stored for the same tenant/external ref,
older non-final extractions are marked `SUPERSEDED`. Feedback decisions update
the extraction status to `ACCEPTED_IN_SOURCE_APP` for `accepted`/`edited` and
`REJECTED_IN_SOURCE_APP` for `rejected`. The source app still owns final writes
to its own domain model.

## Canonical Sources

```text
services/registry-api/README.md
services/registry-api/openapi.yaml
GET /openapi.json
```
