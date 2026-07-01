---
type: supplier_management
title: Vyhodnocení dodavatelského SLA
tenant_id: stratos
classification: confidential
document_type: contract
status: valid
owner: it-back-office-9001
language: cs
external_system: STRATOS_BUDGET
external_ref: supplier-sla-review
supplier_id: SUP-EXAMPLE
supplier_name: Dodavatel provozní podpory
contract_id: CONTRACT-SLA-EXAMPLE
sla_id: SLA-STAT-PROD
sla_target: dostupnost-99-5-a-reakce-dle-priority
service_id: SVC-STAT-PROD
service_name: Statistická produkce
source_uri: s3://akl-documents/stratos/it-management/suppliers/supplier-sla-review.pdf
tags: [supplier, contract, sla, budget]
---

# Vyhodnocení dodavatelského SLA

Vyhodnocení dodavatele sleduje plnění smluvních SLA, eskalované problémy,
dodržení reakčních dob, kvalitu předané dokumentace a otevřená rizika.

## Doporučená tabulka

| Oblast | Kontrola | Výsledek |
| --- | --- | --- |
| SLA | Dostupnost a reakční doby | porovnat se smlouvou |
| Incidenty | Počet eskalací | trend a příčina |
| Dokumentace | Aktuálnost provozních postupů | doplnit chybějící části |
| Rizika | Otevřená dodavatelská rizika | vlastník a termín |

## Použití v AKB

AKB může připravit přehled smluv a SLA pro službu, ale finanční a smluvní
zdrojová data zůstávají ve STRATOS Budget & Contract.
