# AKL Project Status

Validated: 2026-06-15.

Tento dokument je konsolidovany stav praci pro AKB Platform. Slouzi jako jedna startovni pravda pro navazujici vyvoj, PR review a predani mezi Codex vlakny.

## Executive Summary

AKL uz neni jen MVP pro upload URI a RAG dotaz. Aktualni stav je lokalni enterprise knowledge platform smerovana na rizene dokumenty:

- Registry API vlastni dokumenty, verze, access policies, audit, workflow tasky a organizacni odpovednosti.
- Ingestion Service zpracovava zdrojove soubory, parser/chunking/OCR profil a indexing report.
- RAG Retrieval Service vraci citace a source-context.
- RAG Retrieval Service obsahuje prvni STRATOS Document AI extraction profil
  `contract_financial_v1` pro Budget smlouvy; vysledky a feedback se
  perzistuji v Registry API jako navrhy s citacemi.
- Web aplikace obsahuje Document Workbench, Intelligence Workbench, workflow inbox, upload preflight, napovedu v aplikaci a Employee Chat Portal.
- Web shell, zakladni UI primitiva a PDF viewer jsou sladene se STRATOS portfoliem pres lokalni `apps/web/src/components/stratos` adapter.
- Upload/source opening a native preview jsou rozsirene na bezne Office, PDF, obrazkove, textove a strukturovane typy; stare binarni Office formaty `.doc/.xls/.ppt` zustavaji pro plnohodnotnou ingestion/rendering konverzni backlog.
- Produkcni audit 2026-06-11 potvrdil, ze stavajici importovane dokumenty maji jako aktualni zdroj Markdown derivaty; 20 dostupnych raw PDF originalu se migruje pres `tools/import_original_pdf_versions.py`, 3 dokumenty cekaji na doplneni originalniho PDF.
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
- `/chat` je hlavni AKB Assistant plocha s levym seznamem vlaken, chat transcriptem, composerem, pravym panelem zdroju a MVP share dialogem; dotazy jdou pres assistant API a vlákna jsou zatim klientsky/session stav bez serveroveho seznamu nebo backendoveho sdileni.
- Budget contract extraction je dostupna pres
  `/api/v1/stratos/extractions/contracts/propose`. Profil
  `contract_financial_v1` vraci pouze navrzene hodnoty s citaci
  (`document_id`, `document_version_id`, `chunk_id`, page/section,
  `quoted_text`, `viewer_url`), uklada vysledek do Registry
  `document_extractions` a prijima accepted/rejected/edited feedback pro
  audit a evaluace. Budget zustava jedinym vlastnikem finalniho zapisu do
  strukturovanych smluvnich entit.
- Citace z Employee Chat Portal jsou sjednocene pres sdileny citation viewer. Otevreni citace zobrazi formatovany source-context a odkaz `Otevrit dokument` otevre v novem tabu primo originalni podepsany zdrojovy soubor pres assistant citation redirect, bez ztraty historie dotazu a bez vystaveni interniho Docker hostname. PDF redirect pridava `#page=N` a search fragment z textu citace; presne bbox/text-layer zvyrazneni zustava v AKB native preview.
- Detail dokumentu ve Viewer tabu umi pripravit podepsane otevreni zdrojoveho objektu pres `/api/documents/{documentId}/versions/{versionId}/source/open`; content endpoint ověřuje HMAC token a cte pouze objekt z povoleneho storage bucketu. Pokud je otevreny source-context s `page_number`, UI umi z podepsane URL nabidnout page-jump odkaz `#page=N`.
- Viewer ma nativni preview nad podepsanym zdrojem: PDF pres STRATOS-compatible `StratosPdfViewer` s pdf.js renderem citacni strany, textovou vrstvou a bbox overlayem, Markdown jako formatovany dokument s GFM tabulkami, obsahem a zvyraznenim citace, image/OCR jako obrazek s bbox overlayem, DOCX jako odstavce, XLSX/XLSM jako tabulky, PPTX jako slidy, text jako bezpecny textovy nahled, CSV jako tabulku s aktivnim radkem podle source-location a JSON/XML/HTML/XHTML jako textovy nebo HTML preview podle typu.
- Upload preflight prijima bezne zdrojove formaty: PDF, DOC/DOCX, XLSX/XLSM, PPTX, Markdown/text/CSV/JSON/XML/HTML/XHTML, RTF a hlavni obrazkove typy PNG/JPEG/GIF/WebP/SVG. Ingestion parsery maji plnou textovou extrakci pro PDF, DOCX, XLSX/XLSM, PPTX, HTML, Markdown/text/CSV/JSON/XML a OCR/image fallback podle profilu; stare binarni `.doc/.xls/.ppt` jsou povolene jen tam, kde je dostupny zdrojovy download, ale pro indexaci vyzaduji konverzni rozsireni.
- Lokální dev/test fixtures pro pozitivni signed source tok jsou v `object-storage/akl-documents/doc_103`, `doc_105`, `doc_106`, `doc_107` a `doc_108`; mock metadata pouzivaji plny SHA-256 a content endpoint hash overuje.
- `/upload` pouziva browser file preflight, SHA-256, podepsanou upload session a PUT upload do aplikacniho upload endpointu.
- `/help` obsahuje napovedu pro dokumentove role, upload, viewer/citace, workflow, governance a troubleshooting.
- UI zaklad pouziva STRATOS kompatibilni shell, rail, button, search, view tab a PDF viewer komponenty. Lokalni adapter zustava nahraditelny sdilenym `@stratos/ui` balickem, az bude dostupny v AKL build contextu.

