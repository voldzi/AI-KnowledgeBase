# AKL Identity & Document Registry API

Samostatná FastAPI služba pro evidenci řízených dokumentů, verzí, metadat, access policies, authorization check a auditní události.

Služba neparsuje dokumenty, nevytváří embeddingy, nevolá LLM, neodpovídá na RAG dotazy a nezapisuje do Qdrantu. URI originálních souborů pouze eviduje.

## Odpovědnost

- Registry dokumentů a verzí dokumentů.
- Metadata, stav, platnost, klasifikace, vlastník a gestor.
- Perzistentni organizacni prirazeni dokumentu: owner, gestor, reviewer, approver, auditor a steward.
- Document-level access policies.
- Authorization check API pro frontend, ingestion, RAG, evaluation a governance služby.
- Perzistence Document AI extraction vysledku a feedbacku.
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

GET    /api/v1/documents/{document_id}/assignments
PUT    /api/v1/documents/{document_id}/assignments

POST   /api/v1/documents/{document_id}/versions
GET    /api/v1/documents/{document_id}/versions
GET    /api/v1/documents/{document_id}/versions/{version_id}
POST   /api/v1/documents/{document_id}/versions/{version_id}/publish
POST   /api/v1/documents/{document_id}/versions/{version_id}/archive

POST   /api/v1/authz/check
POST   /api/v1/authz/filter-documents

GET    /api/v1/workflow/tasks
POST   /api/v1/workflow/tasks/{task_id}/actions

POST   /api/v1/audit/events
GET    /api/v1/audit/events
GET    /api/v1/audit/events/{event_id}

POST   /api/v1/document-extractions
GET    /api/v1/document-extractions/{extraction_id}
POST   /api/v1/document-extractions/{extraction_id}/feedback

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

Role `document_gestor` je určena pro běžného gestora směrnice. Globálně smí založit
dokument, nahrát verzi, spustit ingestion/reindex a pracovat s workflow úkoly, ale
nemá publish, archive, delete ani admin oprávnění.

Authorization API smí volat service account, admin, document manager, nebo uživatel pro vlastní `subject_id`.

## Document AI Extractions

`document_extractions` a `document_extraction_feedback` jsou genericke
perzistentni tabulky pro AKB Document AI navrhy. Registry je pouze uklada a
audituje; retrieval a extrakci provadi RAG Retrieval Service. Idempotence je
dana kombinaci `tenant_id`, `external_system`, `external_ref`, `document_id`,
`document_version_id`, `profile` a `profile_version`. Nova verze dokumentu
oznaci starsi nefinalni vysledky jako `SUPERSEDED`.

## Audit

Služba automaticky auditně zapisuje:

- `document.created`
- `document.updated`
- `document.deleted`
- `document.version.created`
- `document.version.published`
- `document.version.archived`
- `workflow.task.<action>`

Externí služby mohou zapisovat audit přes `POST /api/v1/audit/events`, pokud mají akci `audit.write`.

Audit list `GET /api/v1/audit/events` podporuje filtry `actor_id`, `event_type`, `resource_type`, `resource_id`, `limit` a `offset`. Web detail dokumentu je pouziva spolecne s metadaty udalosti pro filtrovany audit tab.

## Workflow tasky

Registry API poskytuje perzistentni workflow tasky pres `GET /api/v1/workflow/tasks`. Aktivni tasky jsou idempotentne synchronizovane z dokumentovych stavu, citlive klasifikace a auditnich varovani.

Od verze `0003_document_assignments` se odpovednost tasku bere z `document_assignments`:

- `draft` task preferuje `owner`, potom `gestor`,
- `review` task preferuje `reviewer`, potom `approver`, `gestor`, `owner`,
- `governance` a auditni task preferuji `auditor`, potom `gestor`, `owner`.

Kazdy assignment muze nest `sla_days` a eskalacni subjekt. Odvozene tasky ukladaji do `metadata` hodnoty `assignment_id`, `assignment_role`, `sla_days`, `escalation_subject_id` a priznak `escalated`. Rozhodnuti nad workflow taskem zapisuje tento kontext i do auditni udalosti `workflow.task.<action>`.

Rozhodnuti nad taskem se zapisuje pres `POST /api/v1/workflow/tasks/{task_id}/actions`. Podporovane akce jsou `assign`, `request_changes`, `approve`, `publish`, `archive` a `resolve`. `approve` nad review taskem nastavuje dokument na `approved`, `request_changes` vraci review/approved dokument na `draft`, `publish` respektuje stejny publish gate jako dokumentovy endpoint a `archive` pouziva stejnou archivacni logiku jako verze.

Stavovy automat dokumentu je `draft -> review -> approved -> valid -> archived/cancelled`. `POST /api/v1/documents/{document_id}/versions/{version_id}/publish` vyzaduje `Document.status=approved`; jinak vraci `409 publish_requires_approval`.

Odvozena synchronizace aktivnich tasku zachovava manualni workflow rozhodnuti (`last_action`, aktualni stav a prirazeni). Sync muze aktualizovat zdrojova metadata jako aktualni stav dokumentu, ale nesmi pri listovani vratit task zpet do vychoziho stavu.

## Limity

- `GET /documents`, `GET /versions`, `GET /workflow/tasks` a `GET /audit/events` mají limit 1-200 záznamů.
- `POST /authz/filter-documents` přijme maximálně 1000 candidate document ids.
- `DELETE /documents/{document_id}` je logický delete: nastaví `Document.status=cancelled` a archivuje platné verze.
- `owner_id` a `gestor_unit` zustavaji denormalizovana kompatibilni pole. Cilovy organizacni model je `document_assignments`.
- Technické logy obsahují request/correlation id, cestu, status a latenci. Nelogují plné dokumenty, tokeny, prompty ani odpovědi.
- `DocumentFile` ukládá jen metadata a URI souboru; nevlastní fyzický obsah.

## Testy

```bash
cd services/registry-api
pytest
```

Testy používají izolovanou SQLite databázi a ověřují hlavní registry, workflow, authz a auditní tok.
