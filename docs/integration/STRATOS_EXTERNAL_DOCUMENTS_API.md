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
- řízená Budget contract extraction vrstva `contract_financial_v1`: návrhy
  strukturovaných smluvních parametrů s citacemi, persistence výsledku a
  feedback accepted/rejected/edited,
- AKB web/API bridge pro sdílené STRATOS komponenty: picker search,
  upload preflight/session/content/confirm, vytvoření verze, spuštění
  ingestion jobu, ingestion status, retry ingestion, canonical open URL,
  citation open URL a embed viewer.

Navazující části budou doplněné v dalších fázích:

- další extraction profily a UI review panel nad sdílenými komponentami,
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

### Návrh strukturovaných smluvních parametrů pro Budget

```http
POST /api/v1/stratos/extractions/contracts/propose
```

Tento endpoint patří do RAG Retrieval Service. Budget jej volá server-side přes
STRATOS adapter po tom, co má dokument v AKB, zná `document_id` a
`document_version_id`, a chce uživateli nabídnout předvyplnění smlouvy.

Payload:

```json
{
  "tenant_id": "default",
  "external_system": "STRATOS_BUDGET",
  "external_ref": "contract:256-2022-S:main",
  "entity_type": "Contract",
  "entity_id": "contract-uuid",
  "document_id": "doc_...",
  "document_version_id": "ver_...",
  "subject_id": "user-uuid",
  "profile": "contract_financial_v1",
  "profile_version": "1",
  "classification_max": "internal",
  "context_tags": ["budget-contract:contract-uuid"],
  "max_chunks": 12,
  "correlation_id": "corr_..."
}
```

Odpověď:

```json
{
  "extraction_id": "extract_...",
  "tenant_id": "default",
  "external_system": "STRATOS_BUDGET",
  "external_ref": "contract:256-2022-S:main",
  "entity_type": "Contract",
  "entity_id": "contract-uuid",
  "document_id": "doc_...",
  "document_version_id": "ver_...",
  "profile": "contract_financial_v1",
  "profile_version": "1",
  "status": "PROPOSED",
  "classification": "internal",
  "requested_by": "user-uuid",
  "proposals": [
    {
      "field": "contract_number",
      "proposed_value": "256-2022-S",
      "normalized_value": "256-2022-S",
      "unit": null,
      "confidence": "high",
      "status": "proposed",
      "reason": "Explicit contract number label was found in the cited source.",
      "citation": {
        "document_id": "doc_...",
        "document_version_id": "ver_...",
        "chunk_id": "chunk_...",
        "page_number": 2,
        "section_path": ["Cena a platební podmínky"],
        "quoted_text": "Smlouva č.: 256-2022-S.",
        "viewer_url": "/akb/documents/doc_...?tab=viewer&chunk_id=chunk_...#page=2",
        "warnings": []
      },
      "warnings": []
    }
  ],
  "missing_information": [],
  "warnings": [],
  "source_chunk_ids": ["chunk_..."]
}
```

Podporovaná pole profilu `contract_financial_v1` zahrnují:

- `contract_number`, `title`, `supplier_name`, `customer_name`,
- podpis/účinnost/platnost,
- částky bez/s DPH, DPH, měnu,
- splatnost, frekvenci plateb, paušály, jednorázové platby a payment schedule,
- indexaci, sankce, SLA, termíny, povinnosti, rizika,
- VZ/NEN a kandidáty pro RP/cashflow.

Pokud AKB nenajde citovatelný zdroj, vrátí `PARTIAL` s `missing_information`
nebo `INSUFFICIENT_CITABLE_CONTRACT_EVIDENCE`. Hodnoty bez citace se nevrací.

### Načtení výsledku extrakce

```http
GET /api/v1/stratos/extractions/{extraction_id}
```

Vrací stejný tvar jako návrh. Opakované `propose` se stejným
`tenant_id`, `external_system`, `external_ref`, technickou AKB dokumentovou
kotvou, `profile` a `profile_version` vrátí stejný uložený výsledek. Nová verze
dokumentu označí starší nefinální výsledek jako `SUPERSEDED`.

### Návrh cílů, povinností a metrik pro ArchFlow

```http
POST /api/v1/stratos/extractions/archflow-goals/propose
```

Tento endpoint patří do RAG Retrieval Service. ArchFlow jej volá server-side nad
`ArchflowSourceSet` nebo publikovanou `ArchflowGoalCatalogVersion`. ArchFlow
neukládá binární dokument, extrahovaný text, chunky, embeddingy ani RAG odpověď;
ukládá pouze source set, katalogovou verzi, auditní snapshot a po lidském
potvrzení zapisuje vlastní cíle a vazby.

Payload pro source set:

