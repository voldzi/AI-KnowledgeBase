# STRATOS IT Management Knowledge Profile

AKB can implement the IT management operating model as governed knowledge, not
as a replacement for ITSM, CMDB, monitoring, project management, or finance
systems. Source systems remain authoritative for live operational records. AKB
is the cited document, knowledge, audit, and natural-language access layer.

## Scope

The profile covers:

- IT section operating model and management cadence,
- service catalog knowledge,
- ServiceDesk and ITIL procedures,
- runbooks and recovery procedures,
- CMDB and system references,
- security controls and compliance evidence,
- eGovernment and architecture standards,
- supplier, contract, SLA, and license references,
- IT metrics and management reports,
- role substitution and knowledge transfer,
- safe automation and AI use cases.

## OKF Metadata

The STRATOS OKF profile accepts IT management metadata in Markdown frontmatter.
These fields are preserved in AKB document metadata and selected values are
also converted into stable tags for retrieval and reporting.

| Field | Purpose |
| --- | --- |
| `service_id`, `service_name`, `service_owner` | Service catalog identity and ownership |
| `service_criticality`, `service_tier`, `service_status` | Priority, tiering, and lifecycle |
| `sla_id`, `sla_target`, `support_hours`, `rto`, `rpo` | Service level and recovery expectations |
| `cmdb_ci_id`, `system_id`, `application_id`, `component_id` | CMDB and system references |
| `dependency_service_ids` | Service dependencies |
| `itil_process`, `process_name`, `process_owner` | ITSM process context |
| `supplier_id`, `supplier_name`, `contract_id`, `license_id` | Supplier and contract context |
| `architecture_domain`, `egovernment_standard` | Architecture and eGovernment context |
| `control_id`, `control_area`, `compliance_framework` | Security and compliance control context |
| `metric_id`, `metric_name`, `metric_unit`, `metric_target` | Reporting and KPI context |
| `automation_candidate`, `automation_value`, `human_oversight_required` | Safe automation assessment |

Derived tags include examples such as:

```text
service:svc-stat-prod
service-criticality:critical
service-tier:tier-1
cmdb:ci-svc-stat-prod
system:sys-stat-prod
itil:incident-management
supplier:sup-example
architecture:egovernment
egov:nap-isvs
```

## Reference Bundle

The repository includes a pilot bundle based on the IT management approach in:

```text
examples/okf/stratos-it-management
```

Validate it:

```bash
python3 tools/okf_profile.py validate \
  --source examples/okf/stratos-it-management \
  --report reports/okf_it_management_validate_report.json
```

Preview AKB metadata:

```bash
python3 tools/okf_profile.py plan-import \
  --source examples/okf/stratos-it-management \
  --report reports/okf_it_management_import_plan.json
```

Dry-run import:

```bash
python3 tools/import_docs_folder.py \
  --source examples/okf/stratos-it-management \
  --manifest docs/import-manifest.yaml \
  --mode reindex \
  --okf-profile \
  --dry-run \
  --report reports/okf_it_management_docs_import_report.json
```

## Chat Scenarios

The employee or technician chat should be able to answer, with citations and
permission checks:

- What are the critical IT services and their owners?
- What runbook applies to service `SVC-STAT-PROD`?
- What SLA, RTO, and RPO apply to the service?
- Which services depend on identity, network, or database services?
- Which documents prove privileged access controls?
- Which supplier contracts or SLA reviews relate to a service?
- Which documents are missing or stale for critical services?
- What should ServiceDesk do first for a critical incident?

## Operating Rule

AKB stores and retrieves governed knowledge. ITSM owns tickets, CMDB owns live
configuration records, monitoring owns real-time telemetry, Budget & Contract
owns finance and contract source data, and ProjectFlow owns project execution
records. AKB links to these contexts through metadata and returns cited answers
only within the user's authorization scope.
