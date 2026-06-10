# Registry API

`services/registry-api` implementuje Identity & Document Registry API pro AKL Platform.

## Rozsah

Implementováno:

- Document registry.
- DocumentVersion registry.
- DocumentFile datový model pro evidenci URI a file metadat.
- DocumentAccessPolicy datový model a vyhodnocení.
- DocumentAssignment datový model pro owner/gestor/reviewer/approver/auditor/steward role, SLA a eskalace.
- Authorization check a bulk filter API.
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

POST   /authz/check
POST   /authz/filter-documents

POST   /audit/events
GET    /audit/events
GET    /audit/events/{event_id}
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
- Ingestion Service čte metadata dokumentů a může zapisovat auditní události.
- RAG Retrieval Service volá `/authz/filter-documents` a zapisuje auditní události.
- Evaluation a Governance služby používají registry metadata, authorization check a audit.
- Workflow inbox bere odpovednost, SLA a eskalacni metadata z `document_assignments`, pokud jsou pro dokument nastavena.

Služby nesmí importovat interní Python kód registry API; komunikace je přes REST/OpenAPI.

## Canonical Sources

```text
services/registry-api/README.md
services/registry-api/openapi.yaml
GET /openapi.json
```
