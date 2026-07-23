# RAG V2 Production Validation Remediation

Date: 2026-07-23

## Validation result

STRATOS executed 32 evaluation requests and one exact-document request against
the AKB production shadow pipeline. The run correctly failed the promotion
gates:

- exact-document citation purity was 50% instead of 100%;
- total p95 latency was 21.565 seconds, 310.15% above the accepted 5.258-second
  baseline;
- the cross-encoder used lexical fallback for 28 of 32 evaluation requests and
  for the exact-document request;
- the dataset did not measure all mandatory quality and authorization gates.

RAG V2 remains in `shadow`. ColBERT remains `off`.

The source evidence is the STRATOS operator report and machine-readable report
under `docs/reports/stratos-rag-v2-production-validation-2026-07-23.*` in the
STRATOS repository, commit
`cf3e38bd8e8c81e9552cc3d2b545ece9d1b2860e`.

## Root causes

The Qwen3 reranker rejected long batches because the llama.cpp physical
micro-batch was 512 tokens even though the logical batch was configured as
2048. The reranker then tried two inactive failover endpoints, adding repeated
timeouts before lexical fallback.

The exact contract reference `120-2022-S` was not classified as an identifier.
The assistant bridge also discarded explicit document and document-version
scope from the supplied context. Retrieval therefore remained corpus-wide and
allowed unrelated citations.

## Remediation

- Set both the Qwen3 logical batch and physical micro-batch to 2048.
- Bound each reranker document input to 4,000 characters before transport.
- Keep only the verified Mac reranker proxy in the active production endpoint
  pool until another endpoint passes the same long-input smoke.
- Recognize numeric-year-suffix document identifiers such as `120-2022-S`.
- Preserve explicit document and version identifiers in assistant filters.
- For an unscoped query classified as exact, restrict authorized candidates
  only when one unique document matches the requested identifier.
- Do not apply implicit exact scope to comparison, temporal, live-data or
  explicitly scoped queries.

The scope restriction runs after registry authorization and deduplication, so
it cannot add a source that the actor was not already authorized to read.

## Verification completed

- Qwen3 reranker long-input smoke: 16 documents, no fallback, approximately
  3.5 seconds locally and from the production RAG network path.
- RAG retrieval service test suite: 178 passed.
- Repository skeleton and OpenAPI consistency checks passed.
- No prompt, answer, document body, credential or endpoint value was added to
  application logs.

## Promotion status

This remediation is sufficient for a repeated shadow validation, not for
promotion. Promotion still requires one reproducible dataset and report that
measures every gate in
`docs/integration/STRATOS_RAG_V2_PRODUCTION_VALIDATION_HANDOFF.md`, including
Recall@50, Recall@8, nDCG@8, supported-claim rate, false-answer rate, adaptive
router accuracy, current authorization revocation scenarios and latency.
