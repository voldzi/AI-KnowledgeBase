---
type: process
title: Předání projektového dokumentu do AKB
tenant_id: stratos
classification: internal
document_type: methodology
status: valid
owner: projectflow-office
language: cs
external_system: STRATOS_PROJECTFLOW
external_ref: projectflow-document-handover
entity_type: project
entity_id: project-sample
source_uri: s3://akl-documents/stratos/examples/projectflow/document-handover-process.pdf
tags: [projectflow, project, akb-upload, ingestion]
---

# Předání projektového dokumentu do AKB

ProjectFlow předává dokumenty do AKB jako řízené dokumenty. Aplikace poskytne
kontext projektu, typu entity, vlastníka, klasifikace a tagů. AKB zajistí
upload session, uložení objektu, vytvoření dokumentu a verze, ingestion,
indexaci, citace a audit.

## Postup

- uživatel vybere nebo nahraje dokument v ProjectFlow,
- ProjectFlow předá AKB kontext bez lokálního ukládání binárního souboru,
- AKB vytvoří nebo aktualizuje dokumentovou referenci,
- ingestion stav je viditelný v UI,
- klik na citaci nebo dokument otevře jednotný AKB viewer.

## Výsledek

Projektový tým má dostupnou dokumentaci v employee chatu a ostatní aplikace
STRATOS používají stejný zdroj pravdy.