### Intelligence Workbench

- `/intelligence` je TOVEK-like analyticky modul nad rizenymi dokumenty bez
  naruseni stavajiciho Document Workbench, Knowledge Chat, STRATOS bridge,
  citaci, source opening nebo auditnich toku.
- Modul ma lokalni submenu `Overview`, `Corpus`, `Search`, `Cases`,
  `Entities`, `Relationships` a `Quality`, aby uzivatel nepracoval v jedne
  dlouhe strance.
- Stranka pouziva existujici permission-scoped Registry kontrakty:
  `listDocuments`, `documents/metadata-summary` a
  `documents/readiness-report`.
- UI zobrazuje velikost opravneného korpusu, readiness skore, pocty dokumentu
  k revizi/blokaci, facety podle typu/klasifikace/vlastnika, nejcastejsi
  readiness signaly, vzorky problemu, metadata-derived kandidatni entity a
  relationship seeds.
- OpenSearch Intelligence vrstva doplnuje chunk-level entity facety, citovane
  evidence search, pokrocile analyst search rezimy a evidence-backed
  relationship edges. Web bridge pro vsechny search/graph dotazy nejdriv
  odvozuje `allowed_document_ids` z Registry API a vysledky znovu orezava pred
  browserem.
- Search sekce obsahuje AKB Query Composer v1: vizualni query boxy/chipy,
  navrhy poli, operatoru, pojmu z opravneného korpusu, metadat, OpenSearch
  entit a ulozenych dotazu ve spisech. Composer generuje dotaz do stavajiciho
  analyst search toku a respektuje stejnou permission-scoped hranici jako
  zbytek Intelligence UI. Nove pouziva web bridge
  `POST /api/intelligence/query/suggestions`, ktery vraci serverove navrhy,
  validaci syntaxe, inferred search mode/search fields a odhad narocnosti
  dotazu; lokalni navrhy zustavaji jen fallback.
- Registry API uklada Intelligence analyst cases, saved queries a evidence sety.
  Intelligence UI umi zalozit spis, vybrat aktivni spis, ulozit aktualni
  analyticky dotaz a pridavat citovane nalezy do evidence setu.
- Kazdy dokumentovy vysledek vede zpet do autoritativniho AKB detailu
  `/documents/{document_id}`; zdroje se neexportuji mimo AKB viewer/source
  boundary.
- Aktualni vrstva je corpus + chunk intelligence analytika s perzistentnim
  analyst case workflow. Timeline, mapy, watchlisty, case exporty a persistentni
  graph snapshots zustavaji dalsi navazujici rezy.

### Workflow

- Registry API ma perzistentni `workflow_tasks`.
- Workflow tasky se synchronizuji z dokumentovych stavu, klasifikace a auditnich signalu.
- Task odpovednost se odvozuje z `document_assignments`.
- `/tasks` zobrazuje organizacni inbox a umi zapisovat akce `assign`, `request_changes`, `approve` a `resolve`.
- Publish gate vyzaduje `Document.status=approved`; upload ani ingestion uz nepublikuji automaticky.

### Documentation And QA

- Startovni dokumentace: `README.md` a `docs/README.md`.
- Zachovany bootstrap/thread onboarding je v `docs/CODEX_THREADS/README.md` a `docs/CODEX_THREADS/bootstrap/`.
- Product status: tento dokument.
- Product QA gate: `docs/qa/document-workbench-product-qa.md`.
- Release proces: `docs/maintenance/release-process.md`.
- Code health baseline: `docs/maintenance/code-health.md`.
- UI smer: `docs/ui/document-workbench.md`, `docs/ui/workflow-inbox.md`, `docs/ui/production-ui-plan.md`.
- Current integration/workbench state: `docs/integration/document-workbench.md`.

