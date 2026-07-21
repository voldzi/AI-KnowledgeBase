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
- Centrální GovernedInformationResource souřadnice dokumentu a každé immutable verze.
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
POST   /documents/{document_id}/versions/{version_id}/ingestion-authorization
POST   /documents/{document_id}/versions/{version_id}/publish
POST   /documents/{document_id}/versions/{version_id}/archive
GET    /documents/{document_id}/versions/{version_id}/publication
PUT    /documents/{document_id}/versions/{version_id}/publication
PATCH  /documents/{document_id}/external-references/current
GET    /documents/{document_id}/external-references/current
GET    /documents/ingestion-attempts/current

GET    /integrations/ingestion/readiness
POST   /integrations/ingestion/authorizations/confirm
POST   /integrations/ingestion/intelligence-authorizations/confirm

GET    /public/documents/{public_slug}
GET    /internal/public/documents/{public_slug}/source

POST   /authz/check
POST   /authz/filter-documents

POST   /intelligence/authorization

`GET /documents/ingestion-attempts/current` is the read-only batch projection
for operational surfaces. It evaluates the caller's document boundary once and
returns only current authoritative attempts within that boundary; it does not
grant broader document access.

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
- Interaktivní web nejprve získá přesný krátkodobý proof z
  `/documents/{document_id}/versions/{version_id}/ingestion-authorization`.
  Registry při vydání vyžaduje centrální rozhodnutí pro registrovaný kořen
  dokumentu i přesnou registrovanou immutable verzi. Proof váže organization,
  version governed-resource/source, přesný governed parent, policy
  binding id/version/hash a canonical governance-scope hash. Ingestion Service
  jej potvrzuje výhradně jako `svc-ingestion` přes integrační confirmation
  endpoint; Registry znovu načte aktuální autoritu verze a actor, action, všechny
  governance souřadnice, correlation id i idempotency key se musí přesně
  shodovat.
- Registry drží jeden autoritativní `ingestion_attempts` CAS záznam na dokument.
  Přes `/documents/{document_id}/external-references/current` vybírá immutable
  verzi/job a přechody `QUEUED`, `INGESTING`, `INDEXED`, `FAILED`; synchronizace
  do externích referencí nemůže změnit source lineage ani převzít aktivní
  `INGESTING` lease.
- Intelligence web získá proof přes `/intelligence/authorization`; Registry do
  něj vloží pouze aktuální indexované document/version/policy-hash souřadnice,
  které jsou pro osobu právě povolené. `svc-ingestion` potvrzuje stejnou přesnou
  množinu před OpenSearch dotazem.
- RAG Retrieval Service volá `/authz/filter-documents` a zapisuje auditní události.
- `/authz/filter-documents` vyžaduje pro Access V2 přesný current policy hash a
  množinu `candidate_document_versions`; pouze verze se stavem `valid`, správným
  dokumentem a aktuálním hashem projde. Akce `rag.export` používá samostatnou
  capability `akb:export`.
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

## Central Governed Resources

`POST /documents`, external upsert, změna policy/scope a
`POST /documents/{id}/versions` registrují odpovídající immutable resource přes
STRATOS `PUT /api/v1/information/resources/akb/{resourceType}/{resourceId}`.
Request nese `sourceVersion`, již registrovaný `scope`, binding id/hash, důvod a
volitelný parent. Service-to-service volání autorizuje STRATOS výhradně jako
pevnou identitu `service:akb`; původní aktér z validovaného integration
envelope se ukládá pouze jako `metadata.auditActorSubjectId` a nikdy nenahrazuje
autorizační identitu. Odpověď AKB přijme jen tehdy, pokud vrátí stejný resource,
verzi, binding a hash. Zamítnuté `akb:assign_policy` ukončí celý zápis; Registry nevytváří čitelný
`POLICY_PENDING` dokument.

## True Public Document Delivery

`PUT /documents/{document_id}/versions/{version_id}/publication` creates a
draft, publishes, or revokes one exact immutable version. It accepts only an
interactive bearer. Draft requires `akb:assign_policy`; `PUBLISHED` requires
both `akb:assign_policy` and `akb:publish_public`, while
terminal `REVOKED` requires `akb:publish_public` without resubmitting a
client-controlled scope. The version must be
centrally registered and carry the same public-eligible binding/hash that
STRATOS records in its `InformationPublication`. Publication and revocation
write local audit events; the published coordinates are immutable and a
revoked row is terminal. `POST .../archive` and logical `DELETE
/documents/{id}` return `409 publication_lifecycle_active` while the affected
document has a `DRAFT` or `PUBLISHED` publication; callers must first complete
the governed `REVOKED` transition.

`GET /public/documents/{public_slug}` is anonymous and returns only the
approved metadata snapshot. `GET /internal/public/documents/{public_slug}/source`
requires `X-AKB-Public-Delivery-Token` and returns an internal source
descriptor only to the AKB web boundary. Each request calls
`POST /api/v1/policy/public-decisions` afresh and validates central publication
id, application, resource type/id, source version, slug, binding, hash, and
publish time, plus the exact policy version. Unknown fields in the decision or
publication object are rejected. Deny/revoke, outage, mismatch, malformed
response, snapshot tamper, or source-descriptor tamper fails closed.

The public web paths `/api/public/documents/{publicSlug}` and
`/api/public/documents/{publicSlug}/source` re-allowlist metadata and verify
actual source size/SHA-256 with bounded-memory I/O before returning a streaming
`200` or single-range `206` response with `Accept-Ranges`, a strong SHA-256
`ETag`, and `no-store`. `If-None-Match` may return `304`; invalid or multiple
ranges return `416` with `Content-Range: bytes */size`. Per-client/public-slug
and global rate limits plus per-client/global concurrency limits return `429`
with `Retry-After`; a source slot is held for the complete stream. Storage
URI, body/extracted text, chunks, embeddings, prompts, answers, and RAG output
are never part of an anonymous JSON response.

Repeated anonymous `public_read`/`public_download` audit outcomes are upserted
into a deterministic fixed-window row. Audit readers receive
`occurrence_count` and `last_seen_at`; the configured retention pruner targets
only expired `anonymous:public` delivery rows and never authenticated audit.
The Registry endpoints themselves also apply independent
`AKL_REGISTRY_PUBLIC_*` per-client/slug and global rate/concurrency limits;
capacity exhaustion returns `429` before another central decision is made.

`GET /public/documents/{publicSlug}` is the corresponding anonymous human
page. It has no internal AppShell or session dependency, uses the same fresh
metadata decision, displays only the approved snapshot, and links exclusively
to the verified public source route. Missing, revoked, invalid, or temporarily
unverifiable publications render the same fail-closed unavailable state.

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
