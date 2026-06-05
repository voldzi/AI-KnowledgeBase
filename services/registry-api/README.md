# AKL Identity & Document Registry API

Samostatná FastAPI služba pro evidenci řízených dokumentů, verzí, metadat, access policies, authorization check a auditní události.

Služba neparsuje dokumenty, nevytváří embeddingy, nevolá LLM, neodpovídá na RAG dotazy a nezapisuje do Qdrantu. URI originálních souborů pouze eviduje.

## Odpovědnost

- Registry dokumentů a verzí dokumentů.
- Metadata, stav, platnost, klasifikace, vlastník a gestor.
- Document-level access policies.
- Authorization check API pro frontend, ingestion, RAG, evaluation a governance služby.
- Audit API a interní auditní body pro změny dokumentů a verzí.
- Health/readiness endpointy a correlation id.

## Lokální spuštění

```bash
cd services/registry-api
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
export AKL_ENV=development
export AKL_AUTH_MODE=mock
export AKL_DATABASE_URL=sqlite+pysqlite:///./registry.db
export AKL_AUTO_CREATE_SCHEMA=true
uvicorn app.main:app --reload
```

Produkční a sdílené prostředí má používat PostgreSQL:

```bash
export AKL_DATABASE_URL=postgresql+psycopg://registry_api:...@postgres:5432/registry_api
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Konfigurace

| Proměnná | Význam |
|---|---|
| `AKL_ENV` | `development`, `test`, nebo `production`. |
| `AKL_AUTH_MODE` | `mock` pro dev/test, `oidc` pro Keycloak/OIDC. |
| `AKL_DATABASE_URL` | SQLAlchemy URL databáze. |
| `AKL_AUTO_CREATE_SCHEMA` | Pouze dev zkratka pro lokální vytvoření schématu bez Alembicu. |
| `AKL_MOCK_SUBJECT` | Výchozí subjekt v mock auth režimu. |
| `AKL_MOCK_ROLES` | JSON list výchozích mock rolí. |
| `AKL_OIDC_ISSUER` | OIDC issuer pro validaci JWT. |
| `AKL_OIDC_AUDIENCE` | Očekávané audience JWT. |
| `AKL_OIDC_JWKS_URL` | JWKS endpoint pro validaci podpisu JWT. |

`AKL_ENV=production` odmítne start s `AKL_AUTH_MODE=mock`.

## API

Verzované endpointy jsou pod `/api/v1`.

```text
POST   /api/v1/documents
GET    /api/v1/documents
GET    /api/v1/documents/{document_id}
PATCH  /api/v1/documents/{document_id}
DELETE /api/v1/documents/{document_id}

POST   /api/v1/documents/{document_id}/versions
GET    /api/v1/documents/{document_id}/versions
GET    /api/v1/documents/{document_id}/versions/{version_id}
POST   /api/v1/documents/{document_id}/versions/{version_id}/publish
POST   /api/v1/documents/{document_id}/versions/{version_id}/archive

POST   /api/v1/authz/check
POST   /api/v1/authz/filter-documents

POST   /api/v1/audit/events
GET    /api/v1/audit/events
GET    /api/v1/audit/events/{event_id}

GET    /health
GET    /ready
```

OpenAPI kontrakt je v `openapi.yaml` a runtime OpenAPI je dostupné jako `/openapi.json`.

## Auth v dev režimu

Mock auth čte hlavičky:

```text
X-AKL-Subject: user_123
X-AKL-Roles: admin,document_manager
X-AKL-Groups: IT,Compliance
X-Request-ID: <uuid>
X-Correlation-ID: <uuid>
```

V OIDC režimu služba vyžaduje `Authorization: Bearer <jwt>` a validuje podpis přes JWKS.

## Access policies

Access policy používá stejný tvar jako centrální bezpečnostní model:

```json
{
  "subjects": ["role:reader", "user:user_123", "group:IT"],
  "actions": ["document.read", "rag.query"],
  "constraints": {
    "classification_max": "internal",
    "valid_only": true
  }
}
```

Pokud při vytvoření dokumentu nejsou policies předané, služba vytvoří default:

- owner/admin/document_manager mohou dokument číst, upravovat a pracovat s verzemi,
- role `reader` může číst a používat dokument pro `rag.query` do klasifikace dokumentu.

Authorization API smí volat service account, admin, document manager, nebo uživatel pro vlastní `subject_id`.

## Audit

Služba automaticky auditně zapisuje:

- `document.created`
- `document.updated`
- `document.deleted`
- `document.version.created`
- `document.version.published`
- `document.version.archived`

Externí služby mohou zapisovat audit přes `POST /api/v1/audit/events`, pokud mají akci `audit.write`.

## Limity

- `GET /documents`, `GET /versions` a `GET /audit/events` mají limit 1-200 záznamů.
- `POST /authz/filter-documents` přijme maximálně 1000 candidate document ids.
- `DELETE /documents/{document_id}` je logický delete: nastaví `Document.status=cancelled` a archivuje platné verze.
- Technické logy obsahují request/correlation id, cestu, status a latenci. Nelogují plné dokumenty, tokeny, prompty ani odpovědi.
- `DocumentFile` ukládá jen metadata a URI souboru; nevlastní fyzický obsah.

## Testy

```bash
cd services/registry-api
pytest
```

Testy používají izolovanou SQLite databázi a ověřují hlavní registry, authz a auditní tok.
