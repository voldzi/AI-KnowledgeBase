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
- Perzistence Intelligence analyst cases, ulozenych dotazu a evidence setu.
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
| `AKL_TRUSTED_SERVICE_CLIENT_IDS` | Allowlist přesných OIDC service client ids; service-looking token mimo allowlist je odmítnut. |
| `AKL_SERVICE_CLIENT_ROUTE_GRANTS` | Default-deny mapa `client=route1\|route2`; povoluje jen vyjmenované Registry route families. |
| `AKL_SERVICE_CLIENT_DELEGATIONS` | Volitelná mapa idempotency namespaces, které smí caller spravovat vedle vlastního namespace. |
| `AKL_STRATOS_AUTH_ME_URL` | Autoritativní STRATOS access projection (`GET /api/v1/auth/me`). |
| `AKL_STRATOS_POLICY_BINDINGS_URL` | Centrální registr Information Policy bindingů. |
| `AKL_STRATOS_POLICY_DECISIONS_URL` | Centrální decision endpoint pro service-to-service operace. |
| `AKL_STRATOS_INFORMATION_RESOURCES_URL` | Základní URL pro immutable `AKB/document` a `AKB/document_version` GovernedInformationResource. |
| `AKL_STRATOS_INFORMATION_PUBLICATIONS_URL` | Centrální lifecycle konkrétní immutable veřejné verze. |
| `AKL_STRATOS_PUBLIC_DECISIONS_URL` | Anonymní fail-closed decision endpoint volaný při každém public read/download. |
| `AKB_POLICY_SERVICE_TOKEN` | Dedikovaný runtime credential AKB; nesmí se logovat ani commitovat. |
| `AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN` | Nezávislý sdílený token Registry→web pro interní source resolver; v produkci minimálně 32 znaků. |
| `AKL_STRATOS_ACCESS_CACHE_TTL_SECONDS` | Cache projekce; `0` uplatní suspendaci při dalším požadavku. Nikdy nepřekročí expiraci tokenu. |

`AKL_ENV=production` odmítne start s `AKL_AUTH_MODE=mock`.
Produkční start navíc odmítne chybějící STRATOS projection/policy endpointy,
runtime credential, trusted service allowlist nebo route grants.

## API

Verzované endpointy jsou pod `/api/v1`.

