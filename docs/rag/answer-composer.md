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

Application documentation also retains its evidence qualifications: application,
environment, source revision, units, conditions and uncertainty. Proposed pilot
sizing, examples and unfilled templates are not observed settings or guaranteed
RPO/RTO. A manual cannot prove the caller's permissions or current domain facts.
The composer must expose conflicting or missing support, not silently combine
different environments or source versions. These are prompt-level safeguards,
not a substitute for factual review and the evidence gate.

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
capped by `AKL_RAG_ANSWER_MAX_TOKENS` (`20000` authorized evidence characters
and `1536` generated tokens in the standard profile). An explicit environment
override remains authoritative; a release must check the running value rather
than assume that an existing deployment inherited the new default.
Ordinary employee questions use six chunks. Explicit multi-facet questions use
up to ten chunks, and an exact-document question may use all selected chunks
from that document. Authorization, score thresholds and the configured context
character limit remain enforced.

The character cap also applies to the first chunk. Oversized chunks are skipped
whole, never truncated into a potentially misleading number or table; later
smaller candidates may still fit. Empty text is skipped. If no usable chunk
remains, normal, streaming and federated document-extract paths return
`insufficient_source`, no citations and `NO_USABLE_CONTEXT` without calling an
LLM. Budget-related skips additionally retain `CONTEXT_TRUNCATED`. This bounds
source text, not the model's complete token budget including instructions and
conversation history.

Relevant continuation can use up to 12 earlier user questions, 800 characters
per question and 6000 characters in total. Retrieval receives a shorter bounded
projection while answer composition can use the full history budget. Assistant
answers are never reused as facts or instructions. Structured routing state is
restored separately and authorization, scope and citations are re-evaluated for
every request.

After evidence verification, a deterministic completeness check compares the
requested facets with the authorized selected chunks and the rendered answer.
It never supplies missing facts. It records missing coverage in
`missing_information` and `ANSWER_FACET_COVERAGE_INCOMPLETE`.

## No-Answer

If the LLM Gateway returns an empty answer, the service returns `confidence=insufficient_source` with warning `LLM_EMPTY_ANSWER`.

An answer is complete only when the gateway explicitly returns
`finish_reason=stop`. A stream must also end with `[DONE]`. Token-limit stops,
filter/tool stops, malformed stream frames and missing termination produce
`LLM_ANSWER_INCOMPLETE`. The composer replaces unfinished prose with a localized
retry/narrow-question message, no citations or used chunks, and
`confidence=insufficient_source`. Employee chat preserves this distinction from
missing documents. It never certifies or persists an unfinished answer as a
supported answer; a final streaming result replaces any provisional deltas.

## Topic Boundaries

Director Copilot keeps the year, financial metric and authorized organizational
context for a same-topic follow-up. A ranked plan-item question selects
procurement actions, not the single organizational summary; an explicitly
requested budget chapter/item remains a budget item. Switching to another live
domain starts fresh temporal/entity context unless the question explicitly
refers back. An explicit current-period question also clears a previous year.
These routing decisions do not grant access or relax the live evidence gate.

Explicit current personal-workspace questions are handled before live-domain
and document routing by the read-only Registry workflow tool. They never use an
LLM, invent citations or inherit stale financial/document context. Personal
queue results are ephemeral; only a neutral refresh receipt enters shared chat
history. See `docs/ui/workflow-inbox.md`.

## User-visible Result State

Chat presents the response's actual state before any confidence estimate:
restricted access, conflict, clarification, unavailable source, missing data,
incomplete evidence or partial coverage. A `no_data` result cannot display a
high-confidence success badge and is not a zero. Partial organizational results
and missing approved plans retain visible explanations. Overdue source review
is separate from a conflict or a transport failure. Safe, localized warnings
are deduplicated; unknown technical codes are not reflected into user-facing
text. These presentation rules do not weaken backend evidence checks.
