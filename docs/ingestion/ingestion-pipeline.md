# Ingestion Pipeline

Tento dokument popisuje implementovaný tok `services/ingestion-service`.

## Tok Jobu

1. `POST /api/v1/ingestion/jobs` přijme `document_id`, `document_version_id`, `source_file_uri`, parser profile, OCR flag, chunking strategy a embedding profile.
2. Služba uloží `IngestionJob` do lokálního job/report store.
3. Pipeline získá krátkodobý OIDC token vlastního Registry clientu
   `svc-ingestion` a zavolá Registry API authz check pro `document.ingest`.
   Inbound user subject je pouze `subject_id` rozhodnutí; jeho bearer se
   nepřeposílá.
4. Pipeline pod stejnou vlastní service identity načte metadata dokumentu a
   verze přes Registry API.
5. Object storage klient načte zdrojový soubor.
6. Parser router volí adaptér podle sdíleného [katalogu formátů](../CONTRACTS/DOCUMENT_FORMAT_CAPABILITIES_V1.md): HTML, XLSX/XLSM, PPTX, podporované prosté a strukturované texty, PDF nebo DOCX. Volitelný Docling může běžet v režimu `shadow`, `prefer` nebo `enforce`; výchozí `off` zachovává nativní cestu. GraniteDocling se používá jen pro PDF. HTML zachovává nadpisy a přeskakuje skripty/styly. [Nativní Office extrakce](native-office-extraction.md) zachovává prázdné buňky, přesné řádky listů, snímky, tabulky a poznámky; list ani snímek nepředstírá fyzickou PDF stránku. TextParser přijímá také katalogem povolené YAML a serializované architekturní/API texty, vždy s `page_number=null`, `pages_processed=0` a nedostupným mapováním fyzických stránek.
7. V nativní cestě se OCR použije při nízkém množství textu nebo chybějícím textu na jednotlivých PDF stránkách; souhrnná délka textu nepřeskakuje kontrolu pokrytí PDF. Providery zahrnují `sidecar`, `tesseract` a `ocrmypdf`. Výchozí `ocrmypdf` zpracovává PDF a výslovně směruje PNG/JPEG/WEBP na přítomný Tesseract. Nativní raster je omezen na jediný snímek a 25 megapixelů, vyžaduje kontrolu a nemění originál. Překročení limitů zpracování a šifrovaný Office archiv jsou terminální chyby před OCR fallbackem. OCR výstup ukládá metadata enginu, jazyka, pokrytí a kvality.
8. Pipeline vytvoří `quality` report s `quality_score`, `quality_tier` a `requires_review`; nízká kvalita OCR přidá varování `LOW_OCR_QUALITY` nebo `OCR_EMPTY_PAGES`.
9. Logical chunker vytvoří `DocumentChunk` objekty s citovatelnými metadaty včetně parser/OCR quality evidence.
10. Pravidlová Intelligence entity vrstva `rule_based_v1` doplní do `metadata.intelligence` deterministické entity z chunk textu: `email`, `url`, `ipv4`, `phone`, `date` a `document_number`.
11. Embedding klient pošle normalizované texty na LLM Gateway `/api/v1/embeddings` jako service identity `svc-ingestion`, s audience `llm-gateway-service`, rolí `service_ingestion` a samostatným gateway tokenem. Caller OIDC token se do gateway nepřeposílá. Dávky (`AKL_INGESTION_EMBEDDING_BATCH_SIZE`, default 32) běží paralelně s omezenou souběžností (`AKL_INGESTION_EMBEDDING_CONCURRENCY`, obecný default 2). Produkční docker-home profil používá konzervativní `AKL_INGESTION_EMBEDDING_CONCURRENCY=1`, aby re-index netlačil na jednu Ollama instanci více paralelními embedding požadavky. Pořadí vektorů je zachováno.
12. Indexer uloží chunk payloady podle `AKL_INGESTION_INDEXER_MODE`: do Qdrantu pro vektorové vyhledávání a volitelně do OpenSearch pro fulltext. Entity typy, hodnoty a páry typ-hodnota se promítají také do top-level payload polí `entity_types`, `entity_values` a `entity_pairs`.
13. Služba přes úzký `ingestion-status` route grant synchronizuje pouze job id a
    `INGESTING`, `INDEXED` nebo `FAILED` pro přesnou verzi, kterou řízený intake
    už nastavil jako current. Pointer, file, URI a lineage změnit
    nesmí.
