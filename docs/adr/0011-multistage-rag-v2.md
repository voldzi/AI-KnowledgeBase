# ADR 0011: Vícefázový RAG V2
- Stav: přijato
- Datum: 2026-07-22

## Kontext

Růst korpusu zvyšuje nároky na recall, přesnost pořadí, práci s verzemi a
ověření tvrzení. Jednostupňový hybridní retrieval není sám o sobě dostatečnou
ochranou proti nerelevantním zdrojům ani nepodložené generaci.

## Rozhodnutí

AKB zavádí vícefázový retrieval při zachování OpenSearch, Qdrant, Registry a
stávajících API:

1. deterministický query analyzer zvolí retrieval profil,
2. OpenSearch BM25 a Qdrant dense retrieval vytvoří 50 až 100 kandidátů,
3. Registry kandidáty autorizuje,
4. až potom mohou běžet deduplikace, ColBERT, cross-encoder a parent expansion,
5. composer dostane jen autorizovaný kontext,
6. evidence gate odmítne nepodložené hlavní tvrzení a odstraní nepodložená
   vedlejší tvrzení.

Každá nová vrstva má režim `off`, `shadow` a `enforce`. V2 kolekce
`document_chunks_v2` používá jmenné vektory `dense_bge_m3` a `colbert`.
Ingestion dočasně dual-write zapisuje V1 i V2. V1 je rollback cesta.

## Bezpečnostní invariant

Registry autorizace musí předcházet cross-encoderu, ColBERT query nad point ID,
parent expansion i LLM. Nepovolený text nesmí opustit retrieval boundary a
nesmí být předán žádnému modelu. Modelové služby nesmějí logovat dotazy ani
obsah dokumentů.

## Důsledky

- Nasazení probíhá `off -> shadow -> canary -> enforce` a je podmíněno gold
  benchmarkem.
- ColBERT nesmí být označen za dokončený, dokud není dokumentový token encoder,
  backfill a benchmark skutečně dostupný.
- Qdrant je připnutý na ověřenou verzi `1.18.2`.
- Nová pole odpovědi jsou volitelná a stávající klienti zůstávají kompatibilní.
