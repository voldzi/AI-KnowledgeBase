# STRATOS Open Knowledge Format Profile

AKB can use Open Knowledge Format (OKF) as a portable, Git-friendly
knowledge interchange layer for STRATOS applications. OKF does not replace AKB
document registry, source files, authorization, ingestion, embeddings, RAG
citations, or audit. It is a curated concept layer that can be imported into AKB
and exported from AKB-managed documentation.

## Profile

The AKB profile id is:

```text
stratos-okf-v1
```

Each concept is a Markdown file with YAML frontmatter. The OKF-required field is
`type`. AKB additionally recommends fields that preserve enterprise context:

```yaml
---
type: policy
title: Povinnosti ISVS podle zákona 365/2000 Sb.
tenant_id: stratos
classification: internal
document_type: regulation
status: valid
owner: odbor-ict
language: cs
external_system: STRATOS_PROJECTFLOW
external_ref: isvs-365
source_uri: s3://akl-documents/public-digitalization-corpus/law/isvs.pdf
tags: [isvs, digitalizace, legislativa]
---

# Povinnosti ISVS
```

## Field Mapping

| OKF field | AKB metadata |
| --- | --- |
| `type` | `okf_type`, `tags[] = okf-type:<type>` |
| `title` | document title fallback and metadata title |
| `tenant_id` | `tenant_id` |
| `classification` | document classification |
| `document_type` | document type |
| `status` | document status |
| `owner` / `owner_id` / `steward` | owner |
| `language` | language |
| `external_system` / `source_system` | source system |
| `external_ref` | external reference |
| `source_uri` / `source_file_uri` | metadata source reference |
| `akb_document_id` | metadata pointer to original AKB document |
| `akb_document_version_id` | metadata pointer to original AKB version |
| `tags` | tags plus `okf` and profile-derived tags |

The profile also preserves STRATOS IT management fields such as `service_id`,
`service_criticality`, `sla_id`, `cmdb_ci_id`, `system_id`, `itil_process`,
`supplier_id`, `contract_id`, `architecture_domain`, `egovernment_standard`,
`control_id`, `metric_id`, `rto`, and `rpo`. These fields are metadata, not new
Registry `document_type` values.

When `document_type` is missing, AKB maps common OKF types:

| OKF type | AKB document type |
| --- | --- |
| `contract`, `contract_summary` | `contract` |
| `policy` | `policy` |
| `process` | `methodology` |
| `regulation` | `regulation` |
| `incident_procedure`, `change_procedure` | `procedure` |
| `knowledge_article` | `knowledge_base_article` |
| `control`, `security_control` | `policy` |
| `operating_model`, `governance_cadence` | `methodology` |
| `api`, `decision`, `metric`, `risk`, `runbook`, `system` | `project_documentation` |
| `service`, `service_catalog`, `service_level`, `service_portfolio`, `cmdb_item`, `configuration_item`, `supplier_management`, `automation_use_case`, `egovernment_standard`, `it_role` | `project_documentation` |

## Tooling

Validate an OKF bundle:

```bash
python3 tools/okf_profile.py validate \
  --source ./okf \
  --report reports/okf_validate_report.json
```

Create a dry-run AKB metadata import plan:

```bash
python3 tools/okf_profile.py plan-import \
  --source ./okf \
  --report reports/okf_import_plan.json
```

Import OKF Markdown concepts into AKB using the existing docs importer:

```bash
python3 tools/import_docs_folder.py \
  --source ./okf \
  --manifest docs/import-manifest.yaml \
  --mode reindex \
  --okf-profile \
  --report reports/okf_import_report.json
```

Export an OKF bundle from an existing docs import report:

```bash
python3 tools/okf_profile.py export-from-report \
  --import-report reports/docs_import_report.json \
  --output exports/okf/akb-docs \
  --overwrite \
  --report reports/okf_export_report.json
```

## Reference Example

The repository contains a small STRATOS example bundle in
`examples/okf/stratos`. It covers governance, ProjectFlow, Budget & Contract,
architecture, operations, and observability concepts.

An IT management pilot bundle is available in
`examples/okf/stratos-it-management`; see
`docs/integration/STRATOS_IT_MANAGEMENT_PROFILE.md`.

Validate it:

```bash
python3 tools/okf_profile.py validate \
  --source examples/okf/stratos \
  --report reports/okf_example_validate_report.json
```

Preview AKB metadata mapping:

```bash
python3 tools/okf_profile.py plan-import \
  --source examples/okf/stratos \
  --report reports/okf_example_import_plan.json
```

## Operating Rules

- OKF is a knowledge interchange format, not a permission model.
- AKB remains the authority for document identity, versions, source opening,
  ingestion status, citations, access policies, and audit.
- Original PDF/source documents must stay in AKB object storage and Registry
  versions. OKF files may summarize or classify those documents, but must not be
  treated as the original controlled source unless the source is Markdown-native.
- Browser clients do not import OKF directly. Operators or CI jobs run the OKF
  tooling and AKB backend services perform ingestion.
- STRATOS application repositories may keep OKF bundles next to application
  documentation. AKB can ingest those bundles with `--okf-profile` so employee
  chat can use them as governed knowledge.
