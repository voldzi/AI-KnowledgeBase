# STRATOS External Documents API

Tento dokument je interní kontrakt pro STRATOS aplikace, které potřebují uložit nebo číst dokumenty přes AI KnowledgeBase / AKB. Frontendy STRATOS nevolají AKB přímo. Volání jde přes serverový adapter ve STRATOS `apps/api`, který zajistí autentizaci, audit, tenant a mapování oprávnění.

## Stav kontraktu

Implementovaná část:

- idempotentní registrace externího dokumentu,
- získání externí reference a navázaného AKB dokumentu,
- unikátní vazba `tenant_id + external_system + external_ref`,
- audit vytvoření externí reference.

Navazující části budou doplněné v dalších fázích:

- vytvoření dokumentové verze,
- spuštění ingestion jobu,
- sjednocený ingestion status,
- query nad externími dokumenty,
- extrakce insightů,
- stabilní citation open endpoint pro STRATOS adapter.

## Zásady

- Source of truth pro obchodní objekty zůstává v aplikacích STRATOS.
- AKB drží dokument, verze, souborová metadata, OCR/text/chunky, index a citace.
- `external_ref` musí být stabilní a idempotentní.
- Stejné `tenant_id`, `external_system` a `external_ref` nesmí vytvořit druhý AKB dokument.
- AI výstupy jsou návrhy s citací, ne přímý zápis do Budget, ProjectFlow nebo jiného source-of-truth modelu.
- Browser klient STRATOS nesmí volat tyto endpointy přímo.
- Veřejný kontrakt používá `external_system`.
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
4. Po doplnění Fáze 2 STRATOS vytvoří verzi a spustí ingestion job.
5. RAG a citace budou povolené až po stavu `INDEXED`.

## Navazující kontrakt pro Fázi 2

Plánované endpointy:

```http
POST /api/v1/external-documents/{externalDocumentId}/versions
POST /api/v1/external-documents/{externalDocumentId}/ingestion-jobs
GET  /api/v1/external-documents/{externalDocumentId}/ingestion-status
POST /api/v1/external-documents/query
POST /api/v1/external-documents/extract-insights
GET  /api/v1/citations/{chunkId}/open
```

Tyto URL jsou rezervované pro stabilní STRATOS kontrakt.
