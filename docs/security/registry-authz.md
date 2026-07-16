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

V `oidc` profilu nesmí downstream služba automaticky předat caller token jiné
službě. RAG používá svůj dokumentovaný delegační kontrakt. Ingestion používá pro
všechny Registry requesty vlastní `svc-ingestion` client-credentials bearer;
caller subject zůstává jen v authz/audit payloadu. Dokumentová rozhodnutí
vynucuje Registry API.

Service identity se neurčuje podle názvu role. Registry vyžaduje současně
allowlistovaný `azp`/`client_id` a přesnou Keycloak service-account identitu
`service-account-<client_id>` v `preferred_username` nebo `sub`. Konfliktní
client claims a každý service-looking token, který tuto vazbu nesplní, končí
`403 untrusted_service_identity`. Důvěryhodný client navíc smí volat jen route
families explicitně uvedené v `AKL_SERVICE_CLIENT_ROUTE_GRANTS`; neuvedená
route je default-deny.

Produkční `svc-ingestion` má pouze `authz`, `audit`, `documents-read` a
`ingestion-status`. `ingestion-status` mapuje výhradně write na
`/documents/{document_id}/external-references/current`; u AIIP záznamu smí
změnit jen job/status pro už dedikovaně potvrzenou current verzi. Produkční
`aiip-service` zůstává omezený pouze na `aiip-upload` a nesmí získat žádnou z
těchto generic families.

Globální service audit rozhodnutí používají registrovaný interní AKB binding
`pol_akb_internal_source_v1`. Registry jej načte z centrálního Policy Registry,
ověří jeho kanonický hash a teprve poté požádá o odpovídající `ai`, `read` nebo
`upload` rozhodnutí. Obecné `access` rozhodnutí zůstává bootstrap kontrolou
služební identity bez vazby na obsahovou policy. Chybějící, cizí nebo změněný
binding zastaví obsahově specifický auditní zápis fail-closed; route grant
`audit` sám o sobě nestačí.

Interaktivní AKB session načítá capabilities a scopes výhradně z centrálního
`GET /api/v1/auth/me`. Keycloak token proto musí obsahovat dedikovanou
`stratos-access-api` audience vedle AKB resource audience `akl-api`. Odmítnutá
nebo nedostupná projekce zůstává fail-closed; chat zobrazí řízenou access chybu
a nikdy nepřejde na statické role nebo klientské hlavičky.

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

Role `admin` má plný přístup v legacy RBAC větvi. Service role samy o sobě
neotevírají Registry route. Například produkční `akb-rag-service` má pouze
route granty `authz`, `audit` a `idempotency`; přímé čtení nebo změna
`/documents*` je proto odmítnuta ještě před doménovým RBAC rozhodnutím.

Vlastník dokumentu má implicitně povolené základní owner akce nad vlastním dokumentem: `document.read`, `document.update`, `document.version.create` a `rag.query`.

Registry při legacy rozhodování sestavuje efektivní subject context z
rolí/skupin v ověřeném tokenu a z aktivních záznamů `role_mappings`. V access
v2 je autoritativní čerstvá STRATOS access projection; statický
`stratos_access` claim ani neověřené `X-STRATOS-*` hlavičky nejsou zdrojem
dynamických oprávnění.

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

- ověřený service client může volat authz jen s explicitním route grantem
  `authz`; jeho rozhodnutí se dále ověří centrálním STRATOS PDP,
- běžný uživatel může kontrolovat jen vlastní `subject_id`,
- lokální mock admin je podporován pouze v development/test režimu.

Pokud běžný uživatel kontroluje vlastní `subject_id`, Registry ignoruje role,
capabilities, scopes a active flags dodané v request body a použije údaje z
ověřeného principalu a access projection. Request body proto nemůže rozšířit
oprávnění volajícího.

### Public-only scope

Syntetický scope `public` není alias pro organizaci ani pro
`document.read`. Povoluje pouze `rag.query` nad přesnou immutable verzí, která
má lokální aktivní `PUBLISHED` publikaci, shodný policy binding/hash a při
každém vyhodnocení čerstvý exact `public_read` ALLOW z anonymního centrálního
public-decision contractu. Tento exact public ALLOW se neposílá do obecného
scope PDP, protože jde o jiný resource contract. Plné `/documents*` pohledy
zůstávají pro public-only subjekt zakázané i tehdy, když má capability
`akb:read_document`.

### Audit a idempotency service boundaries

U externě zapsaného auditu je `actor_id` vždy skutečný ověřený caller subject.
Hodnota `actor_id` z requestu se při rozdílu ukládá pouze jako
`reported_actor_id`; Registry také serverově přepíše `service_client_id`, takže
obě pole nelze podvrhnout payloadem.

Idempotency reserve i complete jsou vázané na ověřeného service klienta.
Client smí pracovat ve vlastním namespace a pouze v explicitně delegovaných
namespaces z `AKL_SERVICE_CLIENT_DELEGATIONS`. Produkční AIIP tok používá
jedinou úzkou delegaci `akb-rag-service=aiip-service`; ostatní cross-client
reserve/complete končí `403 idempotency_namespace_forbidden`.

## Phase 02D enforcement status

Hotovo:

- Registry API validuje OIDC JWT v `AKL_AUTH_MODE=oidc`.
- Registry `/authz/check` a `/authz/filter-documents` oddělují caller principal od kontrolovaného subjectu.
- Ingestion volá `/authz/check` pro `document.ingest` a `document.reindex` přes
  vlastní `svc-ingestion` bearer; kontrolovaný caller zůstává v `subject_id`.
- RAG volá `/authz/filter-documents` s akcí `rag.query` před odpovědí/LLM kontextem.
- Ingestion, RAG a LLM Gateway přijímají `AKL_AUTH_MODE=oidc` a vyžadují bearer token.
- Uživatelská Registry authz volání používají caller token. AIIP upload používá
  výhradně `aiip-document-service=aiip-upload`; navazující ingestion používá oddělený
  `svc-ingestion` service account a caller token dál nepředává.

Zbývá:

- plný browser OIDC login flow ve web aplikaci,
- lokální JWT validace v Ingestion/RAG/LLM Gateway, pokud bude požadována mimo Registry enforcement,
- per-user filtrování historie ingestion jobů a reportů.

## Audit a logování

Auditní tabulka obsahuje skutečného caller subject, doménové události a
correlation id. Deklarovaný původní aktér je pouze auditní metadata. Technické
logy nelogují dokumenty, tokeny, prompty ani odpovědi.

Auditovatelná mutační místa ve službě:

- vytvoření dokumentu,
- změna dokumentu nebo policies,
- logický delete dokumentu,
- vytvoření verze,
- publikace verze,
- archivace verze,
- externě zapsané auditní eventy.