14. Služba uloží `IngestionReport` a pod vlastní Registry service identity
    auditně zapíše start/completed/failed; inbound actor zůstává v payloadu jako
    neautoritativní reported actor.

## Smíšené PDF a mapování OCR stránek

Po úspěšném nativním čtení PDF router zkontroluje každou fyzickou stránku.
Stránky bez textových bloků odešle OCRmyPDF v jedné dočasné PDF podmnožině.
Původní soubor v úložišti ani nativní text ostatních stránek se nemění.
OCRmyPDF nad touto podmnožinou zachovává stávající `--force-ocr`, deskew,
rotate-pages, jazyk a timeout; nativní stránky se znovu nerasterizují.

Výstupní OCR sidecar se dělí po form-feed hranicích. Počet stran musí přesně
odpovídat podmnožině (přípustný je závěrečný form-feed). Každá stránka se
parsuje samostatně a vrací původní číslo stránky, například podmnožina 2, 4
se vrátí jako 2, 4, nikoli 1, 2. Lokální `sidecar` provider pro tuto cestu
vyžaduje přesné hranice všech stránek původního PDF a použije jen chybějící
stránky. Nejednoznačný souvislý OCR přepis se neslučuje s nativním textem.
Logical chunker nepřekračuje hranici fyzické stránky, i když by se více
stránek vešlo do velikostního limitu. Odstavce stejné sekce na stejné stránce
se mohou spojit; překryv dlouhého bloku zůstává uvnitř jeho původní stránky.
Indexovaný chunk tak nenese text jiné stránky pod citací první stránky.

Metadata nesou `ocr_pages_requested`, `ocr_pages_completed`, `empty_pages`
a `page_mapping=original_pdf_pages`. Vypnuté nebo nedostupné OCR, timeout,
neúspěch procesu, chybějící sidecar, nesouhlas počtu stran nebo prázdný OCR
výstup zachovají čitelný nativní obsah, ale přidají
`PDF_PAGES_REQUIRE_REVIEW` a `requires_review=true`; report nevykazuje plné
pokrytí ani kvalitu `good`. Stejnou kontrolu vyžadují skutečně prázdné stránky,
protože absence textu sama nerozlišuje prázdnou stránku od nečitelného skenu.

Test `services/ingestion-service/tests/test_mixed_pdf_ocr.py` vytváří skutečný
pětistránkový PDF s nativními stránkami 1, 3, 5 a rasterovými stránkami 2, 4.
Nativní parser i sestavení OCR podmnožiny běží skutečně; nahrazený je pouze
externí OCR proces. Test tedy dokládá směrování, mapování a chyby, nikoli
přesnost konkrétního OCR enginu. Textové pokrytí také nedokládá úplnost
kombinovaných obrázků a textu uvnitř jedné stránky; to vyžaduje obsahové QA.
Režimy Docling `prefer` a `enforce` nadále mají vlastní extrakční cestu.

## Struktura aplikační dokumentace

- Markdown se parsuje přes CommonMark s tabulkami a front matter. Zachovává
  hierarchii nadpisů, celé řádky tabulek a znakové rozsahy originálu. HTML
  se nespouští a odkazy se nestahují. YAML front matter nemůže určit publikaci,
  schválení ani Information Policy; ty pocházejí výhradně z Registry.
