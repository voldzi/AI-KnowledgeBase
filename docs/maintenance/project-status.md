# AKL Project Status

Validated: 2026-06-06.

Tento dokument je konsolidovany stav praci pro AKL Platform. Slouzi jako jedna startovni pravda pro navazujici vyvoj, PR review a predani mezi Codex vlakny.

## Executive Summary

AKL uz neni jen MVP pro upload URI a RAG dotaz. Aktualni stav je lokalni enterprise knowledge platform smerovana na rizene dokumenty:

- Registry API vlastni dokumenty, verze, access policies, audit, workflow tasky a organizacni odpovednosti.
- Ingestion Service zpracovava zdrojove soubory, parser/chunking/OCR profil a indexing report.
- RAG Retrieval Service vraci citace a source-context.
- Web aplikace obsahuje Document Workbench, workflow inbox, upload preflight, napovedu v aplikaci a Employee Assistant.
- Web shell a zakladni UI primitiva jsou sladene se STRATOS portfoliem pres lokalni `apps/web/src/components/stratos` adapter.
- GitHub je stabilizovany pres chraneny `main`, PR workflow, CI gate a release proces.

Zaklad produkcniho dokumentoveho systemu existuje. Nejvetsi zbyle mezery jsou hlubsi viewer fidelity pro komplexni Office/PDF dokumenty, persistovane AI insighty, vicekrokove schvalovani, runtime SLA eskalace a presun upload/download kontraktu mimo web bridge.

## Current GitHub Baseline

- Stable release tag: `v0.1.0-local-platform`.
- Post-release main obsahuje:
  - release proces,
  - Document Workbench QA gate,
  - Playwright E2E testy,
  - Registry `document_assignments`.
- `main` je chraneny pres PR gate a povinne CI checks.

## Implemented Product Surface

### Document Workbench

- `/documents` obsahuje metriky, fulltext, filtry podle stavu/typu/klasifikace a ulozene pracovni pohledy.
- `/documents/[documentId]` obsahuje prehled, viewer preview, workflow, insighty, verze a ingestion stav.
- Detail dokumentu zobrazuje publish gate a workflow task historii z Registry API.
- Detail dokumentu spravuje organizacni odpovednosti dokumentu z `document_assignments`: owner, gestor, reviewer, approver, auditor, steward, SLA a eskalace.
- Detail dokumentu obsahuje audit tab filtrovany podle dokumentu, verzi, workflow tasku, assignmentu, ingestion jobu a source-context metadat.
- Detail dokumentu obsahuje Insights tab, ktery umi pres `/api/documents/{documentId}/insights/propose` vytvorit pracovni `proposed` insighty pro povinnosti, role, lhuty a rizika ze zdrojoveho textu aktualni verze. Vystup ma confidence, citaci a source warnings; autoritativni Registry perzistence a schvalovani jeste nejsou hotove.
- Detail dokumentu spousti Governance Service pres web bridge pro compare versions, compliance check a conflict detection; bridge predava extrahovany text ze zdrojoveho objektu pro text/Markdown/CSV a DOCX/XLSX/PPTX, pri nedostupnem nebo nepodporovanem zdroji explicitne spadne na Registry metadata fallback. Vysledek ukazuje result ID, confidence, warnings, citace a zdrojova omezeni.
- Detail dokumentu ve Viewer tabu otevre auditovany RAG source-context chunk pres `/api/documents/{documentId}/source-context` a zobrazi zdroj, verzi, stranu, sekci a citovatelny text.
- Citace z Knowledge Chat i Employee Assistant jsou sjednocene pres sdileny citation viewer. Otevreni citace zobrazi formatovany source-context a odkaz `Otevrit dokument` vede primo na `/documents/{documentId}?tab=viewer&chunk_id={chunkId}`.
- Detail dokumentu ve Viewer tabu umi pripravit podepsane otevreni zdrojoveho objektu pres `/api/documents/{documentId}/versions/{versionId}/source/open`; content endpoint ověřuje HMAC token a cte pouze objekt z povoleneho storage bucketu. Pokud je otevreny source-context s `page_number`, UI umi z podepsane URL nabidnout page-jump odkaz `#page=N`.
- Viewer ma nativni preview nad podepsanym zdrojem: PDF pres pdf.js render citacni strany s textovou vrstvou a bbox overlayem, Markdown jako formatovany dokument s GFM tabulkami, obsahem a zvyraznenim citace, image/OCR jako obrazek s bbox overlayem, DOCX jako odstavce, XLSX jako tabulky, PPTX jako slidy, text jako bezpecny textovy nahled a CSV jako tabulku s aktivnim radkem podle source-location.
- Lokální dev/test fixtures pro pozitivni signed source tok jsou v `object-storage/akl-documents/doc_103`, `doc_105`, `doc_106`, `doc_107` a `doc_108`; mock metadata pouzivaji plny SHA-256 a content endpoint hash overuje.
- `/upload` pouziva browser file preflight, SHA-256, podepsanou upload session a PUT upload do aplikacniho upload endpointu.
- `/help` obsahuje napovedu pro dokumentove role, upload, viewer/citace, workflow, governance a troubleshooting.
- UI zaklad pouziva STRATOS kompatibilni shell, rail, button, search a view tab komponenty. Lokalni adapter zustava nahraditelny sdilenym `@stratos/ui` balickem, az bude dostupny v AKL build contextu.