```json
{
  "tenant_id": "default",
  "external_system": "STRATOS_ARCHFLOW",
  "external_ref": "archflow-source-set:srcset-1:goal-catalog",
  "entity_type": "ArchflowSourceSet",
  "entity_id": "srcset-1",
  "source_set_id": "srcset-1",
  "documents": [
    {
      "document_id": "doc_...",
      "document_version_id": "ver_...",
      "canonical_url": "/akb/documents/doc_...",
      "classification": "internal"
    }
  ],
  "subject_id": "user-uuid",
  "profile": "archflow_goal_extraction_v1",
  "profile_version": "1",
  "classification_max": "internal",
  "context_tags": ["archflow", "goal-catalog", "source-set:srcset-1"],
  "max_chunks": 18,
  "correlation_id": "corr_..."
}
```

Payload pro publikovanou katalogovou verzi nebo potřebu:

```json
{
  "tenant_id": "default",
  "external_system": "STRATOS_ARCHFLOW",
  "external_ref": "archflow-need:need-1:catalog-version:catver-1",
  "entity_type": "ArchflowNeed",
  "entity_id": "need-1",
  "source_set_id": "srcset-1",
  "catalog_version_id": "catver-1",
  "subject_id": "user-uuid",
  "profile": "archflow_goal_extraction_v1",
  "profile_version": "1",
  "classification_max": "internal",
  "context_tags": ["archflow", "need:need-1", "catalog-version:catver-1"],
  "max_chunks": 18,
  "correlation_id": "corr_..."
}
```

Pro katalogovou verzi bez explicitního `documents[]` AKB použije první
autorizovaný citovaný chunk jako technickou Registry kotvu. Pokud ArchFlow
source set posílá, musí obsahovat alespoň jeden AKB dokument. V obou případech
AKB ukládá úplný seznam zdrojových dokumentů do `result.source_documents` a
`metadata.source_documents`; Registry pole `document_id` a `document_version_id`
slouží jen jako technická persistence/audit kotva.

Odpověď:

```json
{
  "extraction_id": "extract_...",
  "tenant_id": "default",
  "external_system": "STRATOS_ARCHFLOW",
  "external_ref": "archflow-source-set:srcset-1:goal-catalog",
  "entity_type": "ArchflowSourceSet",
  "entity_id": "srcset-1",
  "document_id": "doc_...",
  "document_version_id": "ver_...",
  "profile": "archflow_goal_extraction_v1",
  "profile_version": "1",
  "status": "PROPOSED",
  "classification": "internal",
  "requested_by": "user-uuid",
  "proposals": [
    {
      "field": "goal",
      "status": "proposed",
      "confidence": "high",
      "proposal": {
        "goal_type": "STRATEGIC_GOAL",
        "title": "Zvýšit dostupnost digitálních služeb",
        "description": "Strategický cíl: Zvýšit dostupnost digitálních služeb na 99,9 %.",
        "parent_hint": "Digitální transformace",
        "priority": "HIGH",
        "obligation_type": null,
        "suggested_metrics": [],
        "candidate_requirements": [],
        "legal_basis": null,
        "risk": null
      },
      "reason": "The cited source explicitly labels a goal.",
      "citation": {
        "document_id": "doc_...",
        "document_version_id": "ver_...",
        "chunk_id": "chunk_...",
        "page_number": 12,
        "section_path": ["Digitální transformace", "Dostupnost služeb"],
        "quoted_text": "Strategický cíl: Zvýšit dostupnost digitálních služeb na 99,9 %.",
        "viewer_url": "/akb/documents/doc_...?tab=viewer&chunk_id=chunk_...#page=12",
        "warnings": []
      },
      "warnings": []
    }
  ],
  "missing_information": [],
  "warnings": [],
  "source_chunk_ids": ["chunk_..."],
  "metadata": {
    "source_set_id": "srcset-1",
    "catalog_version_id": null,
    "source_documents": [
      {
        "document_id": "doc_...",
        "document_version_id": "ver_...",
        "canonical_url": "/akb/documents/doc_...",
        "classification": "internal"
      }
    ],
    "primary_document_id": "doc_...",
    "primary_document_version_id": "ver_..."
  }
}
```

Podporované položky profilu `archflow_goal_extraction_v1` zahrnují:

- `goal`,
- `capability`,
- `obligation`,
- `requirement`,
- `metric`,
- `legal_basis`,
- `risk`.

Každý návrh musí mít citaci. Pokud AKB nenajde citovatelný zdroj, vrátí
`PARTIAL` s warnings, například
`INSUFFICIENT_CITABLE_ARCHFLOW_GOAL_EVIDENCE` nebo
`TARGET_DOCUMENT_NOT_RETRIEVED`.

### Feedback z Budgetu

