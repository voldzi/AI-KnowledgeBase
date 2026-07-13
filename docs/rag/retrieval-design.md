# RAG Retrieval Design

Tento dokument popisuje implementovany retrieval tok ve sluzbe `services/rag-retrieval-service`.

## Odpovednost

Sluzba zodpovida za:

- analyzu dotazu v rozsahu validace vstupu,
- metadata filtering,
- permission-aware retrieval,
- hybrid dense/sparse scoring,
- BM25/fulltext retrieval přes OpenSearch, pokud je zapnutý,
- reranking,
- vyber kontextu pro LLM,
- audit pouzitych zdroju.

Sluzba nezodpovida za ingestion, parsing dokumentu, registry metadata ani zmenu opravneni.

## Retrieval tok

1. API prijme `subject_id`, `query`, `filters`, `answer_mode` a `max_chunks`.
2. LLM Gateway klient vytvori embedding dotazu.
3. Retriever vrati kandidatni chunky:
   - mock retriever pouziva lokalni fixture chunky,
   - Qdrant retriever vola `/collections/{collection}/points/search`,
   - pri `AKL_RAG_FULLTEXT_MODE=opensearch` lexical kandidaty vraci OpenSearch `_search`.
4. Metadata filtr omezi dokument typ, klasifikaci, tagy a validitu.
5. Sluzba posle kandidatni `document_id` do Registry API `/authz/filter-documents`.
6. Neautorizovane chunky se zahodi pred rerankingem a pred LLM.
7. Dense a lexical ranking se spoji pres Reciprocal Rank Fusion; lexical reranker
   jeste upravi score podle prekryvu tokenu dotazu a textu.
8. Answer composer pouzije pouze chunky nad `AKL_RAG_NO_ANSWER_MIN_SCORE`.

## Hybrid score

Aktualni score:

```text
hybrid_score = dense_score * AKL_RAG_HYBRID_DENSE_WEIGHT
             + sparse_score * (1 - AKL_RAG_HYBRID_DENSE_WEIGHT)
```

Dense score pochazi z Qdrant similarity nebo deterministic mock embeddingu. Sparse score pochazi z OpenSearch BM25 normalizace a lokalniho lexical token overlapu, pripadne jen z Qdrant payload lexical fallbacku.

## Real Local RAG Profile

Real local RAG používá:

- `AKL_RAG_RETRIEVER_MODE=qdrant`
- `AKL_RAG_FULLTEXT_MODE=opensearch`
- `AKL_RAG_LLM_CLIENT_MODE=http`
- `AKL_RAG_CHAT_MODEL=gemma4:12b-mlx`
- `AKL_RAG_HIGH_QUALITY_CHAT_MODEL=gemma4:31b-mlx`
- `AKL_RAG_HIGH_QUALITY_MIN_CONTEXT_CHUNKS=6`
- `AKL_RAG_EMBEDDING_MODEL=bge-m3`
- `AKL_RAG_ANSWER_MAX_TOKENS=512`
- `AKL_RAG_SOURCE_CONTEXT_WINDOW=1`
- `AKL_RAG_AUTHZ_MODE=dev`
- Qdrant kolekci `akl_document_chunks` s vektorem velikosti `1024` a distance `Cosine`
- OpenSearch index `akl_document_chunks` se stejnymi citačními a filtrovacími poli

Mock/dev-test profil používá `mock-embedding` s výchozí dimenzí 8. Tento profil nesmí zapisovat ani číst real Qdrant kolekci vytvořenou pro `bge-m3`.

`AKL_RAG_HIGH_QUALITY_CHAT_MODEL` je volitelný model pro komplexní citované
odpovědi. Standardní zaměstnanecké dotazy zůstávají na `AKL_RAG_CHAT_MODEL`,
zatímco extrakce, porovnání, checklisty, manažerské/auditní odpovědi a velký
kontext používají high-quality model, pokud je nastavený.

## Qdrant payload

Qdrant payload ma obsahovat citovatelna pole podle `DocumentChunk` kontraktu:

- `chunk_id`
- `document_id`
- `document_version_id`
- `text`
- `document_title`
- `version_label`
- `page_number`
- `section_path`
- `article_number`
- `paragraph_number`
- `classification`
- `document_type`
- `status`
- `tags`

## Authz

Authz je povinna cast toku. LLM Gateway nedostane kontext z dokumentu, ktere Registry API nevratilo v `allowed_document_ids`.

## OpenSearch Fulltext

OpenSearch dotaz používá vážený `multi_match` přes `document_title`,
`section_title`, `section_path`, `article_number`, `paragraph_number`,
`search_text`, `text` a `normalized_text`, plus phrase boost pro přesné názvy a
formulace. Dotaz se konzervativně rozšiřuje o doménová synonyma pro řízené
dokumenty, například `RMO` -> `rozkaz ministra obrany`, `gestor` ->
`odpovedny/vlastnik`, `cl` -> `clanek` a `odst` -> `odstavec`. Identifikátory
typu `RMO 12/2024`, `cl. 4` a `odst. 2` dostávají samostatné phrase/wildcard
boosty, aby přesné citace porážely obecné textové shody.

Filtry na `classification`, `document_type`, `tags`, `status` a `valid_from` se
aplikují už v OpenSearch dotazu. Registry authorization zůstává samostatná
povinná brána po získání kandidátů a před předáním kontextu LLM.

## Limity

- Sparse/fulltext cast je produkčnější při `AKL_RAG_FULLTEXT_MODE=opensearch`; Qdrant payload lexical fallback zustava kompatibilni rezim pro prostredi bez OpenSearch.
- Validity filtr pro Qdrant predpoklada payload `status=valid` a `valid_from <= today`.
- Konfliktni zdroje a compliance logika nejsou soucasti teto iterace.
