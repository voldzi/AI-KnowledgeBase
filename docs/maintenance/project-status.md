# AKL Project Status

Validated: 2026-06-06.

Tento dokument je konsolidovany stav praci pro AKL Platform. Slouzi jako jedna startovni pravda pro navazujici vyvoj, PR review a predani mezi Codex vlakny.

## Executive Summary

AKL uz neni jen MVP pro upload URI a RAG dotaz. Aktualni stav je lokalni enterprise knowledge platform smerovana na rizene dokumenty:

- Registry API vlastni dokumenty, verze, access policies, audit, workflow tasky a organizacni odpovednosti.
- Ingestion Service zpracovava zdrojove soubory, parser/chunking/OCR profil a indexing report.
- RAG Retrieval Service vraci citace a source-context.
- Web aplikace obsahuje Document Workbench, workflow inbox, upload preflight, napovedu v aplikaci a Employee Assistant.
- GitHub je stabilizovany pres chraneny `main`, PR workflow, CI gate a release proces.

Zaklad produkcniho dokumentoveho systemu existuje. Nejvetsi zbyle mezery jsou native viewer/source-context, skutecne governance akce v UI, persistovane AI insighty, audit tab na detailu dokumentu, vicekrokove schvalovani, runtime SLA eskalace a presun upload/download kontraktu mimo web bridge.

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
- `/upload` pouziva browser file preflight, SHA-256, podepsanou upload session a PUT upload do aplikacniho upload endpointu.
- `/help` obsahuje napovedu pro dokumentove role, upload, viewer/citace, workflow, governance a troubleshooting.

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

1. Native viewer/source-context: PDF/DOCX/tabulky/OCR zatim nemaji produkcni viewer s page jump, highlight a signed download URL.
2. Governance UI execution: compare/compliance/conflict panel v detailu zatim nespousti Governance Service endpointy.
3. AI insights: povinnosti, role, lhuty, rizika a FAQ zatim nejsou persistovane jako `proposed` insighty se schvalenim.
4. Audit tab: detail dokumentu zatim nema filtrovany audit tab pro udalosti daneho dokumentu.
5. Multi-step approvals: assignments existuji, ale workflow zatim nema sekvencni approval steps s explicitnim quorum/poradim.
6. SLA escalation runtime: SLA a eskalacni metadata existuji, ale chybi scheduler/notifikace a automaticke eskalacni udalosti.
7. Ingestion-owned task contract: ingestion warningy jsou v UI doplnene mimo Registry-owned task publikaci.
8. Object storage contract: upload session zatim vlastni web bridge; cilovy stav je backend/Object Storage service kontrakt se signed upload/download a auditem.
9. RAG quality: hybrid retrieval, reranking evaluation, citation accuracy a no-answer metriky potrebuji produkcni eval dataset.
10. Security/compliance hardening: OIDC a dokumentova authz musi projit negativnimi testy na urovni dokumentu, chunku a source opening.

## Next Recommended Implementation Slices

1. Audit tab v detailu dokumentu: filtrovat Registry audit events podle `document_id`, `document_version_id`, workflow tasku a source opening udalosti.
2. Governance Service UI: napojit compare versions, compliance check a conflict detection na skutecne endpointy a auditovat vysledky.
3. Native viewer/source-context: signed source open, PDF page jump, DOCX/text preview a presna viewer lokace citaci.
4. Workflow approval model: pridat approval steps nad `document_assignments`, sekvencni rozhodovani a quorum pravidla.
5. SLA escalation runtime: pravidelna detekce prekrocenych SLA, audit udalosti, eskalacni tasky a dashboard signal.
6. Object Storage service: presunout signed upload/download z web bridge do backend kontraktu.
7. RAG evaluation: eval dataset pro citace, no-answer rate, retrieval precision a regression gate.

## Maintenance Rule

Pri kazdem vetsim produktovem rezu aktualizuj tento dokument, odpovidajici phase dokument a product QA gate. Pokud se zmeni API kontrakt, aktualizuj i `docs/api/*`, service README a OpenAPI/typy.
