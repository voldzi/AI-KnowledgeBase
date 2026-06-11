# Document Workbench

Document Workbench je produkcni smer pro praci s dokumenty v AKB Platforme. Nahrazuje technicky pruchod dokumentem spravcovskou pracovni plochou pro upload, revize, publikaci a dohled nad znalostmi.

## Stav po prvnim inkrementu

Implementovano ve web aplikaci:

- registr dokumentu s metrikami, fulltext filtrem, filtrem podle stavu, typu a klasifikace,
- ulozene pracovni pohledy: vsechny dokumenty, fronta revize, platna znalost, omezene zdroje a archiv,
- organizacni workflow inbox na `/tasks` pro revize, ingestion varovani, governance kontroly a auditni signaly,
- detail dokumentu rozdeleny na sekce:
  - prehled,
  - viewer,
  - workflow,
  - insighty,
  - verze,
  - ingestion,
  - audit,
- workflow zalozka detailu dokumentu zobrazuje autoritativni Registry tasky a posledni rozhodnuti pro dany dokument,
- workflow zalozka detailu dokumentu zobrazuje a spravuje `document_assignments`: owner, gestor, reviewer, approver, auditor, steward, SLA a eskalace,
- workflow zalozka detailu dokumentu spousti Governance Service akce: compare versions, compliance check a conflict detection; web bridge predava extrahovany source text pro text/Markdown/CSV a DOCX/XLSX/PPTX, u nepodporovanych zdroju ukazuje explicitni metadata fallback; vysledek zobrazuje result ID, confidence, warnings, citace a zdrojova omezeni,
- audit zalozka detailu dokumentu filtruje Registry audit udalosti podle dokumentu, verzi, workflow tasku, assignmentu, ingestion jobu a source-context metadat,
- insights zalozka detailu dokumentu umi vytvorit pracovni `proposed` insighty ze zdrojoveho textu aktualni verze: povinnosti, role, lhuty a rizika; kazdy navrh ukazuje confidence, citaci a source warnings,
- viewer zalozka detailu dokumentu nabizi auditovane source-context signaly a po otevreni chunku zobrazuje citovatelny text, zdroj, verzi, stranu a sekci,
- viewer zalozka detailu dokumentu pripravuje signed source open URL pro zdrojovy objekt a ukazuje, zda je objekt ve storage fyzicky dostupny,
- citace z Knowledge Chat i Employee Assistant pouzivaji jednotny citation viewer: hlavni odpoved zustava cista pro netechnicke role, technicke identifikatory jsou oddelene v detailu a akce `Otevrit dokument` otevre v novem tabu detail dokumentu ve viewer tabu s predvybranym chunkem; explicitni otevreni podepsaneho zdroje zustava v detailu dokumentu,
- pokud je podepsany zdroj dostupny a source-context obsahuje `page_number`, viewer nabidne otevreni zdroje na strance citace pomoci `#page=N`,
- nativni preview nad signed source zobrazuje PDF pres pdf.js render citacni strany s textovou vrstvou a bbox overlayem, Markdown jako formatovany dokument s GFM tabulkami, obsahem a zvyraznenim citace, image/OCR jako obrazek s bbox overlayem, DOCX jako odstavce, XLSX jako tabulky, PPTX jako slidy, text jako bezpecny textovy nahled a CSV jako tabulku s aktivnim radkem,
- `/tasks` umoznuje nad Registry workflow tasky spustit `assign`, `request_changes`, `approve` a `resolve`,
- workflow zalozka detailu dokumentu ma publish gate: publikace je dostupna jen pro `approved` dokument a archivace jen pro aktualni `valid` verzi,
- upload preflight s nazvem souboru, velikosti, MIME typem a SHA-256 hashem,
- podepsana upload session na `/api/controlled-document/upload/preflight` a PUT do `/api/controlled-document/upload/sessions/{sessionId}/content`,
- ulozeni zdrojoveho souboru do sdileneho object-storage volume, ze ktereho Ingestion Service cte `s3://akl-documents/...`,
- aplikacni napoveda na `/help`,
- dokumentace ciloveho workflow a dalsich kroku.

