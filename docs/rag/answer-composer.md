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
POST ${AKL_LLM_GATEWAY_BASE_URL}/chat/completions
```

The prompt contains:

- user query,
- selected chunk text,
- chunk IDs and citation metadata,
- instruction to answer only from supplied context,
- instruction to avoid adding unsupported facts,
- an explicit trust boundary declaring all source text and metadata to be
  untrusted evidence rather than executable instructions.
- an instruction to address every independently requested answer facet or to
  state explicitly that the supplied context does not establish it.

Instructions embedded in a document cannot change the task, authorization,
output policy or source boundary and cannot request hidden prompts, credentials
or tokens. This prompt boundary supplements, but never replaces, Registry
authorization and citation validation.

The service never calls Ollama or vLLM directly.

## Citations

Returned citations are deterministic:

```text
RetrievedChunk.citation -> RagAnswer.citations
```

The LLM response is not trusted as the source of citation metadata.

## Context Selection

Only chunks with `score >= AKL_RAG_NO_ANSWER_MIN_SCORE` are sent to the LLM.
Context is capped by `AKL_RAG_MAX_CONTEXT_CHARS`, and the generated answer is
capped by `AKL_RAG_ANSWER_MAX_TOKENS` (`512` in the real local RAG profile).
Ordinary employee questions use six chunks. Explicit multi-facet questions use
up to ten chunks, and an exact-document question may use all selected chunks
from that document. Authorization, score thresholds and the context character
limit remain unchanged.

After evidence verification, a deterministic completeness check compares the
requested facets with the authorized selected chunks and the rendered answer.
It never supplies missing facts. It records missing coverage in
`missing_information` and `ANSWER_FACET_COVERAGE_INCOMPLETE`.

## No-Answer

If the LLM Gateway returns an empty answer, the service returns `confidence=insufficient_source` with warning `LLM_EMPTY_ANSWER`.
