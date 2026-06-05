# Answer Composer

The answer composer is implemented in `services/rag-retrieval-service/answer_composer`.

## Inputs

The composer receives:

- `query_id`
- user query
- authorized retrieved chunks
- confidence from the no-answer policy
- warnings from retrieval/authz
- `max_chunks`

It does not fetch documents and does not call Qdrant directly.

## LLM Gateway Call

The composer calls LLM Gateway through:

```text
POST ${LLM_GATEWAY_URL}/api/v1/chat/completions
```

The prompt contains:

- user query,
- selected chunk text,
- chunk IDs and citation metadata,
- instruction to answer only from supplied context,
- instruction to avoid adding unsupported facts.

The service never calls Ollama or vLLM directly.

## Citations

Returned citations are deterministic:

```text
RetrievedChunk.citation -> RagAnswer.citations
```

The LLM response is not trusted as the source of citation metadata.

## Context Selection

Only chunks with `score >= RAG_MIN_SCORE` are sent to the LLM. Context is capped by `AKL_RAG_MAX_CONTEXT_CHARS`.

## No-Answer

If the LLM Gateway returns an empty answer, the service returns `confidence=insufficient_source` with warning `LLM_EMPTY_ANSWER`.
