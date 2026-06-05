# Registry API

`services/registry-api` implementuje Identity & Document Registry API pro AKL Platform.

## Rozsah

Implementováno:

- Document registry.
- DocumentVersion registry.
- DocumentFile datový model pro evidenci URI a file metadat.
- DocumentAccessPolicy datový model a vyhodnocení.
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

- Web Frontend používá `/documents`, `/versions` a auditní list.
- Ingestion Service čte metadata dokumentů a může zapisovat auditní události.
- RAG Retrieval Service volá `/authz/filter-documents` a zapisuje auditní události.
- Evaluation a Governance služby používají registry metadata, authorization check a audit.

Služby nesmí importovat interní Python kód registry API; komunikace je přes REST/OpenAPI.

## OpenAPI

Statický kontrakt služby je v:

```text
services/registry-api/openapi.yaml
```

Runtime kontrakt:

```text
GET /openapi.json
```
