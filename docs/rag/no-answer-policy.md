# RAG No-Answer Policy

No-answer policy chrání před odpověďmi bez dostatečné zdrojové opory.

## Kdy služba neodpoví věcnou odpovědí

Služba vrátí `confidence=insufficient_source`, pokud:

- retrieval nenašel žádné kandidátní chunky,
- všechny kandidátní chunky byly odfiltrovány authz,
- chunk nemá citační metadata,
- nejlepší rerank score je pod `AKL_RAG_NO_ANSWER_MIN_SCORE`,
- LLM Gateway vrátí prázdnou odpověď.

## Tvar no-answer odpovědi

```json
{
  "answer": "K dotazu nebyl nalezen dostatečně důvěryhodný zdroj v povolených dokumentech.",
  "confidence": "insufficient_source",
  "citations": [],
  "used_chunks": [],
  "missing_information": "Chybí citovatelný chunk v povolených dokumentech."
}
```

## Warning kódy

- `NO_RETRIEVAL_MATCH`: retrieval nevrátil žádné kandidátní chunky.
- `NO_AUTHORIZED_SOURCE`: kandidátní chunky existovaly, ale žádný autorizovaný zdroj nezůstal.
- `AUTHZ_FILTERED_SOURCES`: část zdrojů byla odfiltrována Registry API.
- `MISSING_CITATION`: chunk nemá potřebná citační metadata.
- `LOW_RELEVANCE`: nejlepší autorizovaný chunk je pod relevance prahem.
- `LLM_EMPTY_ANSWER`: LLM Gateway vrátil prázdný obsah.
- `CONTEXT_TRUNCATED`: kontext byl zkrácen podle limitu.

## Bezpečnostní pravidlo

No-answer policy se vyhodnocuje až po authz filtru. To znamená, že existence neautorizovaného zdroje nesmí sama o sobě vést k věcné odpovědi.
