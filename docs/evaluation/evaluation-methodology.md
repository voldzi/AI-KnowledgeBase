# Evaluation methodology

Tento dokument popisuje metodiku Evaluation Service pro AKB Platform.

## Cil

Evaluation Service meri kvalitu RAG toku bez toho, aby menila produkcni dokumenty, opravneni nebo ingestion pipeline. Sluzi pro regresni testy odpovedi, citaci, retrievalu a no-answer chovani.

## Eval dataset

Kazdy dataset obsahuje sadu testovacich pripadu. Jeden pripad definuje:

- dotaz,
- subject id a filtry stejne jako RAG kontrakt,
- ocekavane relevantni chunky,
- ocekavane citace,
- ocekavane termy v odpovedi,
- zakazane termy v odpovedi,
- priznak `expected_no_answer`.

Dataset vlastni Evaluation Service. Nesmi zapisovat do Registry API ani menit zdrojove dokumenty.

## Retrieval metriky

Retrieval se meri z odpovedi RAG endpointu `/api/v1/rag/retrieve`.

- precision = relevantni vracene chunky / vsechny vracene chunky,
- recall = relevantni vracene chunky / ocekavane relevantni chunky,
- hit rate = 1, pokud je vracen alespon jeden ocekavany relevantni chunk,
- MRR = reciprocal rank prvniho ocekavaneho relevantniho chunku.

Pokud case nema ocekavane relevantni chunky, idealni retrieval je prazdny vysledek.

## Citation metriky

Citace se meri z odpovedi RAG endpointu `/api/v1/rag/query`.

Ocekavana citace muze byt definovana pres:

- `chunk_id`,
- `document_id`,
- `document_version_id`,
- `page_number`,
- `section_path`.

Citation precision meri podil spravnych citaci mezi vracenymi citacemi. Citation recall meri podil nalezenych ocekavanych citaci. Citation correctness je prumer precision a recall.

## Answer metriky

Answer correctness je deterministicky signal:

- pokryti `expected_answer_terms`,
- penalizace za `forbidden_answer_terms`,
- kontrola no-answer chovani.

Tato iterace nepouziva LLM judge. Duvod je opakovatelnost a nizsi provozni riziko. LLM-as-a-judge muze byt pridano pozdeji jako volitelny doplnkovy signal.

## Faithfulness

Faithfulness je proxy signal:

- bezna odpoved musi mit citaci,
- citovany chunk musi byt mezi vracenymi chunky nebo `used_chunks`,
- no-answer case je faithful, pokud odpoved neuvadi zdroje a hlasi nedostatecnou oporu.

Signal neni nahradou hloubkove semanticke kontroly. Je urcen pro stabilni regresni mereni.

## Overall score

Pro bezne answer cases:

- 30 % retrieval,
- 25 % citace,
- 25 % answer correctness,
- 20 % faithfulness.

Pro no-answer cases:

- 20 % retrieval,
- 20 % citace,
- 45 % no-answer correctness,
- 15 % faithfulness.

Case projde, pokud `overall_score >= AKL_EVAL_PASS_THRESHOLD`.

## Latency

Service meri:

- retrieval latency,
- answer latency,
- celkovou case latency.

Latency zatim nevstupuje do overall score. Je reportovana samostatne.

## Bezpecnost

- Logy neobsahuji plne query ani odpovedi.
- Audit obsahuje agregovane metriky a identifikatory behu.
- Report obsahuje pouze answer excerpt s konfigurovatelnou maximalni delkou.
- Produkce musi pouzivat bearer auth a realny RAG klient.
