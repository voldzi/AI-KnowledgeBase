# STRATOS External Documents API

Tento dokument je interní kontrakt pro STRATOS aplikace, které potřebují uložit nebo číst dokumenty přes AI KnowledgeBase / AKB. Frontendy STRATOS nevolají interní AKB služby přímo. Volání jde buď přes serverový STRATOS adapter, nebo přes schválený AKB web/API bridge používaný sdílenými komponentami.

## Stav kontraktu

Implementovaná část:

- idempotentní registrace externího dokumentu,
- získání externí reference a navázaného AKB dokumentu,
- unikátní vazba `tenant_id + external_system + external_ref`,
- audit vytvoření externí reference,
- aktualizace aktuální verze, souboru a ingestion stavu externí reference
  po potvrzení uploadu,
- AKB web/API bridge pro sdílené STRATOS komponenty: picker search,
  upload preflight/session/content/confirm, vytvoření verze, spuštění
  ingestion jobu, ingestion status, retry ingestion, canonical open URL,
  citation open URL a embed viewer.

Navazující části budou doplněné v dalších fázích:

- extrakce insightů,
- service-to-service endpointy pro by-ref, external-document search a
  external-document scoped ingestion status nad `external_document_id`.

## Zásady

- Source of truth pro obchodní objekty zůstává v aplikacích STRATOS.
- AKB drží dokument, verze, souborová metadata, OCR/text/chunky, index a citace.
- `external_ref` musí být stabilní a idempotentní.
- Stejné `tenant_id`, `external_system` a `external_ref` nesmí vytvořit druhý AKB dokument.
- AI výstupy jsou návrhy s citací, ne přímý zápis do Budget, ProjectFlow nebo jiného source-of-truth modelu.
- Browser klient STRATOS nesmí volat interní Registry, Ingestion, object storage, Qdrant ani LLM služby přímo.
- Sdílené browser komponenty používají pouze AKB web/API bridge a AKB-hosted viewer/embed URL.
- Veřejný kontrakt používá `external_system`.
- Nepoužívejte wire field `source_system` pro STRATOS integraci.
- `source_location`, `akb_source_uri`, `citation_base_url` a `preview_url` mají oddělený význam:
  - `source_location` popisuje původ dokumentu ve STRATOS nebo externím úložišti.
  - `akb_source_uri` je interní AKB uložený zdroj, pokud už existuje.
  - `citation_base_url` je báze pro otevření citací uživatelem.
  - `preview_url` je volitelný náhled dokumentu pro uživatele nebo adapter.

## Autentizace a audit

STRATOS adapter posílá service-to-service request s hlavičkami:

```http
Authorization: Bearer <service-token>
X-AKL-Subject: <subject_user_id_or_service_id>
X-AKL-Roles: stratos_service,document_manager
X-AKL-Groups: <optional comma separated groups>
X-Request-ID: <request id>
X-Correlation-ID: <correlation id propagated across STRATOS>
```

V lokálním mock/dev režimu mohou být použité `X-AKL-*` hlavičky. Produkční režim musí používat OIDC/service token podle bezpečnostní konfigurace AKB.

## Endpointy

### Upsert externího dokumentu

```http
POST /api/v1/external-documents/upsert
```

Payload:

```json
{
  "tenant_id": "default",
  "external_system": "STRATOS_BUDGET",
  "external_ref": "contract:256-2022-S:main",
  "entity_type": "Contract",
  "entity_id": "contract-uuid",
  "document_type": "contract",
  "title": "Smlouva 256-2022-S - Zajištění provozu přebíracích míst",
  "classification": "internal",
  "owner": {
    "user_id": "user-uuid",
    "display_name": "Portfolio manager"
  },
  "gestor_unit": "Finance",
  "tags": ["contract", "budget"],
  "metadata": {
    "contract_id": "contract-uuid",
    "contract_number": "256-2022-S",
    "supplier_id": "supplier-uuid",
    "supplier_name": "AUTOCONT a.s.",
    "budget_year": 2026,
    "procurement_action_id": null,
    "projectflow_project_id": null
  },
  "source_location": {
    "kind": "url",
    "uri": "https://stratos.local/contracts/256-2022-S/document",
    "file_name": "256-2022-S.pdf",
    "content_type": "application/pdf",
    "sha256": "optional-64-char-hex",
    "storage_ref": null,
    "captured_at": "2026-06-07T00:00:00Z",
    "display_url": "https://stratos.local/contracts/256-2022-S",
    "repository": "BudgetContracts",
    "path": "/contracts/256-2022-S/document",
    "version": "2026-06-07"
  },
  "akb_source_uri": "s3://akl-documents/stratos/contracts/256-2022-S.pdf",
  "citation_base_url": "https://akb.example/api/v1/citations",
  "preview_url": "https://stratos.local/contracts/256-2022-S/preview"
}
```

