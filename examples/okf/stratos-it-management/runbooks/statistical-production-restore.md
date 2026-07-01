---
type: runbook
title: Obnova kritické služby Statistická produkce
tenant_id: stratos
classification: restricted
document_type: procedure
status: valid
owner: operations-9101
language: cs
external_system: STRATOS_AKB
external_ref: runbook-svc-stat-prod-restore
service_id: SVC-STAT-PROD
service_name: Statistická produkce
service_owner: operations-9101
service_criticality: critical
service_tier: tier-1
cmdb_ci_id: CI-SVC-STAT-PROD
system_id: SYS-STAT-PROD
itil_process: incident_management
rto: 4h
rpo: 1h
source_uri: s3://akl-documents/stratos/it-management/runbooks/statistical-production-restore.pdf
tags: [runbook, incident, recovery, critical-service]
---

# Obnova kritické služby Statistická produkce

Runbook popisuje základní postup obnovy kritické služby. Konkrétní technické
kroky mohou být v samostatných neveřejných přílohách podle klasifikace.

## Postup

1. Potvrdit dopad a klasifikaci incidentu.
2. Ověřit dostupnost aplikační, databázové a integrační vrstvy.
3. Zkontrolovat poslední úspěšnou zálohu a replikační stav.
4. Spustit obnovu podle schváleného scénáře.
5. Ověřit službu s věcným vlastníkem.
6. Zapsat čas obnovy, příčinu, dopady a návrh prevence.

## Handoff

Pokud není dostupná aktuální technická dokumentace nebo oprávněný správce,
incident se eskaluje na vedení provozu IT.
