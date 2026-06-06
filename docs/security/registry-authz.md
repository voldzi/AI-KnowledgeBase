# Registry Authz Model

Identity & Document Registry API kombinuje role-based permissions a document-level access policies.

## Authentication

Podporované režimy:

- `AKL_AUTH_MODE=mock` pouze pro vývoj a testy.
- `AKL_AUTH_MODE=oidc` pro Keycloak/OIDC JWT validované přes JWKS.

Produkční režim odmítá `AKL_AUTH_MODE=mock`.

Ingestion, RAG Retrieval a LLM Gateway používají stejný slovník auth režimů:

- `disabled` jen pro lokální testy,
- `mock` pro explicitní dev profil,
- `bearer` pro explicitní service-token profil,
- `oidc` pro Keycloak/OIDC profil s povinným bearer tokenem.

V `oidc` profilu downstream služby token předávají dál; dokumentová rozhodnutí vynucuje Registry API.

## Role a akce

Služba používá akce z centrálního bezpečnostního kontraktu:

```text
document.create
document.read
document.update
document.delete
document.version.create
document.version.publish
document.version.archive
document.ingest
document.reindex
rag.query
rag.compare
rag.check_compliance
audit.read
audit.write
admin.manage
```

Role `admin` má plný přístup. Service role mají jen minimální akce potřebné pro mezislužbovou integraci, například `service_rag` má document read/rag actions a `audit.write`, ale nemůže měnit registry dokumentů.

Vlastník dokumentu má implicitně povolené základní owner akce nad vlastním dokumentem: `document.read`, `document.update`, `document.version.create` a `rag.query`.

## Document-level policy

Policy se ukládá u dokumentu:

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

Subject reference:

- `user:<subject_id>`
- `role:<role>`
- `group:<group>`
- `service:<service_subject_id>`
- `*`

Klasifikační pravidlo je aplikované v policy přes `classification_max`. `valid_only=true` vyžaduje `Document.status=valid`.

## Authorization API

`POST /api/v1/authz/check` vrací rozhodnutí pro jeden resource.

`POST /api/v1/authz/filter-documents` vrací povolené a odmítnuté document ids. Candidate id, který v registry neexistuje, je vrácen jako denied.

Volání authz API je chráněné:

- admin, document manager a service account mohou kontrolovat libovolný subjekt,
- běžný uživatel může kontrolovat jen vlastní `subject_id`.

Pokud běžný uživatel kontroluje vlastní `subject_id`, Registry ignoruje role a skupiny dodané v request body a použije role/skupiny z ověřeného principalu. Role/skupiny v request body jsou určené pro admin nebo service-account zprostředkované kontroly jiného subjektu.

## Phase 02D enforcement status

Hotovo:

- Registry API validuje OIDC JWT v `AKL_AUTH_MODE=oidc`.
- Registry `/authz/check` a `/authz/filter-documents` oddělují caller principal od kontrolovaného subjectu.
- Ingestion volá `/authz/check` pro `document.ingest` a `document.reindex`.
- RAG volá `/authz/filter-documents` s akcí `rag.query` před odpovědí/LLM kontextem.
- Ingestion, RAG a LLM Gateway přijímají `AKL_AUTH_MODE=oidc` a vyžadují bearer token.
- Registry authz volání používají caller token; audit write může použít service-account token fallback.

Zbývá:

- plný browser OIDC login flow ve web aplikaci,
- lokální JWT validace v Ingestion/RAG/LLM Gateway, pokud bude požadována mimo Registry enforcement,
- per-user filtrování historie ingestion jobů a reportů.

## Audit a logování

Auditní tabulka obsahuje doménové události a correlation id. Technické logy nelogují dokumenty, tokeny, prompty ani odpovědi.

Auditovatelná mutační místa ve službě:

- vytvoření dokumentu,
- změna dokumentu nebo policies,
- logický delete dokumentu,
- vytvoření verze,
- publikace verze,
- archivace verze,
- externě zapsané auditní eventy.