Odpověď při vytvoření:

```json
{
  "created": true,
  "external_document": {
    "external_document_id": "extdoc_...",
    "tenant_id": "default",
    "external_system": "STRATOS_BUDGET",
    "external_ref": "contract:256-2022-S:main",
    "entity_type": "Contract",
    "entity_id": "contract-uuid",
    "document_id": "doc_...",
    "current_document_version_id": null,
    "current_file_id": null,
    "current_ingestion_job_id": null,
    "current_ingestion_status": null,
    "akb_source_uri": "s3://akl-documents/stratos/contracts/256-2022-S.pdf",
    "source_location": {
      "kind": "url",
      "uri": "https://stratos.local/contracts/256-2022-S/document",
      "file_name": "256-2022-S.pdf",
      "content_type": "application/pdf",
      "display_url": "https://stratos.local/contracts/256-2022-S"
    },
    "citation_base_url": "https://akb.example/api/v1/citations",
    "preview_url": "https://stratos.local/contracts/256-2022-S/preview",
    "metadata": {
      "contract_id": "contract-uuid",
      "contract_number": "256-2022-S"
    },
    "created_at": "2026-06-07T00:00:00Z",
    "updated_at": "2026-06-07T00:00:00Z"
  },
  "document": {
    "document_id": "doc_...",
    "title": "Smlouva 256-2022-S - Zajištění provozu přebíracích míst",
    "document_type": "contract",
    "status": "draft",
    "classification": "internal",
    "owner_id": "user-uuid",
    "owner": "user-uuid",
    "gestor_unit": "Finance",
    "tags": ["budget", "contract", "external", "stratos_budget"],
    "metadata": {
      "contract_id": "contract-uuid",
      "contract_number": "256-2022-S",
      "external": {
        "tenant_id": "default",
        "external_system": "STRATOS_BUDGET",
        "external_ref": "contract:256-2022-S:main",
        "entity_type": "Contract",
        "entity_id": "contract-uuid",
        "source_location": {
          "kind": "url",
          "uri": "https://stratos.local/contracts/256-2022-S/document",
          "file_name": "256-2022-S.pdf"
        },
        "akb_source_uri": "s3://akl-documents/stratos/contracts/256-2022-S.pdf",
        "citation_base_url": "https://akb.example/api/v1/citations",
        "preview_url": "https://stratos.local/contracts/256-2022-S/preview"
      }
    },
    "created_at": "2026-06-07T00:00:00Z",
    "updated_at": "2026-06-07T00:00:00Z",
    "access_policies": [],
    "assignments": []
  }
}
```

Opakované volání se stejným `tenant_id`, `external_system` a `external_ref` vrátí stejnou vazbu s `created: false`.

### Detail externího dokumentu

```http
GET /api/v1/external-documents/{external_document_id}
```

Vrací stejný tvar jako upsert, vždy s `created: false`.

### Aktualizace aktuální verze externí reference

```http
PATCH /api/v1/external-documents/{external_document_id}/current
```

AKB bridge volá tento endpoint po potvrzení uploadu a vytvoření ingestion jobu.
Registry tím drží aktuální vazbu externí reference na poslední AKB verzi, soubor
a ingestion stav.

Payload:

```json
{
  "current_document_version_id": "ver_...",
  "current_file_id": "file_...",
  "current_ingestion_job_id": "job_...",
  "current_ingestion_status": "INGESTING",
  "akb_source_uri": "s3://akl-documents/stratos/...",
  "source_location": {
    "kind": "object_storage",
    "uri": "s3://akl-documents/stratos/...",
    "file_name": "smlouva.pdf",
    "content_type": "application/pdf",
    "sha256": "sha256:..."
  }
}
```

Endpoint ověřuje oprávnění `document_ingest`, validuje, že verze a soubor patří
ke stejnému AKB dokumentu, zapisuje audit událost
`external_document.current_updated` a vrací stejný tvar jako detail externího
dokumentu.

## Povolené externí systémy

`external_system` musí být jedna z hodnot:

- `STRATOS_BUDGET`
- `STRATOS_PROJECTFLOW`
- `STRATOS_ARCHFLOW`
- `STRATOS_PROCESSFORGE`
- `STRATOS_EXECUTIVE`
- `STRATOS_PLATFORM`