### Workflow

- Registry API ma perzistentni `workflow_tasks`.
- Workflow tasky se synchronizuji z dokumentovych stavu, klasifikace a auditnich signalu.
- Task odpovednost se odvozuje z `document_assignments`.
- `/tasks` zobrazuje organizacni inbox a umi zapisovat akce `assign`, `request_changes`, `approve` a `resolve`.
- Publish gate vyzaduje `Document.status=approved`; upload ani ingestion uz nepublikuji automaticky.

### Documentation And QA

- Startovni dokumentace: `README.md` a `docs/README_START_HERE.md`.
- Product status: tento dokument.
- Product QA gate: `docs/qa/document-workbench-product-qa.md`.
- Release proces: `docs/maintenance/release-process.md`.
- Code health baseline: `docs/maintenance/code-health.md`.
- UI smer: `docs/ui/document-workbench.md`, `docs/ui/workflow-inbox.md`, `docs/ui/production-ui-plan.md`.
- Phase stav: `docs/integration/PHASE_05_DOCUMENT_WORKBENCH.md`.

## Current Known Gaps

Tyto mezery jsou aktualni cilovy backlog. Nejsou to legacy kompatibilitni zavazky.

1. Native viewer/rendering: PDF/image/OCR/DOCX/XLSX/PPTX/text/Markdown/CSV preview existuje nad signed source kontraktem, citace umi deep-link do vieweru na konkretni chunk a PDF umi render citacni strany s textovou vrstvou a bbox overlayem, ale Office preview je stale extrakcni, ne pixel-perfect.
2. Governance source fidelity: web bridge predava extrahovany source text pro textove a Office zdroje; PDF a dalsi binarni typy zatim zustavaji metadata fallback, dokud neni k dispozici serverova PDF/OCR textova extrakce.
3. AI insights: povinnosti, role, lhuty a rizika se uz generuji jako pracovni `proposed` navrhy ze source textu, ale nejsou persistovane v Registry ani napojene na schvalovaci workflow.
4. Audit event coverage: audit tab existuje, ale produkcni hodnota zavisi na duslednem zapisu udalosti ze vsech sluzeb.
5. Multi-step approvals: assignments existuji, ale workflow zatim nema sekvencni approval steps s explicitnim quorum/poradim.
6. SLA escalation runtime: SLA a eskalacni metadata existuji, ale chybi scheduler/notifikace a automaticke eskalacni udalosti.
7. Ingestion-owned task contract: ingestion warningy jsou v UI doplnene mimo Registry-owned task publikaci.
8. Object storage contract: upload session zatim vlastni web bridge; cilovy stav je backend/Object Storage service kontrakt se signed upload/download a auditem.
9. RAG quality: hybrid retrieval, reranking evaluation, citation accuracy a no-answer metriky potrebuji produkcni eval dataset.
10. Security/compliance hardening: OIDC a dokumentova authz musi projit negativnimi testy na urovni dokumentu, chunku a source opening.
11. STRATOS package integration: lokalni UI adapter je kompatibilni mezikrok; primy import `@stratos/ui` ceka na sjednoceny workspace nebo publikovany balicek dostupny pro Docker build.

## Next Recommended Implementation Slices

1. Native viewer/rendering: pokrocila Office fidelity, PDF textovy highlight primo ve vieweru a hlubsi citacni navigace nad existujicim signed source open/page-jump kontraktem.
2. Governance workflow closure: propojit governance result ID na workflow task closure a audit review.
3. Insight persistence and approval: pridat Registry model pro `document_insights`, stav `proposed/approved/rejected`, schvaleni vlastnikem a audit.
4. Workflow approval model: pridat approval steps nad `document_assignments`, sekvencni rozhodovani a quorum pravidla.
5. SLA escalation runtime: pravidelna detekce prekrocenych SLA, audit udalosti, eskalacni tasky a dashboard signal.
6. Object Storage service: presunout signed upload/download z web bridge do backend kontraktu.
7. RAG evaluation: eval dataset pro citace, no-answer rate, retrieval precision a regression gate.
8. STRATOS UI package switch: po sjednoceni repozitaru/build contextu nahradit lokalni adapter primym `@stratos/ui`.

## Maintenance Rule

Pri kazdem vetsim produktovem rezu aktualizuj tento dokument, odpovidajici phase dokument a product QA gate. Pokud se zmeni API kontrakt, aktualizuj i `docs/api/*`, service README a OpenAPI/typy.
