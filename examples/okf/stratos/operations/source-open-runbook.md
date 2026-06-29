---
type: runbook
title: Otevření zdrojového dokumentu přes AKB
tenant_id: stratos
classification: internal
document_type: project_documentation
status: valid
owner: platform-operations
language: cs
external_system: STRATOS_AKB
external_ref: akb-source-open-runbook
source_uri: s3://akl-documents/stratos/examples/operations/source-open-runbook.pdf
tags: [akb, viewer, source-open, runbook]
---

# Otevření zdrojového dokumentu přes AKB

STRATOS aplikace neotevírají interní storage endpointy přímo z browseru.
Serverová část aplikace volá AKB web bridge, získá autorizovaný odkaz na
zdrojový soubor a browser otevře dokument přes AKB vrstvu.

## Kontrolní kroky

1. Ověřit, že aplikace má service identity token pro AKB.
2. Zavolat AKB source-open endpoint pro konkrétní dokument a verzi.
3. Zkontrolovat, že odpověď obsahuje dostupný zdrojový soubor.
4. Otevřít vrácený download URL přes AKB web vrstvu.
5. Zapsat auditní událost otevření dokumentu.

## Selhání

Při chybě 401 se kontroluje identita služby a audience tokenu. Při chybě 404
se kontroluje existence dokumentu, verze a dostupnost zdrojového souboru.
