# RAG V2

## Implementovaný tok

1. Query analyzer volí profil `exact`, `document_scoped`, `semantic`,
   `temporal`, `cross_document` nebo `copilot_live_data`.
2. Profil nastaví candidate limit, poměr dense/BM25 a maximální počet dokumentů.
   Nákladné stupně mají samostatný profilový rozpočet; výstupní `max_chunks`
   proto automaticky nenásobí počet vstupů cross-encoderu.
3. Profil `exact` nejprve použije lexikální resolver nad identifikátorem,
   názvem a zdrojovými metadaty. Jednoznačný dokument se autorizuje a další
   retrieval se omezí na jeho ID ještě před embeddingem a corpus-wide fusion.
   Nejednoznačný nebo nenalezený identifikátor bezpečně pokračuje standardní
   hybridní cestou.
4. Qdrant a OpenSearch vrátí kandidáty. Běžný dotaz používá jen platné verze;
   explicitní version filter nebo časový profil může pracovat s historií.
5. Registry autorizuje document ID, version ID a policy hash.
6. Deduplikace odstraní shodné a téměř shodné chunky stejné verze.
7. Volitelný ColBERT pracuje jen s autorizovanými point ID. Cross-encoder dostane
   pouze autorizované texty. Lexical reranker je fallback.
8. Diverzifikace omezuje počet chunků jednoho dokumentu.
9. Parent expansion načte sousedy stejné verze, znovu je autorizuje a sloučí
   překryvy. Citace zůstává na původním konkrétním chunku.
   Pro `retrieve_only` se parent expansion nespouští, protože nemění evaluační
   výsledek a pouze zvyšuje latenci.
10. Evidence gate po generování mapuje tvrzení na chunk ID. V `enforce` odstraní
   nepodložená vedlejší tvrzení a nepodložené hlavní tvrzení změní na no-answer.

## Režimy a konfigurace

| Vrstva | Režim | Hlavní proměnné |
| --- | --- | --- |
| V2 dual-write | `AKL_RAG_V2_INDEX_MODE` | `AKL_QDRANT_V2_COLLECTION` |
| V2 dense read | `AKL_RAG_V2_RETRIEVAL_MODE` | `AKL_QDRANT_V2_COLLECTION` |
| Cross-encoder | `AKL_RAG_RERANKER_MODE` | provider, URL list, model, revision, timeout, batch, min score |
| Adaptivní retrieval | `AKL_RAG_ADAPTIVE_RETRIEVAL_MODE` | profil, candidate limit, dense/BM25 váha |
| Parent retrieval | `AKL_RAG_PARENT_RETRIEVAL_MODE` | window, max chunks per document |
| Evidence gate | `AKL_RAG_EVIDENCE_GATE_MODE` | minimum overlap |
| ColBERT ingestion | `AKL_RAG_COLBERT_INDEX_MODE` | encoder URL, model, token, vector size |
| ColBERT query | `AKL_RAG_COLBERT_MODE` | encoder URL, model, candidate limit |

Všechny režimy mají hodnoty `off`, `shadow`, `enforce`. `shadow` nesmí změnit
finální pořadí ani odpověď. Docker Home produkční profil používá pro evidence
gate výchozí režim `enforce`; ostatní experimentální RAG V2 vrstvy zůstávají
ve výchozím stavu `off`.

Evidence gate používá deterministický verifier, pokud není nastaven
`AKL_RAG_EVIDENCE_VERIFIER_MODEL`. Při nastaveném interním modelu vyžaduje
striktní claim JSON a server znovu ověřuje existenci chunk ID i doslovnou
přítomnost `quoted_support`. Výpadek modelového verifieru v `enforce` končí
no-answer. Do autorizovaného evidence envelope patří vedle textu také název
dokumentu a cesta sekce. Přesná odpověď založená na názvu předpisu proto může
projít verifikací bez oslabení chunkové autorizace. Nepodložené hlavní tvrzení
končí standardním no-answer bez citací a bez `used_chunks`.

Evidence gate se uplatňuje také na běžný `/assistant/chat`. Copilot ředitele
používá oddělenou deterministickou cestu: nejvýše tři autorizované smluvní
výňatky, bez dokumentové LLM syntézy a bez dalšího LLM volání pro follow-up.
Proto se jeho extraktivní výstup znovu neposílá modelovému verifieru.

## Rerankery

