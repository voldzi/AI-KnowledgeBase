# STRATOS External Documents API

Tento dokument je interní kontrakt pro STRATOS aplikace, které potřebují uložit nebo číst dokumenty přes AI KnowledgeBase / AKB. Frontendy STRATOS nevolají interní AKB služby přímo. Volání jde buď přes serverový STRATOS adapter, nebo přes schválený AKB web/API bridge používaný sdílenými komponentami.

> **Poznámka k legacy kompatibilitě:** Příklady `tenant_id` v tomto dokumentu
> popisují zachovaný wire kontrakt a idempotentní identitu externích dokumentů;
> nejsou modelem autorizace ani scope pro STRATOS Information Policy V2. V2
> používá výhradně organizaci `org_stratos` a aktuální centrální access
> projection/policy decision. `tenant_id` se kvůli kompatibilitě nadále posílá
> tam, kde jej legacy endpoint vyžaduje, ale nesmí se z něj odvozovat přístup a
> tato poznámka nemění legacy runtime chování.

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
  "profile_version": "2",
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
  "profile_version": "2",
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
    },
    {
      "field": "payment_rules",
      "proposed_value": [
        {
          "rule_type": "QUARTERLY",
          "name": "Čtvrtletní platba",
          "amount": 121000,
          "amount_basis": "PER_PERIOD",
          "vat_basis": "WITH_VAT",
          "currency": "CZK",
          "periodicity_months": 3,
          "payment_timing": "ARREARS",
          "due_date": null,
          "payment_terms_days": 30,
          "is_call_off": false,
          "generates_cashflow": true,
          "requires_confirmation": true,
          "citation": {
            "document_id": "doc_...",
            "document_version_id": "ver_...",
            "chunk_id": "chunk_payment_...",
            "page_number": 7,
            "section_path": ["Cena a platební podmínky"],
            "section": "Cena a platební podmínky",
            "quoted_text": "Čtvrtletně bude zpětně uhrazena částka včetně DPH 121 000 Kč.",
            "viewer_url": "/akb/documents/doc_...?tab=viewer&chunk_id=chunk_payment_...#page=7",
            "warnings": []
          },
          "payment_terms_citation": null
        }
      ],
      "normalized_value": [
        {
          "rule_type": "QUARTERLY",
          "name": "Čtvrtletní platba",
          "amount": 121000,
          "amount_basis": "PER_PERIOD",
          "vat_basis": "WITH_VAT",
          "currency": "CZK",
          "periodicity_months": 3,
          "payment_timing": "ARREARS",
          "due_date": null,
          "payment_terms_days": 30,
          "is_call_off": false,
          "generates_cashflow": true,
          "requires_confirmation": true,
          "citation": {
            "document_id": "doc_...",
            "document_version_id": "ver_...",
            "chunk_id": "chunk_payment_...",
            "page_number": 7,
            "section_path": ["Cena a platební podmínky"],
            "section": "Cena a platební podmínky",
            "quoted_text": "Čtvrtletně bude zpětně uhrazena částka včetně DPH 121 000 Kč.",
            "viewer_url": "/akb/documents/doc_...?tab=viewer&chunk_id=chunk_payment_...#page=7",
            "warnings": []
          },
          "payment_terms_citation": null
        }
      ],
      "unit": null,
      "confidence": "medium",
      "status": "proposed",
      "reason": "Cited payment clauses were normalized into independent proposed rules.",
      "citation": {
        "document_id": "doc_...",
        "document_version_id": "ver_...",
        "chunk_id": "chunk_payment_...",
        "page_number": 7,
        "section_path": ["Cena a platební podmínky"],
        "section": "Cena a platební podmínky",
        "quoted_text": "Čtvrtletně bude zpětně uhrazena částka včetně DPH 121 000 Kč.",
        "viewer_url": "/akb/documents/doc_...?tab=viewer&chunk_id=chunk_payment_...#page=7",
        "warnings": []
      },
      "warnings": ["HUMAN_CONFIRMATION_REQUIRED"]
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
- splatnost a strukturovaná `payment_rules`: jednorázová, akceptační, měsíční,
  čtvrtletní, pololetní, roční, milníková, call-off a time-and-material pravidla,
- indexaci, sankce, SLA, termíny, povinnosti, rizika,
- VZ/NEN a kandidáty pro RP/cashflow.

Pokud AKB nenajde citovatelný zdroj, vrátí `PARTIAL` s `missing_information`
nebo `INSUFFICIENT_CITABLE_CONTRACT_EVIDENCE`. Hodnoty bez citace se nevrací.

`payment_rules` je seznam samostatných návrhů. Každý obsahuje `rule_type`,
uživatelský `name`, `amount`, význam částky v `amount_basis`, `vat_basis`, měnu,
periodicitu, časování, případný `due_date`, splatnost, příznak call-off,
rozhodnutí zda smí po potvrzení generovat cashflow, a vlastní citaci.

`amount_basis` používá pouze `PER_PERIOD`, `ONE_OFF`, `UNIT_PRICE` a
`VARIABLE_DRAWDOWN`. `vat_basis` je `WITHOUT_VAT`, `WITH_VAT` nebo
`UNSPECIFIED`; nejistý DPH základ se nikdy nedopočítává. `payment_timing`
používá pouze `ADVANCE`, `ARREARS`, `FIXED_DATE`, `ON_ACCEPTANCE`,
`ON_MILESTONE`, `ON_CALL` a `UNSPECIFIED`.

Call-off a time-and-material bez potvrzeného plánovaného čerpání mají
`generates_cashflow: false`. Stejně bezpečně se chovají pravidla s časováním
`ON_CALL` nebo `UNSPECIFIED`. `FIXED_DATE`, `ON_ACCEPTANCE` a `ON_MILESTONE`
smí navrhnout cashflow pouze s citovaným `due_date` ve formátu ISO
`YYYY-MM-DD`. Všechna pravidla mají `requires_confirmation: true`; AKB je nikdy
nezapisuje do Budget.

Pro bezpečné postupné nasazení AKB inzeruje a přijímá také
`profile_version: "1"`. Tato verze zachovává původní pole
`payment_frequency`, `recurring_amount`, `one_time_amount` a
`payment_schedule`; nové integrace používají verzi `2`. Verze profilu je
součástí idempotentní identity extrakce, takže výsledek verze `1` a `2` pro
stejný dokument jsou dva samostatné záznamy a navzájem se nepřepisují. Během
rolloutu zůstává vynechané `profile_version` kompatibilně na verzi `1`; nový
Budget adapter vždy posílá explicitní `"2"`.

### Načtení výsledku extrakce

```http
GET /api/v1/stratos/extractions/{extraction_id}
```

Vrací stejný tvar jako návrh. Opakované `propose` se stejným
`tenant_id`, `external_system`, `external_ref`, technickou AKB dokumentovou
kotvou, `profile` a `profile_version` vrátí stejný uložený výsledek. Nová verze
dokumentu označí starší nefinální výsledek jako `SUPERSEDED`.

### ArchFlow architektonické artefakty

ArchFlow používá AKB jako jediný Document AI backend pro architekturu. ArchFlow
ukládá pouze reference:

- `tenant_id`,
- `external_system = STRATOS_ARCHFLOW`,
- `entity_type = ArchitectureArtifact`,
- `entity_id`, případně `need_id`,
- `external_ref = archflow-need:<needId>:architecture-artifact:<artifactId>`,
- `document_id`, `document_version_id`,
- canonical AKB URL a citation URL,
- `artifact_type`, `review_status`, `baseline_status`,
- `context_tags`.

ArchFlow nesmí ukládat binární dokumenty, extrahovaný text, chunky, embeddingy
ani LLM/RAG výstupy mimo AKB.

Podporované typy artefaktů:

- `TARGET_ARCHITECTURE`
- `SOLUTION_ARCHITECTURE`
- `INTEGRATION_SPEC`
- `DATA_SECURITY_ASSESSMENT`
- `ARCHITECTURE_DECISION`
- `AS_BUILT_ARCHITECTURE`
- `HANDOVER_PACKAGE`

AKB garantuje sdílený výběr a zobrazení přes STRATOS komponenty
`AkbDocumentPicker` a `AkbDocumentViewer`. Citace se otevírají přes AKB viewer
na konkrétní chunk/stranu/sekci dokumentu. ArchFlow nepředává ani nepřebírá
binární obsah; browser pracuje jen přes AKB web/BFF endpointy.

#### Kontrola architektonického balíčku

```http
POST /api/v1/stratos/extractions/architecture-package/propose
```

Profil: `architecture_package_review_v1`.

Příklad payloadu:

```json
{
  "tenant_id": "default",
  "external_system": "STRATOS_ARCHFLOW",
  "external_ref": "archflow-need:need-1:architecture-artifact:artifact-1",
  "entity_type": "ArchitectureArtifact",
  "entity_id": "artifact-1",
  "need_id": "need-1",
  "artifact_type": "TARGET_ARCHITECTURE",
  "document_id": "doc_...",
  "document_version_id": "ver_...",
  "documents": [
    {
      "document_id": "doc_...",
      "document_version_id": "ver_...",
      "canonical_url": "/akb/documents/doc_...",
      "classification": "internal"
    }
  ],
  "subject_id": "user-uuid",
  "profile": "architecture_package_review_v1",
  "profile_version": "1",
  "classification_max": "internal",
  "context_tags": [
    "archflow",
    "STRATOS_ARCHFLOW",
    "need:need-1",
    "architecture-artifact:artifact-1",
    "artifact-type:TARGET_ARCHITECTURE"
  ],
  "max_chunks": 18,
  "correlation_id": "corr_..."
}
```

Endpoint vrací pouze citované návrhy pro oblasti jako rozsah balíčku,
architektonická rozhodnutí, integrační požadavky, data/security kontroly,
rizika a otevřené body.

#### Předávací a as-built balíček

```http
POST /api/v1/stratos/extractions/architecture-handover/propose
```

Profil: `architecture_handover_v1`.

Payload má stejný tvar jako kontrola architektonického balíčku, jen `profile`
je `architecture_handover_v1` a `artifact_type` typicky
`AS_BUILT_ARCHITECTURE` nebo `HANDOVER_PACKAGE`. Endpoint vrací citované návrhy
pro as-built stav, předávací položky, provozní runbooky, vlastníky,
akceptační evidenci a otevřená rizika.

Všechny ArchFlow extraction workflow používají společné:

```http
GET /api/v1/stratos/extractions/{extraction_id}
POST /api/v1/stratos/extractions/{extraction_id}/feedback
```

Filtrovat lze přes `external_system`, `tenant_id`, `entity_type`,
`artifact_type` a `context_tags`. AKB v metadatech uložené extrakce zachová
`artifact_type`, `need_id`, `source_documents`, `source_set_id`,
`catalog_version_id` a `context_tags`.

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
- `STRATOS_AIIP`
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
- `ai_intake`
- `ai_requirement_card`
- `ai_security_appendix`
- `ai_governance_evidence`
- `other`

## AI Innovation Portal / AIIP

AI Innovation Portal používá browser-safe AKB web bridge, ale jeho governed
upload je záměrně oddělený od obecných external-document endpointů. Interní
Registry vystavuje jen úzkou route family `aiip-upload`:

```text
POST  /api/v1/integrations/aiip-upload/external-documents/upsert
PUT   /api/v1/integrations/aiip-upload/documents/{document_id}/versions
PATCH /api/v1/integrations/aiip-upload/external-documents/{external_document_id}/current
```

AIIP tyto Registry routy nevolá z browseru přímo. Browser/server AIIP volá AKB
web bridge; ten oddělí service transport identitu od identity aktuálního
autora a teprve potom volá Registry.

Závazná hodnota:

```text
tenant_id = org_stratos
external_system = STRATOS_AIIP
```

`tenant_id` je zde pouze kompatibilní wire pole. Není autorizační hranicí;
izolaci určuje přesný centrálně registrovaný scope a Information Policy.

AIIP zůstává source of truth pro AI požadavek, scoring, workflow a review. AKB
je source of truth pro dokument, verzi, originální soubor, ingest, text/chunky,
embeddings, citace, RAG audit a source-open. AIIP proto ukládá jen AKB
reference a bezpečná metadata.

Povolené entity typy zůstávají omezené na AIIP objekty:

```text
InnovationRequest
InnovationRequestImport
```

Stabilní `external_ref` musí být čitelný, idempotentní a nemá se měnit při
změně názvu požadavku nebo souboru. Doporučené tvary:

```text
aiip:idea:<ideaId>:source:<sourceDocumentId>
aiip:idea:<ideaId>:quick-intake
aiip:idea:<ideaId>:requirement-card
aiip:idea:<ideaId>:data-security-appendix
aiip:import:<importJobId>:source
aiip:knowledge:<knowledgeArticleId>:article
```

AIIP document type mapping:

| AIIP dokument | AKB `document_type` |
| --- | --- |
| quick intake | `ai_intake` |
| requirement card | `ai_requirement_card` |
| data security appendix | `ai_security_appendix` |
| workflow/security evidence | `ai_governance_evidence` |
| knowledge article | `knowledge_base_article` |
| compatibility-mode requirement | `project_documentation` |
| compatibility-mode appendix | `attachment` |
| explicitly unmapped AIIP source | `other` |

Jiné hodnoty z obecného AKB katalogu nejsou na dedicated AIIP uploadu
povolené.

Citlivost AIIP se mapuje před voláním AKB:

| AIIP sensitivity | AKB classification |
| --- | --- |
| `Veřejné` | `public` |
| `Interní` | `internal` |
| `Citlivé` | `restricted` |
| `Vyhrazené` | `restricted` |
| `Důvěrné` | `restricted` |
| `Neznámé` | `restricted` |

Hodnota `confidential`, právní klasifikace jiná než `NONE` nebo classified
obsah jsou v běžném AKB profilu odmítnuty před uploadem, dokud není provozně
schválená oddělená classified boundary. Volný `metadata` objekt není součástí
dedicated kontraktu.

### Dvojí identita a autoritativní lineage

Každé volání vyžaduje současně:

```http
Authorization: Bearer <aiip-service transport token>
X-AIIP-Actor-Authorization: Bearer <current person token>
```

Tokeny musí být různé. Transportní token musí reprezentovat přesný client
`aiip-service` s jediným Registry route grantem `aiip-upload`. Registry používá
vlastní `AKB_AIIP_INGEST_SERVICE_TOKEN` pouze pro centrální endpoint
`AKL_STRATOS_AIIP_AKB_RESOURCES_URL`; tento credential se musí lišit od
obecného `AKB_POLICY_SERVICE_TOKEN`.

Dedicated route family je jediná zápisová cesta pro `STRATOS_AIIP`. Obecný
external-document upsert, obecné vytvoření verze i obecná změna current pointeru
takový source system nebo AIIP-governed lineage odmítnou bez ohledu na jiné
platné AKB oprávnění volajícího. Document-level sync mimo tuto family smí pouze
aktualizovat stav verze, kterou již jako current vybral dedicated
compare-and-swap; nesmí vytvořit ani vybrat jinou AIIP verzi.

Centrální STRATOS před každým zápisem a replay ověří aktuálního člověka,
`aiip:ingest_own_document`, aktivní AIIP access, přesný aktivní source root,
jeho immutable content revision, scope, zděděnou policy, correlation id a
idempotency key. Odpověď musí být přesným potvrzením; jinak AKB nic nezapíše.
Owner, assignments a `uploaded_by` se odvozují z potvrzeného aktéra. AIIP
nesmí posílat libovolná metadata, `gestor_unit`, owner display name ani pole,
které by mohlo vytvořit assignment. Volitelný `owner_actor_id` je pouze
consistency claim a musí přesně odpovídat `integration_envelope.actor.subjectId`;
nikdy není zdrojem oprávnění.

Minimální governance část preflight payloadu obsahuje vedle názvu, typu a
souborových údajů tento kontrakt:

```json
{
  "tenant_id": "org_stratos",
  "external_system": "STRATOS_AIIP",
  "external_ref": "aiip:idea:idea_123:requirement-card",
  "entity_type": "InnovationRequest",
  "entity_id": "idea_123",
  "document_type": "ai_requirement_card",
  "title": "AI požadavek: Automatizace vyhodnocení formulářů",
  "classification": "internal",
  "information_policy": {
    "schemaVersion": "stratos-information-policy-2",
    "policyBindingId": "pb_registered_binding",
    "policyVersion": "information-policy-2.0.0",
    "handlingClass": "INTERNAL",
    "legalClassification": "NONE",
    "tlp": null,
    "pap": null,
    "contentCategories": [],
    "audience": {
      "organizationId": "org_stratos",
      "scopeType": "recipient_set",
      "scopeIds": ["aiip-review"],
      "recipientSubjectIds": []
    },
    "obligations": ["AUDIT_ACCESS"],
    "originatorId": "subject_123",
    "issuedAt": "2026-07-14T10:00:00Z",
    "reviewAt": null
  },
  "governance_scope": {
    "type": "recipient_set",
    "id": "aiip-review"
  },
  "integration_envelope": {
    "schemaVersion": "stratos-integration-envelope-1",
    "organizationId": "org_stratos",
    "sourceSystem": "STRATOS_AIIP",
    "externalRef": "aiip:idea:idea_123:requirement-card",
    "actor": { "type": "person", "subjectId": "subject_123" },
    "sourceResource": {
      "governedResourceId": "<opaque-current-aiip-root-id>",
      "application": "AIIP",
      "resourceType": "idea",
      "resourceId": "idea_123",
      "sourceVersion": "<immutable-content-revision>",
      "scope": { "type": "recipient_set", "id": "aiip-review" }
    },
    "correlationId": "<stable-correlation-id>",
    "idempotencyKey": "<stable-idempotency-key>",
    "policyBindingId": "pb_registered_binding",
    "policyVersion": "information-policy-2.0.0",
    "policyHash": "sha256:<canonical-policy-hash>",
    "classification": {
      "handlingClass": "INTERNAL",
      "legalClassification": "NONE",
      "tlp": null,
      "pap": null
    },
    "payload": {
      "operation": "document_upload",
      "entityType": "InnovationRequest",
      "entityId": "idea_123",
      "sourceDocumentId": "source_document_456",
      "sha256": "sha256:<source-file-hash>"
    }
  },
  "file_name": "requirement-card.pdf",
  "file_type": "application/pdf",
  "file_size": 123456,
  "sha256": "sha256:<source-file-hash>"
}
```

Produkční payload musí splnit celý snapshot v `contracts/stratos/` a přesné
closed schema v `openapi/openapi.json`. `governance_scope` musí být strukturálně
shodný s normalizovaným `sourceResource.scope`; top-level external identity,
policy, hash a envelope payload se porovnávají se stejnými podepsanými hodnotami.
`policyHash` je autoritativní hodnota vydaná
centrální STRATOS Policy Registry. AKB ověřuje její formát a přes dedikovanou
governance cestu potvrzuje přesnou registrovanou vazbu; nesmí ji nahrazovat
lokálním hashem normalizovaného payloadu, protože volitelná prázdná pole nemění
centrální policy binding.
`sourceVersion` vyjadřuje revizi řízeného obsahu, nikoli
čas změny workflow stavu. Jakákoli změna obsahu po předání vyžaduje nový
centrální source revision podle workflow AIIP.

Registry vrací `governance_confirmation` s přesným parent source resource,
odvozeným `AKB/document` nebo `AKB/document-version`, zděděnou policy, aktérem,
correlation id a idempotency key. Web bridge toto potvrzení přesně porovná a
všechny souřadnice podepíše do upload tokenu. Úspěšný preflight nemá top-level
`upload_token`; token je pouze opaque hodnota v přesném objektu:

`governance_confirmation` je closed object. Povinně obsahuje
`parent_source_resource`, `governed_resource`,
`document_policy_binding_id`, `document_policy_version`,
`document_policy_hash`, `actor_subject_id`, `correlation_id` a
`idempotency_key`. V derived resource jsou povinné oba oddělené údaje
`registered_by_subject_id` a `confirmed_by_subject_id`, exact inherited-policy
souřadnice, parent, scope a source version. Chybějící i neznámé pole v tomto
potvrzení je porušení kontraktu, nikoli dopředně kompatibilní metadata.

Scope je diskriminovaný objekt bez neaktivní souřadnice: `own` obsahuje pouze
`type` a `ownerSubjectId`, zatímco ostatní typy obsahují pouze `type` a `id`.
Registry nikdy nevydává vzájemně vyloučené pole s hodnotou `null`. Web bridge
umí při bezpečném přechodu normalizovat i starší databázovou serializaci s
výlučně `null` neaktivní souřadnicí, ale dál vždy pracuje s kanonickým tvarem.

```json
{
  "upload_method": "PUT",
  "required_headers": {
    "Content-Type": "application/pdf",
    "X-AKL-Content-SHA256": "sha256:<source-file-hash>",
    "X-AKL-Upload-Token": "<opaque-signed-upload-token>"
  }
}
```

Content operation je binary `PUT`, nikoli JSON:

```http
PUT /akb/api/stratos/upload/sessions/{upload_session_id}/content
Content-Type: <exact value from required_headers>
X-AKL-Content-SHA256: <exact value from required_headers>
X-AKL-Upload-Token: <exact value from required_headers>

<exact binary bytes>
```

Po bounded stream read, ověření velikosti a SHA-256 a úspěšném uložení vrátí
HTTP `201` closed response s opaque `upload_receipt`. Receipt je podepsaný pro
konkrétní session, object key, velikost a hash; není storage credential a nesmí
se logovat ani ukládat dlouhodobě.

```json
{
  "uploaded": true,
  "upload_session_id": "upl_...",
  "source_file_uri": "s3://<bucket>/<object-key>",
  "upload_receipt": "<opaque-upload-receipt>",
  "file": {
    "filename": "requirement-card.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 123456,
    "sha256": "sha256:<source-file-hash>"
  }
}
```

Confirm musí v closed JSON těle poslat původní `upload_token`, právě vydaný
`upload_receipt`, všechny podepsané file fields, stejnou Information Policy,
stejný `governance_scope` a stejný integration envelope. Chybějící receipt,
receipt z jiné session, neexistující objekt nebo jakákoli změna velikosti, hash,
media type, actor/source lineage či policy selže před vytvořením verze a jobu.
Podepsaný token obsahuje také očekávanou předchozí current verzi. Samotné
vytvoření immutable verze current pointer nemění; až závěrečný reconcile jej
posune atomickým compare-and-swap. Dva souběžné nebo stale preflighty proto
nemohou jeden druhému přepsat aktuální dokument.

`registeredBySubjectId` je historický registrátor konkrétního immutable
resource, zatímco `confirmedBySubjectId` je čerstvě ověřený aktér aktuálního
volání. Při oprávněném coordinator replay se mohou lišit. AKB zachová historické
`uploaded_by` a znovu autorizuje současného confirméra; nevyžaduje, aby
coordinator byl původním submitterem.

AIIP nesmí do AKB metadata posílat celý text požadavku mimo ingestovaný
dokument, full prompt, LLM odpověď, embeddingy, workflow poznámky s osobními
údaji, bearer tokeny, API keys ani jiné secrets. Dedicated route schema navíc
odmítá neznámá pole.

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
PATCH /api/v1/documents/{document_id}/external-references/current
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
  "idempotent_replay": false,
  "canonical_open_url": "https://stratos.zeleznalady.cz/akb/documents/doc_...?tab=viewer"
}
```

Potvrzení je idempotentní podle vazby
`tenant_id + external_system + external_ref + version_label + file_hash`.
Externí trojice se ověřuje přes `external_document_id` a `document_id`; pokud
je v requestu zopakovaná, musí přesně souhlasit.

- první potvrzení vytvoří verzi/job, vrátí HTTP `201` a
  `idempotent_replay=false`,
- opakované potvrzení stejného labelu a SHA-256 vrátí HTTP `200`, stejné
  `document_version_id`, `file_id` a existující nejnovější
  `ingestion_job_id`, bez nové verze nebo jobu,
- stejný `version_label` s jiným SHA-256 vrátí HTTP `409` a kód
  `UPLOAD_VERSION_HASH_CONFLICT`,
- nesoulad tenant/system/ref/document vazby vrátí HTTP `409` a kód
  `UPLOAD_EXTERNAL_IDENTITY_CONFLICT`.

Pokud verze existuje, ale předchozí pokus skončil před založením ingestion
jobu, confirm chybějící job bezpečně doplní. Existující `FAILED` job se při
replayi nezdvojuje; pro nový pokus se používá explicitní `retry-ingestion`.
Oprávněný uživatel může stejnou akci spustit také v detailu dokumentu na
záložce `Zpracování`; ovládací prvek se zobrazuje pouze při `can_ingest` a po
dokončení ukáže ID nového jobu a výsledný lifecycle stav.

Ingestion Service po autorizovaném spuštění synchronizuje nový job do Registry
přes `PATCH /api/v1/documents/{document_id}/external-references/current`.
Externí reference stejné verze proto auditovaně přejde přes `INGESTING` do
`INDEXED`, případně `FAILED`; retry už nenechá `current_ingestion_job_id`
ukazovat na starší pokus.

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

For `stratos-integration-envelope-1`, upload preflight requires both
`information_policy` (`information-policy-2.0.0`) and `integration_envelope`.
Their organization, binding id/version/hash, and classification must match.
The AIIP envelope is a closed schema: `sourceSystem=STRATOS_AIIP`, a person
actor, exact Idea `sourceResource`, exact scope, and only the allowlisted
`document_upload` payload fields are accepted. Preflight and confirm bodies and
success responses are also closed. Confirm repeats the policy object and must
match the policy hash signed into the preflight token. Unknown fields,
obligations, classified content, or stale binding state are rejected before
binary storage or ingestion.

AIIP upload navíc vyžaduje `sourceResource` s opaque governed resource id,
immutable content revision a přesným scope. Preflight vrátí
`governance_confirmation` a podepíše jeho lineage do upload tokenu. Confirm
navíc přijme pouze `upload_receipt` vydaný úspěšným binary content `PUT` pro
stejnou session, object key, velikost a SHA-256. Potom znovu centrálně ověří
aktéra i source root před vytvořením verze a před aktualizací current pointeru.
Replay nesmí vytvořit druhý dokument nebo verzi a nesmí přijmout změněného
parenta, policy, scope, ownera, media type ani hash souboru.

Obecné bridge routy:

- používají session/OIDC uživatele,
- přijímají bearer token z hostitelské STRATOS aplikace, pokud není dostupná
  AKB web session,
- nikdy nevydávají trvalé storage credentials,
- vrací metadata a krátkodobé AKB URL/tokeny,
- zapisují audit source/citation open události.

AIIP governed upload je jediná zde popsaná výjimka: používá service bearer pro
transport a samostatný current-person bearer pro autorizaci aktéra. Service
bearer se nikdy neposílá na user projection endpoint a actor bearer se nikdy
nepoužije jako service credential.

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

AIIP governed upload má závaznou samostatnou service identity:

```text
client_id = aiip-document-service
audience = akl-api
role = service_aiip_document
registry_route_grant = aiip-upload
```

Základní proměnné na straně AIIP bez secretů:

```text
AIIP_AKB_WEB_BASE_URL=http://akl-web-1:3000/akb
AIIP_AKB_PUBLIC_BASE_URL=https://ip.zeleznalady.cz/akb
AIIP_AKB_SYNC_REQUIRED=true
AIIP_AKB_DOCUMENT_OIDC_TOKEN_URL=https://login.zeleznalady.cz/realms/stratos/protocol/openid-connect/token
AIIP_AKB_DOCUMENT_OIDC_CLIENT_ID=aiip-document-service
AIIP_AKB_DOCUMENT_OIDC_AUDIENCE=akl-api
AIIP_AKB_DOCUMENT_OIDC_SCOPE=openid
```

`AIIP_AKB_DOCUMENT_OIDC_CLIENT_SECRET` nebo jeho file varianta patří pouze do
host secret store. AIIP předává actor bearer jen za běhu konkrétního
uživatelského požadavku; neukládá jej do databáze ani logu.

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
