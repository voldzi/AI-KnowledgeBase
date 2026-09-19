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
`LLM_ANSWER_INCOMPLETE`. For a non-streaming answer the composer makes one
bounded recovery attempt with a concise-answer instruction and a token budget
of twice the configured answer limit, clamped to `1536..4096` tokens. This
prevents a deployment with an old `700`-token override from repeating the same
truncation with the same budget. If the recovery is also incomplete, the
composer replaces unfinished prose with a localized retry/narrow-question
message, no citations or used chunks, and
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

## Conversation reference and meaning integrity

For a source-bound follow-up the composer may receive the selected prior
assistant answer as untrusted reference data (for example, to resolve “the
second point”). Registry must have freshly marked that message available.
Every document/version pair cited by it must also be represented in the final
selected context after authorization and the context budget. Otherwise the
previous answer is omitted. It is never evidence or a system instruction.

The assistant preserves Unicode query text, numbers, negation, units, technical
names and parenthetical conditions. Deduplication removes only identical text
(with normalized whitespace) at the same document/version, page, section and source locator. Document-bound
follow-ups use their requested chunk budget instead of the cross-document
per-document diversity quota. Explicit effective dates, including “today”, must
not be discarded by historical fallback.

No predefined legal deadline, paragraph or expected answer is injected by the
former common-legal-core path. Domain alias lookup remains separate from answer
composition. Final rendering preserves Markdown and factual text; internal
chunk markers are still stripped pending a dedicated inline citation renderer.

`AssistantChatResponse` additively exposes `message_id`, `claims`,
`evidence_status` and `verification_model`. The message ID comes from the exact
Registry append receipt matched by a generated turn ID, never from a concurrent
last-message lookup. Older servers remain readable through the web compatibility
path; a new server's null receipt is not replaced with an unrelated history ID.
The evidence status is persisted with the answer. Retrieval confidence alone
must not be presented as verification of its factual claims.

Registry can redact metadata in a write-only service's append receipt. If that
receipt hides the turn ID, RAG rereads the conversation with the original
user's current authorization and matches the exact turn ID there. A denied
read never falls back to the last message or grants the writer document access.


## Adjacent-page context

With parent retrieval enabled, freshly authorized adjacent PDF pages in the
same structural section can accompany the seed as separate chunks. Their own
chunk IDs and page citations remain intact; their text is never attributed to
the seed page. Different sections, versions and revoked sources cannot enter
this expansion. The request chunk budget still applies and a limited expansion
is reported with `PARENT_CONTEXT_BUDGET_LIMITED`. This is bounded context
expansion, not proof of complete document coverage. Parent retrieval remains
controlled by its existing off/shadow/enforce setting.

## Multi-passage claim verification

The model verifier can return a separate verbatim quote for each cited chunk,
so a rule and its exception on different pages can support one statement.
Every quote must occur in its own authorized chunk; the quote list must cover
exactly the declared chunk IDs, without duplicate IDs or additional fields.
The older single-string verifier response remains accepted. Public claim
receipts retain their existing string `quoted_support` and chunk ID list.
Number and polarity checks also apply to combined support. The verifier still
must assess semantic entailment; matching quotations alone does not establish
factual correctness. This change does not enable a verifier model or change
the configured enforcement mode.

## Missing search infrastructure

A missing configured Qdrant collection or OpenSearch index is an operational
failure, not an empty result set. Retrieval raises HTTP 503 with
`RETRIEVAL_INDEX_UNAVAILABLE` in the standard error envelope (including
`trace_id`). Readiness reports `not_ready`, including in local environments.
A successfully queried existing index with no matching passages remains a
normal no-answer case. This prevents a broken or unprovisioned search backend
from being presented to an employee as a lack of documentary evidence.