## Current Known Gaps

Tyto mezery jsou aktualni cilovy backlog. Nejsou to legacy kompatibilitni zavazky.

1. Native viewer/rendering: PDF/image/OCR/DOCX/XLSX/XLSM/PPTX/text/Markdown/CSV/JSON/XML/HTML preview existuje nad signed source kontraktem, citace umi deep-link do vieweru na konkretni chunk a PDF umi render citacni strany s textovou vrstvou a bbox overlayem, ale Office preview je stale extrakcni, ne pixel-perfect. Stare binarni Office soubory `.doc/.xls/.ppt` jeste potrebuji konverzni vrstvu.
2. Governance source fidelity: web bridge predava extrahovany source text pro textove a Office zdroje; PDF a dalsi binarni typy zatim zustavaji metadata fallback, dokud neni k dispozici serverova PDF/OCR textova extrakce.
3. AI insights: Budget `contract_financial_v1` ma Registry persistence a feedback loop, ale obecne povinnosti, role, lhuty a rizika z dokumentoveho workbenche jeste nejsou napojene na plnohodnotny approval workflow ani sdileny review panel.
4. Audit event coverage: audit tab existuje, ale produkcni hodnota zavisi na duslednem zapisu udalosti ze vsech sluzeb.
5. Multi-step approvals: assignments existuji, ale workflow zatim nema sekvencni approval steps s explicitnim quorum/poradim.
6. SLA escalation runtime: SLA a eskalacni metadata existuji, ale chybi scheduler/notifikace a automaticke eskalacni udalosti.
7. Ingestion-owned task contract: ingestion warningy jsou v UI doplnene mimo Registry-owned task publikaci.
8. Object storage contract: upload session zatim vlastni web bridge; cilovy stav je backend/Object Storage service kontrakt se signed upload/download a auditem.
9. RAG quality: hybrid retrieval, reranking evaluation, citation accuracy a no-answer metriky potrebuji produkcni eval dataset.
10. Security/compliance hardening: OIDC a dokumentova authz musi projit negativnimi testy na urovni dokumentu, chunku a source opening.
11. Source originality: stavajici produkcni Markdown derivaty se prevadeji na dostupne originalni PDF zdroje pres `tools/import_original_pdf_versions.py`; dokumenty bez raw PDF zustavaji Markdown-backed, dokud neni original doplnen.
12. STRATOS package integration: lokalni UI adapter je kompatibilni mezikrok vcetne `StratosPdfViewer`; primy import `@stratos/ui` ceka na sjednoceny workspace nebo publikovany balicek dostupny pro Docker build.
13. Intelligence depth: `/intelligence` ma corpus/readiness analytiku,
    OpenSearch entity/search vrstvu, evidence-backed relationship panel a
    perzistentni analyst cases/saved queries/evidence sets, ale jeste nema
    export case reportu, perzistentni relation snapshots, watchlisty ani
    timeline/mapove zobrazeni.

## Next Recommended Implementation Slices

1. Native viewer/rendering: pokrocila Office fidelity, konverze starsich `.doc/.xls/.ppt`, PDF textovy highlight primo ve vieweru a hlubsi citacni navigace nad existujicim signed source open/page-jump kontraktem.
2. Governance workflow closure: propojit governance result ID na workflow task closure a audit review.
3. Insight review UI: postavit sdileny STRATOS review panel pro accept/edit/reject/open citation nad existujici extraction persistence a potom jej rozsirit na obecne document insights.
4. Workflow approval model: pridat approval steps nad `document_assignments`, sekvencni rozhodovani a quorum pravidla.
5. SLA escalation runtime: pravidelna detekce prekrocenych SLA, audit udalosti, eskalacni tasky a dashboard signal.
6. Object Storage service: presunout signed upload/download z web bridge do backend kontraktu.
7. RAG evaluation: eval dataset pro citace, no-answer rate, retrieval precision a regression gate.
8. STRATOS UI package switch: po sjednoceni repozitaru/build contextu nahradit lokalni adapter primym `@stratos/ui`.
9. Intelligence entity layer: extrahovat entity z chunku, ulozit mentiony s
   citacemi, pridat deduplikaci aliasu a zobrazit detail entity.
10. Intelligence graph/cases: ulozit evidence-backed vztahy, pridat graf,
    watchlisty, alerty po ingestion a analyticky case workspace.

## Maintenance Rule

Pri kazdem vetsim produktovem rezu aktualizuj tento dokument, odpovidajici phase dokument a product QA gate. Pokud se zmeni API kontrakt, aktualizuj i `docs/api/*`, service README a OpenAPI/typy.