```text
POST   /api/v1/documents
GET    /api/v1/documents
GET    /api/v1/documents/metadata-summary
GET    /api/v1/documents/readiness-report
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
GET    /api/v1/documents/{document_id}/versions/{version_id}/publication
PUT    /api/v1/documents/{document_id}/versions/{version_id}/publication

GET    /api/v1/public/documents/{public_slug}
GET    /api/v1/internal/public/documents/{public_slug}/source

POST   /api/v1/authz/check
POST   /api/v1/authz/filter-documents

GET    /api/v1/intelligence/cases
POST   /api/v1/intelligence/cases
GET    /api/v1/intelligence/cases/{case_id}
PATCH  /api/v1/intelligence/cases/{case_id}
POST   /api/v1/intelligence/cases/{case_id}/saved-queries
POST   /api/v1/intelligence/cases/{case_id}/evidence

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

### Skutečně veřejné dokumenty

Veřejná publikace je explicitní schválení jedné přesné platné a centrálně
registrované verze. Vyžaduje interaktivní bearer; draft vyžaduje
`akb:assign_policy`, publish obě `akb:assign_policy` a `akb:publish_public` a
terminální revoke pouze `akb:publish_public` ve spravovaném scope. Registry
ukládá immutable allowlist metadat a přesný descriptor zdroje, publikační
souřadnice po `PUBLISHED` nelze
měnit a revokace je terminální.

Anonymní metadata a interní source resolver při každém požadavku volají
centrální public decision. Veřejný web source endpoint ověří skutečné bajty,
velikost a SHA-256 po 64KiB blocích před zahájením bounded-memory streamu a
vrací attachment s Range/ETag bez storage URI. Per-client/publicSlug a globální
rate limit spolu s per-client/globální concurrency vrací při vyčerpání `429` a
slot pro source drží až do ukončení streamu. Výpadek STRATOS,
revokace, stale/mismatched coordinates nebo tamper znamenají fail-closed
odpověď bez obsahu.

Opakované anonymní auditní výsledky se agregují v deterministickém časovém
okně (`occurrence_count`, `last_seen_at`) a samostatná retence odstraňuje pouze
expirované `anonymous:public` delivery události. Autentizovaný audit zůstává
beze změny.

Lidská stránka `/public/documents/{publicSlug}` běží mimo interní AKB shell a
session, zobrazuje pouze sanitizovaný snapshot a odkazuje na ověřený source
endpoint. Je vždy dynamická a `no-store`; všechny nedostupné stavy mají stejnou
bezpečnou odpověď bez metadat.

### Intelligence analyst cases

`/api/v1/intelligence/cases` uklada analyticke spisy uzivatele pro
TOVEK-like praci v AKB. Spis muze obsahovat ulozene OpenSearch analyticke
dotazy a evidence sety. Evidence uklada identifikatory dokumentu/verze/chunku,
stranku, sekci, score, entity a bounded snippet pro rychlou orientaci. Registry
pritom nemeni dokumenty, verze ani zdrojove soubory; vsechny zmeny se audituji
udalostmi `intelligence.case.*`.

### Document readiness report

`GET /api/v1/documents/readiness-report` vrací permission-scoped agregaci
připravenosti dokumentové základny pro pilotní akceptaci. Registry při tom
nečte těla dokumentů ani nespouští RAG; skládá signály pouze z evidenčních dat:
vlastník/gestor, access policies, status, verze, platnost, source hash,
metadata čísla/datu/oblasti, ingestion status z external refs a kvalita
extrakce/OCR uložená v metadatech.

Report vrací počty `ready_documents`, `review_documents`, `blocked_documents`,
`readiness_score`, agregované `issue_counts` a omezený seznam příkladů issues.
Podporuje stejné filtry jako inventory endpointy: `status`, `classification`,
`document_type`, `owner_id`, `tag`, opakovaný `topic`, `tenant_id`,
`external_system`, `entity_type`, `entity_id`, `external_ref` a opakovaný
`context_tag`.

## Auth v dev režimu

Mock auth čte hlavičky:

```text
X-AKL-Subject: user_123
X-AKL-Roles: admin,document_manager
X-AKL-Groups: IT,Compliance
X-Request-ID: <uuid>
X-Correlation-ID: <uuid>
```

V OIDC režimu služba vyžaduje `Authorization: Bearer <jwt>` a validuje podpis
přes JWKS. Service token je uznán pouze při přesné shodě allowlistovaného
`azp`/`client_id` s `service-account-<client_id>` v `preferred_username` nebo
`sub`. Každý service client má samostatný explicitní route allowlist; role
neobchází default-deny route gate.

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

Authorization API smí volat ověřený service client s route grantem `authz`,
lokální mock admin, nebo uživatel pro vlastní `subject_id`. Dynamická
oprávnění uživatele pocházejí z čerstvé STRATOS access projection, ne z request
body nebo statických JWT access claims.

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

Externí služby mohou zapisovat audit přes `POST /api/v1/audit/events` pouze s
explicitním route grantem `audit` a kladným centrálním rozhodnutím. Uložený
`actor_id` je vždy ověřený caller subject. Odlišný payload actor se zachová jen
jako `reported_actor_id` a Registry serverově doplní skutečný
`service_client_id`.

Idempotency reserve/complete je caller-bound. Service client může spravovat
vlastní namespace a pouze explicitní delegace z
`AKL_SERVICE_CLIENT_DELEGATIONS`; očekávaná integrační delegace je
`akb-rag-service=aiip-service`.

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