```http
POST /api/v1/stratos/extractions/{extraction_id}/feedback
```

Budget posílá feedback až po akci autorizovaného uživatele. Payload:

```json
{
  "field": "contract_number",
  "ai_value": "256-2022-S",
  "final_value": "256/2022/S",
  "decision": "edited",
  "reason": "Budget canonical format",
  "actor": "budget-approver",
  "source_app": "STRATOS_BUDGET",
  "source_entity_id": "contract-uuid",
  "correlation_id": "corr_..."
}
```

Stejný endpoint používá ArchFlow s `source_app: "STRATOS_ARCHFLOW"`. ArchFlow
posílá feedback až po potvrzení, úpravě nebo odmítnutí návrhu uživatelem.

`decision` je `accepted`, `rejected` nebo `edited`. AKB tento feedback ukládá
pro audit, měření přesnosti polí a budoucí eval dataset. Budget je jediný
vlastník zápisu do `Contract`, `ContractLine`, `ContractPaymentRule`,
`ContractCashflowPlan`, RP a VZ/NEN struktur.

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
POST /akb/api/stratos/documents/{document_id}/source-open?version_id=...
GET  /akb/api/stratos/documents/{document_id}/ingestion-status
POST /akb/api/stratos/documents/{document_id}/retry-ingestion
GET  /akb/api/stratos/citations/{chunk_id}/open-url
GET  /akb/embed/documents/{document_id}
```

Bridge routy:

- používají session/OIDC uživatele,
- přijímají bearer token z hostitelské STRATOS aplikace, pokud není dostupná
  AKB web session,
- nikdy nevydávají trvalé storage credentials,
- vrací metadata a krátkodobé AKB URL/tokeny,
- zapisují audit source/citation open události.

### Source-open pro Budget & Contract

Budget & Contract otevírá skutečný originální dokument přes AKB web/BFF vrstvu,
ne přes Registry API ani storage. Stabilní interní base URL v Docker síti:

```text
BUDGET_AKB_WEB_BASE_URL=http://akl-web-1:3000/akb
```

Závazný endpoint:

```http
POST /akb/api/stratos/documents/{document_id}/source-open?version_id={document_version_id}
Authorization: Bearer <OIDC service token>
```

Service token je vydaný pro STRATOS service identity, například
`stratos-akb-service`, a musí mít audience `akl-api`. AKB web předá bearer token
do interních API klientů, kde Registry API vynucuje oprávnění a audit.

Úspěšná odpověď:

```json
{
  "source_open": {
    "available": true,
    "download_url": "/akb/api/documents/source/content?token=...",
    "file": {
      "filename": "contract.pdf",
      "mime_type": "application/pdf"
    }
  }
}
```

`download_url` je relativní k AKB web vrstvě. Pro interní Docker volání jej
klient resolve proti `BUDGET_AKB_WEB_BASE_URL`; výsledkem musí být AKB web URL
pod `http://akl-web-1:3000/akb`, která vrací binární dokument:

```http
GET /akb/api/documents/source/content?token=...
200 application/pdf
```

Browser nesmí volat interní storage, Registry, ani jiné privátní AKB služby
napřímo. Browser může dostat pouze viewer/open URL z hostitelské aplikace nebo
AKB web bridge podle oprávnění.

Provozní smoke test tohoto kontraktu:

```bash
BUDGET_AKB_WEB_BASE_URL=http://akl-web-1:3000/akb \
AKB_SMOKE_DOCUMENT_ID=doc_... \
AKB_SMOKE_DOCUMENT_VERSION_ID=ver_... \
python3 scripts/stratos_source_open_smoke.py \
  --env-file /srv/akl/env/akl.prod.env \
  --env-file /srv/STRATOS/deploy/.env
```

Skript získá OIDC client-credentials token, zavolá `source-open`, ověří `201
application/json`, následně stáhne vrácený `download_url` přes AKB web vrstvu a
ověří `200 application/pdf`. Skript nevypisuje bearer token ani podepsaný
download token. Na `docker.home.cz` jsou hodnoty servisního klienta pro STRATOS
runtime v `/srv/STRATOS/deploy/.env`; root `.env` STRATOS compose nepoužívá.
Skript načítá dotenv soubory sám a nespouští jejich obsah přes shell.

Rozlišení runtime base URL:

```text
AKL_REGISTRY_BASE_URL=http://registry-api:8000/api/v1
```

Používejte pro metadata, registraci externích dokumentů, verze, ingestion stav,
extrakce a server-side Registry operace.

```text
BUDGET_AKB_WEB_BASE_URL=http://akl-web-1:3000/akb
```

Používejte pro `source-open`, preview, viewer a stažení binárního originálního
dokumentu přes AKB web/BFF.

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