- DOCX zachovává pořadí odstavců a tabulek v těle dokumentu, stylové nadpisy
  a prázdné buňky. Obrázky, textová pole, sledované změny a vnořené tabulky
  vyžadují kontrolu vykresleného zdroje. Jejich `requires_review` nezanikne
  pouze proto, že je ostatního textu dostatek.
- XLSX zachovává prázdné buňky, aby se hodnota nepřiřadila k jiné hlavičce.
  Tabulkové pokračování opakuje hlavičku a nedělí jednotlivé řádky.
- Markdown a DOCX bez renderované mapy mají `page_number=null` a počet
  zjištěných fyzických stran `pages_processed=0`. Hodnocení textové kvality
  používá jeden logický dokument, nikoli vymyšlenou stranu 1. Citace se
  opírají o sekci a znakový rozsah; u DOCX je rozsah v extrahovaném textu.
  Nulový počet známých stran sám neznamená nekvalitní nebo prázdný text.
- Kvalita extrakce není důkaz věcné správnosti, úplnosti obrázků ani platnosti
  dokumentu. Návrhy infrastruktury a autorské vzory se nesmějí vydávat za
  ověřené nastavení konkrétní instalace.

## Docling a GraniteDocling

Řízené režimy, lokální modelový balík, bezpečnostní omezení, akceptační metriky
a postup přechodu jsou popsány v [Docling a GraniteDocling](docling-granite.md).

Změna parseru sama nepřepíše existující index. Již vložené dokumenty je
nutné po ověření releasu řízeně znovu zpracovat přes existující ingestion
workflow s přesnou verzí a hashem zdroje. Nevytvářet duplicitní dokumenty,
neobcházet antivirovou kontrolu, revizi ani publikaci.

## Integrační Body

Registry API:

- `POST /api/v1/authz/check`
- `GET /api/v1/documents/{document_id}`
- `GET /api/v1/documents/{document_id}/versions/{version_id}`
- `PATCH /api/v1/documents/{document_id}/external-references/current`
- `POST /api/v1/audit/events`

LLM Gateway:

- `POST /api/v1/embeddings`

Qdrant:

- `GET /collections/{collection}`
- `PUT /collections/{collection}`
- `POST /collections/{collection}/points/delete`
- `PUT /collections/{collection}/points`
- provozní backfill existujících point payloadů přes `scripts/backfill_qdrant_entities.py`, který dopočítá stejný `metadata.intelligence` profil a top-level entity pole bez změny vektorů.

OpenSearch:

- bulk index chunk dokumentů do `AKL_OPENSEARCH_INDEX`, pokud je zapnutý v `AKL_INGESTION_INDEXER_MODE`.
- idempotentní mapping pro `entity_types`, `entity_values` a `entity_pairs` nad existujícím indexem.
- servisní read-only endpoint `POST /api/v1/intelligence/entities/facets/query`
  pro Intelligence Workbench facety nad přesně autorizovaným OpenSearch
  korpusem. Legacy `GET /api/v1/intelligence/entities/facets` je dostupný pouze
  v lokálním mock/disabled režimu a v produkci fail-closed.
- servisní read-only endpoint `POST /api/v1/intelligence/analyst/search` pro
  pokročilé analytické hledání nad autorizovanými chunk payloady. Podporuje
  režimy `smart`, `boolean`, `phrase`, `proximity` a `fielded`; fielded dotazy
  používají auditovatelné aliasy `title:`, `body:`, `section:`, `entity:`,
  `source:`, `type:` a `class:`.
- servisní read-only endpoint `POST /api/v1/intelligence/entities/search` pro
  citované entity/fulltext nálezy nad chunk payloady.
- servisní read-only endpoint `POST /api/v1/intelligence/entities/relationships`
  pro evidence-backed vztahy mezi entitami. První profil vytváří
  nedirekcionální `co_occurs` hrany z entit ve stejném chunku, počítá počet
  důkazů/dokumentů a vrací citované evidence chucky.
