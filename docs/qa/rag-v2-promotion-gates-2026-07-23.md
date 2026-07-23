# RAG V2 Promotion Gates Implementation

Date: 2026-07-23

## Trigger

STRATOS revalidation of AKB release `b0c9dbb0` restored 100 percent citation
purity, eliminated reranker fallback and achieved Recall@8 and nDCG@8 of 1.0.
Four repeated failures remained for `public_information_systems_law`; the
evaluator also could not prove Recall@50, claim support, false-answer rate,
router accuracy or ten current authorization mutations.

## Root cause

The query `365/2000 Sb.` was not recognized as a document identifier. Retrieval
therefore remained corpus-wide. The expected document was present, but only
three of seven returned chunks belonged to it, producing precision `0.4286`
and score `0.7321` in all four runs.

## AKB changes

- Czech Collection of Laws references are classified as exact identifiers.
- Unique exact-document scoping remains after authorization and deduplication.
- Evaluation retrieval supports `top 50`; ordinary answer generation remains
  bounded to `top 20`.
- Core evaluation scoring remains based on each case's normal `max_chunks`;
  cutoff metrics are computed separately.
- Evaluation reports now include Recall@8, Recall@50, supported-claim rate,
  false-answer rate, router accuracy, metric coverage counts and retrieval
  diagnostics.
- Retrieval diagnostics include per-stage latency without prompt, answer or
  document content.
- A versioned promotion dataset, ten-scenario authorization contract and
  fail-closed release checker are repository-controlled.

## Security boundary

AKB does not mutate STRATOS grants or trust caller-supplied access headers.
STRATOS owns live access projection mutations. AKB owns retrieval enforcement,
the expected outcomes and final evidence validation.

## Promotion status

These changes do not promote RAG V2 automatically. RAG V2 remains in `shadow`
and ColBERT remains `off` until the complete version 2 dataset, all ten live
authorization mutations and the latency comparison pass the AKB release
checker.

## Second remediation after release 20568fcb

The subsequent production run completed eight of ten cases. The remaining
exact-law miss happened before the existing post-retrieval exact scope, while
the second law request exceeded the evaluator timeout during reranking.

AKB therefore adds:

- a lexical exact-source resolver before embedding and corpus-wide fusion;
- authorization of the resolved document before document-scoped retrieval;
- profile-specific candidate and reranker budgets instead of
  `max_chunks * 3`;
- no parent expansion for `retrieve_only`;
- metric eligibility that excludes no-answer controls from Recall/nDCG and
  supported-claim calculations.

The change remains a shadow remediation. It does not change the RAG V2,
reranker or ColBERT production feature modes.
