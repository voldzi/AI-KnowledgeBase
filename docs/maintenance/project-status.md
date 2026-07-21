# AKB Project Status

Validated: 2026-07-21 against immutable production commit
`786bc2bd7c7a964efd3c078d930eebbba06209c7`.

Tento dokument je konsolidovany rozcestnik aktualniho stavu AKB Platform. Detailni
kontrakty a provozni pravda zustavaji v odkazovanych architektonickych, API,
security, deployment a QA dokumentech; tento souhrn je nenahrazuje.

## Executive Summary

AKL uz neni jen MVP pro upload URI a RAG dotaz. Aktualni stav je lokalni enterprise knowledge platform smerovana na rizene dokumenty:

- Registry API vlastni dokumenty, verze, access policies, audit, workflow tasky a organizacni odpovednosti.
- Ingestion Service zpracovava zdrojove soubory, parser/chunking/OCR profil a indexing report.
- RAG Retrieval Service vraci citace a source-context.
- RAG Retrieval Service obsahuje prvni STRATOS Document AI extraction profil
  `contract_financial_v1` ve verzi `2` pro Budget smlouvy; oddelene platebni
  navrhy jsou typovane, citovane a fail-closed, vysledky a feedback se
  perzistuji v Registry API jako navrhy s citacemi. Verze `1` zustava
  dostupna pro rolling deployment a ma oddelenou idempotentni identitu.
- Web aplikace obsahuje Document Workbench, Intelligence Workbench, workflow inbox, upload preflight, napovedu v aplikaci a Employee Chat Portal.
- Web shell, zakladni UI primitiva a PDF viewer pouzivaji publikovany
  `@voldzi/stratos-ui`; lokalni kod zustava jen u AKB domenovych adapteru a
  routingu.
- Upload/source opening a native preview jsou rozsirene na bezne Office, PDF, obrazkove, textove a strukturovane typy; stare binarni Office formaty `.doc/.xls/.ppt` zustavaji pro plnohodnotnou ingestion/rendering konverzni backlog.
- Produkcni audit 2026-06-11 potvrdil, ze stavajici importovane dokumenty maji
  jako aktualni zdroj Markdown derivaty; 20 dostupnych raw PDF originalu lze
  inventarizovat dry-runem `tools/import_original_pdf_versions.py`, 3 dokumenty
  cekaji na doplneni originalniho PDF. Host-side `--apply` je ve vsech
  prostredich retired; import prochazi governed aplikacnim UI/API.
- GitHub je stabilizovany pres chraneny `main`, PR workflow, CI gate a immutable
  release proces. Produkce bezi z presneho commitu uvedeneho vyse.

Zaklad produkcniho dokumentoveho systemu existuje. Nejvetsi zbyle mezery jsou
federovane cteni zivych domenovych dat pro Copilota reditele, hlubsi viewer
fidelity pro komplexni Office/PDF dokumenty, obecne schvalovane AI insighty,
vicekrokove schvalovani, runtime SLA eskalace a presun upload/download kontraktu
mimo web bridge.

## Current GitHub Baseline

- Autoritativni baseline je commit `786bc2bd7c7a964efd3c078d930eebbba06209c7`
  na `main`, stejny jako aktivni produkcni release k datu validace.
- CI pokryva repository standardy, OpenAPI, tajemstvi, Docker Compose profily,
  web typecheck/test/build/Playwright a Python sluzby vcetne databazovych smoke
  testu.
- `main` je chraneny pres PR gate a povinne CI checks; historicky tag
  `v0.1.0-local-platform` uz neni definici aktualni produkcni verze.

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
- AKB Assistant ma serverove perzistentni vlakna, zpravy, pripnuti, archivaci,
  retenci, odstraneni a sdileni s overenymi osobami. Platformni trasy `/chat` a
  `/assistant` zustavaji kompatibilni; samostatny chat-only profil je produkcne
  dostupny na kanonicke adrese `https://chat.zeleznalady.cz/`.
- Budget contract extraction je dostupna pres
  `/api/v1/stratos/extractions/contracts/propose`. Profil
  `contract_financial_v1` verze `2` vraci pouze navrzene hodnoty s citaci
  (`document_id`, `document_version_id`, `chunk_id`, page/section,
  `quoted_text`, `viewer_url`). Platebni ujednani vraci jako samostatna
  `payment_rules`; nezname casovani, call-off a variabilni cerpani
  negeneruji cashflow. Profil uklada vysledek do Registry
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
- UI zaklad pouziva sdileny `@voldzi/stratos-ui` shell, rail, topbar, navigaci,
  datove a formularove komponenty i PDF viewer. AKB nevlastni kopie shellu,
  mobilniho draweru, backdropu ani jejich opravne CSS.

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
  relationship edges. Web bridge pro vsechny produkcni search/graph/facet
  dotazy ziska z Registry kratkodoby proof nad presnymi
  document/version/policy-hash souradnicemi. Ingestion proof potvrdi pres
  Registry pred OpenSearch dotazem a web vysledky znovu oreze pred browserem;
  samotne klientské `allowed_document_ids` neni autorita.
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
9. RAG quality: produkcni verzovany dataset a fail-closed quality gate existuji;
   backlogem je rozsirovani gold pripadu pro nove domeny, mezidomenove dotazy,
   konflikty, casovou aktualnost a pravidelne sledovani provozniho driftu.
10. Directory governance: sdileni s osobami je serverove overene; nove skupinove
    sdileni zustava fail-closed do doby, nez STRATOS poskytne autoritativni
    organizacni skupinovy adresar.
11. Source originality: dostupne originalni PDF zdroje lze inventarizovat
    dry-runem `tools/import_original_pdf_versions.py`; produkcni prevod je
    dostupny jen pres governed aplikacni UI/API. Host tool je ve vsech profilech
    pouze dry-run a pred mutaci fail-closed. Dokumenty bez raw PDF zustavaji
    Markdown-backed, dokud neni original doplnen.
12. Management copilot: chat zatim nema federovane read-only domenove nastroje,
    mezidomenovy plan dotazu, jednotny dukazni snapshot ani tvorbu PPTX/DOCX ze
    stejne analyticke pravdy.
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
7. Director Copilot foundation: zavest jednotny `EvidenceItem`, query plan v2,
   read-only domenove nastroje a strictest-policy vysledny snapshot podle
   `docs/ARCHITECTURE/director-copilot-implementation-plan.md`.
8. RAG evaluation expansion: rozsirit produkcni gate o mezidomenove scenare,
   aktualnost, konflikty a dostupnost pouze casti zdroju.
9. Intelligence entity layer: extrahovat entity z chunku, ulozit mentiony s
   citacemi, pridat deduplikaci aliasu a zobrazit detail entity.
10. Intelligence graph/cases: ulozit evidence-backed vztahy, pridat graf,
    watchlisty, alerty po ingestion a analyticky case workspace.

## Maintenance Rule

Pri kazdem vetsim produktovem rezu aktualizuj tento dokument, odpovidajici phase dokument a product QA gate. Pokud se zmeni API kontrakt, aktualizuj i `docs/api/*`, service README a OpenAPI/typy.
