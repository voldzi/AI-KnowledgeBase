# RAG No-Answer Policy

No-answer policy chrani pred odpovedmi bez dostatecne zdrojove opory.

## Kdy sluzba neodpovi vecnou odpovedi

Sluzba vrati `confidence=insufficient_source`, pokud:

- retrieval nenasel zadne kandidatni chunky,
- vsechny kandidatni chunky byly odfiltrovany authz,
- chunk nema citacni metadata,
- nejlepsi rerank score je pod `AKL_RAG_NO_ANSWER_MIN_SCORE`,
- LLM Gateway vrati prazdnou odpoved.

## Tvar no-answer odpovedi

```json
{
  "answer": "K dotazu nebyl nalezen dostatecne oporyhodny zdroj v povolenych dokumentech.",
  "confidence": "insufficient_source",
  "citations": [],
  "used_chunks": [],
  "missing_information": "Chybi citovatelny chunk v povolenych dokumentech."
}
```

## Warning kody

- `NO_RETRIEVAL_MATCH`: retrieval nevratil zadne kandidatni chunky.
- `NO_AUTHORIZED_SOURCE`: kandidatni chunky existovaly, ale zadny autorizovany zdroj nezustal.
- `AUTHZ_FILTERED_SOURCES`: cast zdroju byla odfiltrovana Registry API.
- `MISSING_CITATION`: chunk nema potrebna citacni metadata.
- `LOW_RELEVANCE`: nejlepsi autorizovany chunk je pod relevance prahem.
- `LLM_EMPTY_ANSWER`: LLM Gateway vratil prazdny obsah.
- `CONTEXT_TRUNCATED`: kontext byl zkracen podle limitu.

## Bezpecnostni pravidlo

No-answer policy se vyhodnocuje az po authz filtru. To znamena, ze existence neautorizovaneho zdroje nesmi sama o sobe vest k vecne odpovedi.
