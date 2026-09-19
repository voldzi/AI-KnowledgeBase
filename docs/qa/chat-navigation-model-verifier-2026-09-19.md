# Navigation and model verification — 19 September 2026

## Changes

- Clicking another AKB module navigates immediately on mobile and desktop.
  Clicking the current module still opens its secondary navigation. A later
  click can supersede an in-flight transition. A fixed, non-blocking status
  names the destination, even if the old page is scrolled or still loading.
- The model evidence verifier accepts layout-only whitespace differences in
  quotes. It still requires every non-whitespace character and exact source
  identity, and checks numeric/polarity constraints and all answer statements.
- Verification token use and estimated cost are added to the answer's total
  usage. The additive `llm_usage.verification` breakdown names the verifier.
  Failed parsing still accounts for the completed model call; unknown prices
  remain unknown. The existing OpenAPI usage object permits additive fields.
- The opt-in Compose profile `docker-compose.chat-verifier.yml` selects
  `gpt-5.6-luna` for a separate evidence-checking call in **shadow** mode.
  This does not certify answer completeness or silently remove unverified
  sentences. Source-processing restrictions still pass through the LLM gateway.
  Restricted sources may be denied external processing and use the existing
  deterministic fallback, with an explicit fallback warning.

## Why not add a new RAG framework now?

The running application already uses OpenAI for answers whose source policy
permits external processing; the configured external model is `gpt-5.6-luna`.
Docling, Qdrant and the existing retrieval/authorization boundaries remain.
The missing capability addressed here is an actually exercised independent
model check, rather than another orchestration dependency.

[LlamaIndex query pipelines](https://docs.llamaindex.ai/en/stable/module_guides/querying/pipeline/)
can organize multi-step retrieval; [Ragas metrics](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/)
can support offline faithfulness and relevance evaluation. Neither repairs
stale authority evidence or proves authorization. They were reviewed, not
installed or claimed as deployed improvements. Structured model output is a
useful next contract improvement, but schema adherence alone does not prove
semantic correctness ([OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs)).

## Validation checkpoint

- Live isolated verifier diagnostic on an authorized public procurement
  passage: correct paraphrase supported; reversed discrimination claim and
  fabricated 999-day obligation unsupported. The previous implementation
  rejected the correct quote because PDF extraction included a blank line.
- Local browser: module switch displays its destination immediately; another
  click during a transition opens Chat. At 390px, Documents opens in one tap;
  a second tap opens its submenu. Viewport restored afterwards.
- Typecheck and 15 focused existing web navigation tests passed.
- RAG local and exact Linux image: 423 tests passed before the citation-marker
  follow-up. Three additional regression cases cover exact authorized citation
  handles, altered numeric obligations and unknown citation markers.
- Live browser confirmed an immediate named navigation status and completed
  Documents → Chat switching. A transient authority fetch failure triggered the
  first rollback; STRATOS subsequently confirmed healthy uninterrupted services.
- First live API smoke returned HTTP 200, persisted the answer and opened its
  exact citation. OpenAI generation plus verification used 9,707 tokens with
  estimated cost USD 0.0041994. This is one measured example, not a budget forecast.
- The smoke exposed a verifier defect: digits in technical citation handles were
  treated as asserted quantities. Exact authorized citation markers are now
  excluded only from semantic numeric/overlap checks. Actual claim numbers,
  unknown markers and exact verifier/source identity checks remain intact.
- A second live response used deterministic fallback after malformed verifier
  output. Shadow verification is diagnostic, not a guarantee of correctness.
  Deployment outcome remains pending the follow-up candidate.

Temporal-closure issuance remains coordinated with STRATOS. Do not treat this
UI/model change as deployment of the separate historical-admission contract.

The live RAG answer limit is 1,536 output tokens. Verification repeats every
claim and its supporting passages; reusing that limit truncated normal multi-
claim JSON receipts (gateway HTTP 200 followed by incomplete-answer rejection).
Verification now requests its own bounded 8,192-token output allowance. This is
an upper bound, not a reservation or a fixed cost; actual usage remains recorded.

## Server acceptance and remaining limitations

Candidate `2d33a66` completed the authenticated API and navigation smoke on
`docker.home.cz`: persisted response, exact citation HTTP 200, OpenAI verifier
selected, no verifier fallback in that run, 10,397 total tokens, USD 0.0049614
estimated total. All three affected services were healthy. Navigation displayed
its destination immediately and completed Documents → Chat while Documents
was still loading. The verifier reported partial support, not full correctness.

The live receipt also exposed citation-only lines being treated as separate
claims. The follow-up removes only exact authorized citation markers before
splitting answer statements, consistently for model and deterministic checks.
Unknown markers and actual numeric obligations are still checked.

Known limits: shadow verification does not suppress unsupported statements;
model format failures can still use the explicit deterministic fallback. The
initial session probe intermittently reported unavailable authority; four
fresh authenticated probes from the web container returned 200 in 78–248 ms,
and STRATOS confirmed no restart. Its underlying transient cause is unresolved.
Registry-backed page loads were around 24 seconds in observed logs. Navigation
feedback is fixed; data-loading latency is not claimed to be fixed. Historical
temporal-closure activation remains pending joint consumer acceptance.

A full-response diagnostic identified the remaining format fallback precisely:
naive sentence splitting split legal abbreviations within list items; the model
returned five complete bullet claims against seven input fragments. List-item
verification now preserves each complete item and all its sentences. It does
not silently accept missing claims or changed numbers. The local suite now
contains 428 passing tests.
