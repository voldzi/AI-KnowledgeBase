---
type: policy
title: Řízený dokument v AKB
tenant_id: stratos
classification: internal
document_type: policy
status: valid
owner: akb-governance
language: cs
external_system: STRATOS_AKB
external_ref: akb-controlled-document-policy
source_uri: s3://akl-documents/stratos/examples/governance/controlled-document-policy.pdf
tags: [akb, governance, controlled-document, audit]
---

# Řízený dokument v AKB

Řízený dokument je dokument se známou identitou, verzí, vlastníkem,
klasifikací, stavem zpracování, zdrojovým souborem, auditní stopou a
oprávněními. Aplikace STRATOS ukládají dokumentové binární soubory do AKB a
neukládají vlastní kopie extrahovaného textu, chunků ani embeddingů.

## Povinná metadata

- tenant,
- vlastník nebo garant,
- klasifikace,
- typ dokumentu,
- stav ingestion,
- stabilní externí reference,
- kanonická adresa pro otevření dokumentu.

## Provozní pravidlo

Při změně zdrojového souboru se vytváří nová verze. Citace v odpovědích musí
směřovat na konkrétní verzi a chunk nebo stránku.