Neznámá hodnota je odmítnutá validační chybou `422`.

## Source location

`source_location.kind` musí být jedna z hodnot:

- `url`
- `uploaded_file`
- `object_storage`
- `generated_text`
- `external_repository`

`source_location` je součástí requestu i response pro external document a document version. Není to volný metadata blob.

## Povolené typy dokumentů

AKB Registry aktuálně podporuje:

- `directive`
- `regulation`
- `methodology`
- `policy`
- `procedure`
- `manual`
- `knowledge_base_article`
- `project_documentation`
- `meeting_record`
- `contract`
- `attachment`
- `other`

## Klasifikace

Používejte pouze:

- `public`
- `internal`
- `restricted`
- `confidential`

STRATOS adapter mapuje vlastní klasifikační kódy na tyto hodnoty před voláním AKL.

## Doporučené external_ref

`external_ref` musí být stabilní a čitelné:

```text
contract:<contractNumber>:main
contract:<contractNumber>:amendment:<amendmentNumber>
project:<projectId>:meeting:<meetingId>
project:<projectId>:documentation:<documentKind>:<sourceId>
directive:<sourceSystemId>:<documentCode>
```

Neměňte `external_ref` při změně názvu dokumentu. Název je metadata, externí reference je identita.

## Chybové stavy

| HTTP | Kód | Význam |
| --- | --- | --- |
| 400 | validation error | Neplatný payload nebo enum hodnota |
| 403 | forbidden | Caller nemá oprávnění vytvořit nebo číst dokument |
| 404 | external_document_not_found | Externí reference neexistuje |
| 409 | conflict | Porušení unikátního klíče nebo souběžný zápis |

## Minimální tok pro STRATOS aplikaci

1. STRATOS aplikace uloží vlastní obchodní objekt.
2. STRATOS `apps/api` zavolá `POST /api/v1/external-documents/upsert`.
3. STRATOS uloží `external_document_id` a `document_id` do své `KnowledgeDocumentRef`.
4. Pro upload sdílená komponenta vytvoří AKB upload session přes AKB bridge a nahraje soubor přímo do AKB.
5. Sdílená komponenta potvrdí upload přes AKB bridge; AKB vytvoří verzi a ingestion job.
6. STRATOS zobrazuje ingestion status z AKB.
7. STRATOS otevírá dokumenty a citace přes jednotný AKB viewer.
8. RAG a citace jsou považované za produkčně použitelné až po stavu `INDEXED`.

## Server-Side STRATOS API

Tyto endpointy používá STRATOS backend adapter přes service token nebo OIDC client credentials. Browser je nevolá přímo. První produkční řez má implementovanou idempotentní registraci, detail external documentu a aktualizaci aktuální verze v Registry; ostatní položky jsou závazný cílový kontrakt a pro browser flow jsou dnes kryté AKB web/API bridgem níže.

```http
POST /api/v1/external-documents/upsert
GET  /api/v1/external-documents/{external_document_id}
PATCH /api/v1/external-documents/{external_document_id}/current
GET  /api/v1/external-documents/by-ref?tenant_id=...&external_system=...&external_ref=...

POST /api/v1/external-documents/{external_document_id}/versions
POST /api/v1/external-documents/{external_document_id}/upload-sessions/preflight
POST /api/v1/external-documents/{external_document_id}/upload-sessions/{upload_session_id}/confirm

POST /api/v1/external-documents/{external_document_id}/ingestion-jobs
GET  /api/v1/external-documents/{external_document_id}/ingestion-status
POST /api/v1/external-documents/{external_document_id}/retry-ingestion

POST /api/v1/external-documents/search
GET  /api/v1/external-documents/{external_document_id}/open-url
GET  /api/v1/citations/{chunk_id}/open-url
```

### Search pro picker

```http
POST /api/v1/external-documents/search
```

Request:

```json
{
  "tenant_id": "default",
  "external_system": "STRATOS_PROJECTFLOW",
  "entity_type": "project",
  "entity_id": "project-uuid",
  "context_tags": ["projectflow-project:project-uuid"],
  "query": "harmonogram",
  "classification": "internal",
  "document_type": "project_documentation",
  "ingestion_status": "INDEXED",
  "limit": 50,
  "offset": 0
}
```

Response:

