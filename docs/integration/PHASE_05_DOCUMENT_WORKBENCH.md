# Phase 05 Document Workbench

Validated: 2026-06-06.

## 1. Summary

Phase 05 meni dokumentovou cast na Document Workbench a pridava perzistentni workflow task kontrakt v Registry API. Implementace pouziva soucasne Registry, Ingestion a RAG kontrakty bez legacy runtime aliasu.

## 2. Implemented In This Increment

- `/documents`:
  - stavove metriky,
  - fulltextove hledani,
  - filtry podle workflow stavu, typu dokumentu a klasifikace,
  - pracovni pohledy pro revizi, platne zdroje, citlive zdroje a archiv.
- `/documents/[documentId]`:
  - taby pro prehled, viewer, workflow, insighty, verze, ingestion a audit,
  - prioritni kroky odvozene ze stavu dokumentu, verze, ingestion jobu a klasifikace,
  - viewer preview s metadaty zdrojoveho souboru,
  - otevreni auditovaneho RAG source-context chunku pres `/api/documents/{documentId}/source-context?chunk_id=...` s overenim dokumentu a verze,
  - spustitelny governance action panel pro compare/compliance/conflict workflow pres `/api/documents/{documentId}/governance`,
  - panel organizacnich odpovednosti nad `document_assignments` s roli, subjektem, SLA a eskalaci,
  - audit tab filtrovany podle dokumentu, verzi, workflow tasku, assignmentu, ingestion jobu a source-context metadat,
  - workflow task historie filtrovana na dany dokument,
  - publish gate panel pro publikaci `approved` dokumentu a archivaci aktualni `valid` verze.
- `/upload`:
  - lokalni file preflight,
  - SHA-256 hash pres browser `crypto.subtle`,
  - serverovy preflight endpoint `/api/controlled-document/upload/preflight`,
  - HMAC podepsana upload session s expiraci,
  - PUT zdrojoveho souboru do `/api/controlled-document/upload/sessions/{sessionId}/content`,
  - ulozeni objektu do sdileneho object-storage volume pro `s3://akl-documents/...`,
  - predani `file_hash`, `file_name`, `file_size`, `file_type`, `upload_session_id` a `upload_token` do web bridge requestu.
- `/help`:
  - aplikacni napoveda pro role, registr, upload, viewer, workflow, governance, chat a troubleshooting.
- `/tasks`:
  - organizacni inbox nad Registry API workflow tasky, ingestion joby a auditnimi udalostmi,
  - metriky otevrenych, blokujicich a review ukolu,
  - filtry podle priority, stavu a typu,
  - detail ukolu s odpovednosti, deadline, zdrojovym signalem a odkazy do dokumentu, ingestion nebo auditu,
  - akce `assign`, `request_changes`, `approve` a `resolve` pro autoritativni Registry API tasky.
- Registry API:
  - tabulka `workflow_tasks`,
  - `GET /api/v1/workflow/tasks`,
  - `POST /api/v1/workflow/tasks/{task_id}/actions`,
  - auditni zapis `workflow.task.<action>`,
  - idempotentni synchronizace tasku z dokumentovych stavu, citlive klasifikace a auditnich varovani,
  - stavovy automat `draft -> review -> approved -> valid -> archived/cancelled`,
  - publish gate: `/documents/{document_id}/versions/{version_id}/publish` vyzaduje `Document.status=approved`,
  - tabulka `document_assignments`,
  - `GET /api/v1/documents/{document_id}/assignments`,
  - `PUT /api/v1/documents/{document_id}/assignments`,
  - odvozovani owner/reviewer/approver/auditor tasku z assignment roli, SLA a eskalacnich metadat.

## 3. Compatibility Notes

Route `/api/controlled-document/ingestion` nadale vytvari verzi a zaklada ingestion job, ale uz ji automaticky nepublikuje. Publikace je oddelena za review approval a publish gate.

Upload uz nepouziva rucne zadane source URI jako hlavni tok. Browser nejdriv ziska podepsanou preflight session, nahraje soubor pres aplikacni PUT endpoint a teprve potom bridge zalozi draft verzi. Pokud bridge dostane `upload_token`, overi, ze metadata verze odpovidaji podepsane session.

Workflow inbox preferuje autoritativni Registry API tasky. Ingestion tasky zustavaji doplnene ve webu, protoze stav zpracovani vlastni Ingestion Service.

## 4. Open Production Gaps

- Detail dokumentu umi otevrit citovatelny RAG source-context chunk, ale zatim nema realny native viewer pro PDF/DOCX/tabulky/OCR ani signed download.
- Governance action panel vola Governance Service, ale web bridge zatim pouziva Registry metadata/source URI/change summary misto plneho extrahovaneho textu dokumentu.
- AI insighty nejsou persistovane ani schvalovane.
- Audit tab dokumentu je napojeny na Registry audit list; uplnost zalezi na tom, zda vsechny sluzby zapisují relevantni audit udalosti.
- Workflow akce zatim nemaji viceurovnove schvalovatele; SLA a eskalacni metadata existuji v `document_assignments`, ale chybi runtime scheduler/notifikace.
- Ingestion tasky zatim nejsou publikovane do Registry API tasku.
- Upload session zatim vlastni web bridge; cilovy stav je samostatny Object Storage service nebo Ingestion-owned upload contract s audit udalosti.

## 5. Next Recommended Slice

1. Web UI: native viewer/download pro PDF/DOCX/tabulky/OCR, signed source opening a page jump/highlight.
2. Governance Service: predat nativne extrahovany dokumentovy text/chunky a propojit governance vysledky na workflow tasky.
3. Registry API: vicekrokove approval steps a runtime SLA eskalace nad `document_assignments`.
4. Object Storage: presunout signed upload/download kontrakt z web bridge do backend sluzby.