- všechny produkční Intelligence POST dotazy nesou Registry-issued proof a
  přesně seřazené souřadnice `document_id`, `document_version_id` a
  `policy_hash`. Ingestion proof potvrdí přes Registry a teprve potom z
  potvrzených souřadnic odvodí OpenSearch filtry. Klientské
  `allowed_document_ids` ani statická role samy o sobě nejsou oprávnění;
  server-side web bridge navíc výsledky znovu ořeže podle stejné potvrzené
  množiny před odesláním do browseru.
- provozní backfill existujících chunků přes `scripts/backfill_opensearch_entities.py`, který dopočítá `metadata.intelligence`, top-level entity pole a `search_text` přímo v OpenSearch bez změny Registry, Qdrantu, OCR výstupů nebo embeddingů.

Object storage:

- lokální `file://` a mapované `s3://bucket/key`,
- HTTP/presigned URL režim.

## Stavový Model

Podporované statusy odpovídají centrálnímu datovému kontraktu:

```text
queued
running
completed
failed
cancelled
completed_with_warnings
```

`completed_with_warnings` se používá například při OCR fallbacku, parser warnings nebo nízké kvalitě OCR. `failed` se ukládá do reportu s chybovým kódem bez obsahu dokumentu.

## Bezpečnost

Služba nesmí publikovat dokument jako platný. Publikace zůstává odpovědností Registry API workflow.

Do logů a audit metadata nejdou celé dokumenty ani embedding input texty. Audit metadata obsahují jen ID dokumentu/verze, počet chunků, OCR flag, quality score/tier, status a error code.

Produkční konfigurace odmítá mock Registry, mock object storage, mock embedding i
mock indexer. Zároveň vyžaduje úplné Registry client credentials pro
`svc-ingestion`; žádná Registry cesta nesmí fallbackovat na inbound caller
bearer. Readiness zahrnuje i úspěšné získání této krátkodobé identity.
Neúspěch vrací HTTP `503` s `registry=not_ready`.

## Entity Backfill Pro Existující Indexy

Nová entity vrstva se do nově ingestovaných chunků zapisuje automaticky do
Qdrantu i OpenSearch. Pro existující OpenSearch index lze použít idempotentní
backfill:

```bash
python scripts/backfill_opensearch_entities.py \
  --opensearch-url http://opensearch:9200 \
  --opensearch-index akl_document_chunks \
  --batch-size 500
```

For central production OpenSearch, also provide
`--opensearch-username`, `--opensearch-password-file`, and
`--opensearch-ca-file`. The complete managed-alias procedure is in
`docs/OPERATIONS/central-opensearch.md`.

Před produkčním během použijte read-only kontrolu:

```bash
python scripts/backfill_opensearch_entities.py \
  --opensearch-url http://opensearch:9200 \
  --opensearch-index akl_document_chunks \
  --batch-size 200 \
  --limit 500 \
  --dry-run
```

Backfill čte `text` nebo `normalized_text`, spouští profil `rule_based_v1`,
zachovává existující `metadata`, přidává `metadata.intelligence`, promítá
`entity_types`, `entity_values` a `entity_pairs` do top-level polí a aktualizuje
`search_text`, aby fulltext zachytil i normalizované entity. Neloguje text
dokumentů ani hodnoty entit; průběžný výstup obsahuje pouze počty.

Pro existující Qdrant vektorovou kolekci použijte:

```bash
python scripts/backfill_qdrant_entities.py \
  --qdrant-url http://qdrant:6333 \
  --collection akl_document_chunks \
  --batch-size 256
```

Qdrant backfill mění pouze payload pointů: `metadata.intelligence`,
`entity_types`, `entity_values` a `entity_pairs`. Vektory, embedding model ani
identita pointů se nemění. Před produkčním během lze použít `--dry-run` a po
doběhu `--missing-only --dry-run`, který má vrátit `updated=0`.

Tento postup neopravuje špatně vytěžený zdrojový text. Dokumenty s nízkou OCR
kvalitou je potřeba reingestovat po zlepšení OCR/parsing vrstvy.