```json
{
  "items": [
    {
      "document_id": "doc_...",
      "document_version_id": "ver_...",
      "external_document_id": "extdoc_...",
      "external_ref": "project:project-uuid:documentation:main:123",
      "title": "Projektova dokumentace",
      "classification": "internal",
      "document_type": "project_documentation",
      "ingestion_status": "INDEXED",
      "canonical_open_url": "https://stratos.zeleznalady.cz/akb/documents/doc_...?tab=viewer"
    }
  ],
  "limit": 50,
  "offset": 0,
  "total": 1
}
```

AKB filtruje výsledky podle oprávnění aktuálního uživatele nebo subjektu předaného serverovým adapterem.

### Upload session preflight

```http
POST /api/v1/external-documents/{external_document_id}/upload-sessions/preflight
```

Request:

```json
{
  "tenant_id": "default",
  "file_name": "smlouva.pdf",
  "file_type": "application/pdf",
  "file_size": 123456,
  "sha256": "sha256:...",
  "classification": "restricted",
  "document_type": "contract",
  "owner_actor_id": "user-uuid",
  "context_tags": ["budget-contract:contract-uuid"]
}
```

Response:

```json
{
  "upload_session_id": "upl_...",
  "upload_url": "/akb/api/stratos/upload/sessions/upl_.../content",
  "upload_method": "PUT",
  "expires_at": "2026-06-11T10:15:00Z",
  "required_headers": {
    "Content-Type": "application/pdf",
    "X-AKL-Content-SHA256": "sha256:...",
    "X-AKL-Upload-Token": "<opaque-token>"
  },
  "source_file_uri": "s3://akl-documents/stratos/..."
}
```

### Confirm upload

```http
POST /api/v1/external-documents/{external_document_id}/upload-sessions/{upload_session_id}/confirm
```

Response:

```json
{
  "document_id": "doc_...",
  "document_version_id": "ver_...",
  "external_document_id": "extdoc_...",
  "file_id": "file_...",
  "ingestion_job_id": "job_...",
  "ingestion_status": "INGESTING",
  "canonical_open_url": "https://stratos.zeleznalady.cz/akb/documents/doc_...?tab=viewer"
}
```

### Ingestion status

```http
GET /api/v1/external-documents/{external_document_id}/ingestion-status
```

Response:

```json
{
  "external_document_id": "extdoc_...",
  "document_id": "doc_...",
  "document_version_id": "ver_...",
  "ingestion_job_id": "job_...",
  "ingestion_status": "INDEXED",
  "updated_at": "2026-06-11T10:20:00Z",
  "error_code": null,
  "error_message": null
}
```

## Browser AKB Bridge

Sdílené STRATOS komponenty v browseru používají pouze AKB web/API bridge:

```http
POST /akb/api/stratos/documents/search
POST /akb/api/stratos/upload/preflight
PUT  /akb/api/stratos/upload/sessions/{upload_session_id}/content
POST /akb/api/stratos/upload/sessions/{upload_session_id}/confirm
GET  /akb/api/stratos/documents/{document_id}/open-url
GET  /akb/api/stratos/documents/{document_id}/ingestion-status
POST /akb/api/stratos/documents/{document_id}/retry-ingestion
GET  /akb/api/stratos/citations/{chunk_id}/open-url
GET  /akb/embed/documents/{document_id}
```

Bridge routy:

- používají session/OIDC uživatele,
- nikdy nevydávají trvalé storage credentials,
- vrací metadata a krátkodobé AKB URL/tokeny,
- zapisují audit source/citation open události.

## Canonical Open URL

Dokument se neotevírá obyčejným externím linkem. AKB vrací canonical viewer URL:

```text
https://stratos.zeleznalady.cz/akb/documents/{document_id}?tab=viewer&version_id={version_id}
```

Embed/viewer varianta pro shared `AkbDocumentViewer`:

```text
https://stratos.zeleznalady.cz/akb/embed/documents/{document_id}?version_id={version_id}&chunk_id={chunk_id}&page={page}
```

## Citation Open URL

Citation open response:

```json
{
  "document_id": "doc_...",
  "document_version_id": "ver_...",
  "chunk_id": "chunk_...",
  "page_number": 4,
  "viewer_url": "https://stratos.zeleznalady.cz/akb/embed/documents/doc_...?version_id=ver_...&chunk_id=chunk_...&page=4",
  "canonical_open_url": "https://stratos.zeleznalady.cz/akb/documents/doc_...?tab=viewer&chunk_id=chunk_..."
}
```

## Ingestion status enum

Sdílený stav pro STRATOS UI:

```text
REGISTERED
VERSION_CREATED
UPLOADING
INGESTING
INDEXED
FAILED
PERMISSION_DENIED
STALE
```

Interní service statuses se mapují na tento enum před návratem do STRATOS komponent.
