# Document Workbench

Document Workbench je produkcni smer pro praci s dokumenty v AKB Platforme. Nahrazuje technicky pruchod dokumentem spravcovskou pracovni plochou pro upload, revize, publikaci a dohled nad znalostmi.

## Stav po prvnim inkrementu

Implementovano ve web aplikaci:

- registr dokumentu s metrikami, fulltext filtrem, filtrem podle stavu, typu a klasifikace,
- ulozene pracovni pohledy: vsechny dokumenty, fronta revize, platna znalost, omezene zdroje a archiv,
- osobni pracovni prehled `/tasks`: `Ke schvaleni`, `Moje ukoly` a `Moje dokumenty`; tymovy prehled zustava jen spravci AKB,
- detail dokumentu vede uzivatele peti hlavnimi kroky:
  - zakladni udaje,
  - dokument a prilohy,
  - overena pravidla,
  - kontroly,
  - schvaleni a publikace,
- historie verzi, technicky stav zpracovani a audit jsou oddelene v rozbalovaci sekci `Dalsi informace`,
- kazdy hlavni krok ukazuje stav `hotovo`, `vyzaduje pozornost` nebo `ceka` a detail nabizi jeden doporuceny dalsi krok,
- klikaci napoveda u hlavnich sekci vysvetluje, co ma uzivatel zkontrolovat; funguje stejne mysi, klavesnici i dotykem,
- technicke identifikatory, file hash, source URI, viewer mode, ingestion job ID a policy binding nejsou v beznem pohledu dominantni a zustavaji dostupne v rozbalovacich technickych detailech,
- workflow zalozka detailu dokumentu zobrazuje autoritativni Registry tasky a posledni rozhodnuti pro dany dokument,
- workflow zalozka detailu dokumentu zobrazuje a spravuje `document_assignments`: owner, gestor, reviewer, approver, auditor, steward, SLA a eskalace,
- samostatny krok `Kontroly` spousti Governance Service akce: compare versions, compliance check a conflict detection; web bridge predava extrahovany source text pro text/Markdown/CSV a DOCX/XLSX/PPTX, u nepodporovanych zdroju ukazuje explicitni metadata fallback; vysledek zobrazuje nalezy, doporucene akce a citace, zatimco technicke ID a diagnostika zustavaji sekundarni,
- audit zalozka detailu dokumentu filtruje Registry audit udalosti podle dokumentu, verzi, workflow tasku, assignmentu, ingestion jobu a source-context metadat,
- krok `Pravidla` zobrazuje autoritativni controlled-document balicky, potvrzene i navrzene citovane limity, precedence konflikt a priznak pouzitelnosti dalsimi aplikacemi STRATOS,
- opravneny gestor muze navrzena pravidla potvrdit nebo odmitnout a muze nad existujicim balickem znovu spustit rizene vytezovani; sprava celeho vydani zustava v `/controlled-documentation`,
- pracovni plocha `/controlled-documentation` vede gestora posloupnosti `schvalit vydani -> navrhnout pravidla -> overit navrhy -> vyhlasit jako platne`; kazde vydani zobrazuje svuj aktualni krok a duvod zablokovane publikace,
- metriky, oblast pravidel a hlavni sekce maji dotykovou i klavesnicovou kontextovou napovedu; technicky nazev `public_procurement` se v beznem pohledu zobrazuje jako `Verejne zakazky`,
- hlavni dokument a prilohy se zobrazuji uzivatelskym nazvem a roli, nikoliv hashem verze; package, version a rule ID zustavaji dostupne pouze ve sbalenych technickych podrobnostech,
- kazde vytezene pravidlo ukazuje lidsky typ zdroje, stav overeni a odkaz `Otevrit citovane misto`, ktery otevre autorizovany viewer na presnem chunku,
- detail dokumentu pouziva bezpecny kontextovy navrat: z registru, rizene dokumentace, ukolu, Intelligence nebo souvisejiciho dokumentu vede zpet na puvodni pracovni plochu a zachovava jeji podstatne filtry, datum nebo sekci; primy hluboky odkaz bez kontextu ma fallback do registru,
- `return_to` prijima pouze povolene relativni AKB cesty svazane s pevnym typem puvodu; externi, nesouhlasne nebo poskozene cile se fail-closed nahradi registrem a stejny parametr se zachovava pres OIDC prihlaseni,
- neznamy upstream text se do uzivatelske hlasky nepropaguje; UI pouzije cesky bezpecny postup a stabilni API chybovy kod zustava zachovan pro integrace a audit,
- pomocne `proposed` insighty ze zdrojoveho textu aktualni verze zustavaji dostupne pouze v sekundarni rozbalovaci sekci a nejsou vydavany za zavazna pravidla,
- viewer zalozka detailu dokumentu nabizi auditovane source-context signaly a po otevreni chunku zobrazuje citovatelny text, zdroj, verzi, stranu a sekci,
- viewer zobrazuje balicek vydani a vazby na prilohy, formulare, sablony a hlavni dokument; prazdny nebo docasne nedostupny vztahovy kontext je rozlisen od chyby samotneho dokumentu,
- viewer zalozka detailu dokumentu pripravuje signed source open URL pro zdrojovy objekt a ukazuje, zda je objekt ve storage fyzicky dostupny,
- citace z Employee Chat Portal pouzivaji jednotny citation viewer: hlavni odpoved zustava cista pro netechnicke role, technicke identifikatory jsou oddelene v detailu a akce `Otevrit dokument` otevre v novem tabu primo zdrojovy soubor pres assistant citation redirect,
- pokud je podepsany zdroj dostupny a source-context obsahuje `page_number`, viewer nabidne otevreni zdroje na strance citace pomoci `#page=N`,
- nativni preview nad signed source zobrazuje PDF pres pdf.js render citacni strany s textovou vrstvou a bbox overlayem, Office formaty pres serverovou PDF zobrazovaci kopii, Markdown jako formatovany dokument s GFM tabulkami, obsahem a zvyraznenim citace, image/OCR jako obrazek s bbox overlayem, text jako bezpecny textovy nahled a CSV jako tabulku s aktivnim radkem,
- `/tasks` zobrazuje pouze serverem povolene akce; predany schvalovaci ukol muze rozhodnout prirazeny schvalovatel nad presnou verzi, nikoli obecnou akci `resolve`,
- workflow zalozka detailu dokumentu umoznuje `Predat ke schvaleni`; publikace vyzaduje schvalenou presnou verzi, nezmeneny zdroj a aktualni opravneni. Starsi publikovana verze zustava platna behem pripravy nahrady. Archivace je samostatna akce pro aktualni `valid` verzi,
- verze zalozka detailu dokumentu obsahuje navodny panel s aktualnim stavem verze, doporucenym dalsim krokem a vysvetlenim, ze nova verze ma vznikat pres originalni soubor a rizene volby zmeny, ne jako volna poznamka,
- upload preflight s nazvem souboru, velikosti, MIME typem a SHA-256 hashem,
- podepsana upload session na `/api/controlled-document/upload/preflight` a PUT do `/api/controlled-document/upload/sessions/{sessionId}/content`,
- ulozeni zdrojoveho souboru do sdileneho object-storage volume, ze ktereho Ingestion Service cte `s3://akl-documents/...`,
- upload formular sklada `change_summary` z rizene volby typu zmeny, dopadu zmeny a doporuceneho dalsiho kroku; uzivatel nepise souhrn zmeny do volneho textu,
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
8. predat pripravenou presnou verzi prirazenemu schvalovateli,
9. schvalit verzi do stavu `approved`, nebo ji vratit gestorovi s pripominkami,
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

- Prubezne zuzuovat lokalni STRATOS UI adapter na tenke mapovani k publikovanemu `@voldzi/stratos-ui` balicku z verejneho npm registry.
- Doplnit diagnostiku fontovych substituci a presnejsi citacni navigaci nad Office PDF zobrazovaci kopii.
- Doplnit PDF textovy highlight primo ve vieweru a hlubsi native renderer integraci pro citace.