## Cilovy workflow

Produkci workflow ma byt:

1. zalozit metadata dokumentu v Registry API,
2. spustit preflight validaci souboru,
3. nahrat zdrojovy soubor pres podepsanou upload session,
4. vytvorit draft verzi s overenymi file metadaty,
5. spustit ingestion,
6. zkontrolovat parser, chunking, OCR a indexaci,
7. spustit governance kontroly,
8. predat vlastnikovi nebo gestorovi do revize,
9. schvalit dokument do stavu `approved`,
10. publikovat platnou verzi,
11. archivovat nebo supersedovat predchozi verze.

Route `/api/controlled-document/ingestion` uz nepublikuje automaticky. Pokud dostane `upload_token`, overi konzistenci dokumentu, session, source URI, hashe, velikosti a MIME typu proti preflight podpisu. Pak vytvori draft verzi a zaradi ingestion job; publikace jde az po review approval pres Registry API publish gate.

## Nápověda V Aplikaci

Route: `/help`

Obsahuje:

- rychly start pro dokumentovou praci,
- role spravce dokumentu, vlastnika/gestora a auditora,
- registry postupy,
- upload a preflight,
- viewer a citace,
- publikacni workflow,
- governance kontroly,
- znalostni chat,
- varovani a chyby.

Napoveda je dvojjazycna a pouziva stejny jazykovy kontext jako zbytek webu.

## Product QA Gate

Produktova kontrola Document Workbench je popsana v `docs/qa/document-workbench-product-qa.md`.

QA gate pokryva:

- kriticke scenare registry, uploadu, workflow, publish gate, RAG citaci a napovedy,
- role spravce dokumentu, gestora/revizora, auditora a zamestnance,
- chybove stavy bez legacy kompatibility,
- viewport matrix,
- vykonova ocekavani pro Docker stack,
- sign-off sablonu pro PR a release.

## Další Implementační Kroky

### Registry API

- Rozsirit stavovy automat o vicekrokove schvalovani nad existujicim `document_assignments` modelem.
- Pridat retention/disposition metadata.
- Rozsirit signed source open o backend-owned Object Storage kontrakt a dlouhodobou evidenci upload/download session.
- Doplnit runtime SLA eskalace nad existujicimi assignment metadaty.

### Ingestion Service

- Prevzit upload session jako samostatny kontrakt mimo web bridge nebo pres Object Storage service.
- Ukladat detailni source-location metadata pro PDF, DOCX, tabulky, prezentace a OCR.
- Vracet parser confidence a material warnings v reportu.

### RAG Retrieval Service

- Doplnit hybridni retrieval: sparse/BM25 + vektory + metadata filtry.
- Doplnit second-stage reranking a vysvetleni ranking signalu.
- Rozsirit source-context o before/after text a presnou viewer lokaci.

### Governance Service

- Doplnit serverovou PDF/OCR textovou extrakci pro governance bridge nad stejnym source-object kontraktem.
- Propojit governance result ID na workflow task closure a audit review.

### Insights

- Persistovat navrzene insighty do Registry jako `document_insights`.
- Doplnit stavovy workflow `proposed -> approved/rejected`.
- Schvalene insighty pouzivat jako governed knowledge pro RAG a nápovědu.

### Web UI

- Prepojit lokalni STRATOS UI adapter na sdileny `@stratos/ui` balicek pres GitHub Packages, jakmile AKL lokalni/CI build dostane read-only `read:packages` token.
- Doplnit pokrocile Office fidelity prvky nad stejnym signed source kontraktem.
- Doplnit PDF textovy highlight primo ve vieweru a hlubsi native renderer integraci pro citace.
