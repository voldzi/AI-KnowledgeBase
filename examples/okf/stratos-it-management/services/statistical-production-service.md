---
type: service
title: Služba Statistická produkce
tenant_id: stratos
classification: internal
document_type: project_documentation
status: valid
owner: operations-9101
language: cs
external_system: STRATOS_AKB
external_ref: service-statistical-production
service_id: SVC-STAT-PROD
service_name: Statistická produkce
service_owner: operations-9101
service_criticality: critical
service_tier: tier-1
service_status: active
sla_id: SLA-STAT-PROD
sla_target: dostupnost-99-5
support_hours: 24x7-pro-kriticke-incidenty
rto: 4h
rpo: 1h
cmdb_ci_id: CI-SVC-STAT-PROD
system_id: SYS-STAT-PROD
dependency_service_ids: [SVC-IAM, SVC-NETWORK, SVC-DATABASE]
source_uri: s3://akl-documents/stratos/it-management/services/statistical-production-service.pdf
tags: [service-catalog, critical-service, statistics, cmdb]
---

# Služba Statistická produkce

Služba zajišťuje podporu hlavní činnosti úřadu. Je kritická pro produkci
spolehlivé, bezpečné a včasné statistiky.

## Povinná dokumentace

- vlastník služby,
- SLA a provozní okna,
- technický a aplikační runbook,
- závislosti na infrastruktuře a integracích,
- kontakty pro eskalaci,
- plán obnovy a výsledek posledního testu obnovy.

## Dotazy pro chat

Uživatel se může ptát na vlastníka služby, kritičnost, SLA, závislosti,
runbooky, otevřená rizika nebo chybějící dokumentaci.