- TEI kontrakt: `POST /rerank` s `query`, `texts`, `raw_scores=false`.
- Llama/Qwen kontrakt: `POST /v1/rerank` s `model`, `query`, `documents`, `top_n`.
- `AKL_RAG_RERANKER_BASE_URLS` obsahuje alternativní interní cesty ke stejnému
  runtime. AKB je nepoužívá jako load-balancing pool: vybere zdravou cestu,
  drží ji aktivní a po chybě ji dočasně vyřadí.
  AKB si pamatuje poslední funkční endpoint a při síťové nebo HTTP chybě zkusí
  další. Kontrola probíhá v deklarovaném pořadí a po nalezení zdravé cesty se
  ostatní alternativy neprobouzejí; obsah dotazu ani dokumentů se neloguje.
- HTTP klient drží spojení k aktivní cestě otevřené mezi požadavky. Výsledek
  ukládá score, model, revision a latenci do interní metadata vrstvy.
- `retrieval_diagnostics.reranker_diagnostics` poskytuje pouze provozní údaje:
  device, pořadové číslo endpointu, počet batchů, čekání ve frontě, inference,
  server total a transport. Dotaz, text dokumentu, interní URL, token ani tajný
  klíč do diagnostiky nevstupují.
- Parent/section expansion načítá okolní chunky s omezenou souběžností a před
  použitím je hromadně znovu autorizuje v Registry. Tím zachovává bezpečnostní
  hranici bez sériového požadavku pro každý výsledný chunk.
- Při chybě v `shadow` se použije lexical fallback a warning
  `RERANKER_FALLBACK_LEXICAL`; v `enforce` skončí dotaz bezpečným no-answer s
  `RERANKER_UNAVAILABLE`. Stejné pravidlo platí pro ColBERT jako
  `COLBERT_UNAVAILABLE`.

## ColBERT kontrakt

Encoder poskytuje `POST /encode`:

```json
{
  "model": "colbert-multilingual-v2",
  "texts": ["text"],
  "input_type": "document"
}
```

Odpověď obsahuje `vectors`, jeden tokenový multivector na vstup. Ingestion
validuje počet výsledků a velikost každého tokenového vektoru. Query cesta
pošle encoderu pouze dotaz a Qdrant omezuje MaxSim na autorizovaná point ID.

## V2 backfill

Nejdřív spusťte pouze kontrolu:

```bash
python3 scripts/backfill_qdrant_v2.py --dry-run --dense-size 1024
```

Zápis do nové kolekce:

```bash
python3 scripts/backfill_qdrant_v2.py --recreate --dense-size 1024 --colbert-size 128
```

Skript zachovává payload, ověřuje `chunk_id`, `document_id`,
`document_version_id`, `text_hash`, používá deterministické UUID a porovná
počet validních zdrojových a cílových pointů. Dense backfill nenahrazuje ColBERT
backfill; pointy jsou do jeho dokončení označené `pending_backfill`.

## Promotion gate

Před každým zvýšením režimu musí být splněno:

- recall@50 alespoň 0,98,
- recall@8 alespoň 0,92,
- nDCG@8 alespoň 0,85,
- authorization leak rate 0,
- claim support alespoň 0,98,
- false-answer rate nejvýše 0,02,
- router accuracy alespoň 0,95,
- ColBERT/cascade nezhorší retrieval p95 o více než 30 %.

Recall a nDCG se vyhodnocují pouze nad případy, které deklarují očekávaný
relevantní chunk nebo dokument. Negativní no-answer kontroly mají vlastní
false-answer metriku a nesnižují retrieval recall jen proto, že záměrně nemají
relevantní zdroj. Supported-claim rate se počítá pouze pro zodpověditelné
odpovědi; odmítnuté interní návrhy tvrzení z výsledného no-answer se do něj
nezahrnují.

Pořadí: baseline, V2 backfill, shadow, 10 %, 50 %, 100 %, přepnutí kolekce.
V1 zůstává nejméně sedm dní.

Copilot baseline musí být zopakována po každé změně retrieval vrstvy. Povinně
se zachovává čerstvá STRATOS reautorizace před syntézou, extraktivní tříchunková
cesta a nulové volání generativního modelu pro smluvní výňatky. Produkční
baseline z 2026-07-22 je 10/10 scénářů, nulový autorizační únik a celková p95
5258 ms; jde o počáteční pětivzorkovou baseline, nikoli náhradu zátěžového testu.
