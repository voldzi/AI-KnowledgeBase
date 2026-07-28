# ADR 0013: Cost-aware assistant execution

## Status

Accepted.

## Context

AKB combines authoritative live tools, Registry metadata, OpenSearch fulltext,
hybrid RAG, reranking, and language models. Running every user question through
the complete generative pipeline adds latency and infrastructure load even when
the requested result is an exact title, citation, or source passage.

The optimization must not weaken authorization, Information Policy, citation
requirements, no-answer behavior, or auditability. A prompt must never be able
to select a more privileged data path.

## Decision

The web bridge creates a deterministic, versioned `assistant_query_plan` before
calling a backend tool. The plan selects exactly one execution lane:

- `deterministic_registry` for inventory and metadata reports;
- `lexical_extract` for high-confidence lookup, exact citation, and
  source-location requests;
- `generative_rag` for synthesis, comparison, explanation, obligations, risk,
  and structured reporting.

`lexical_extract` uses the retriever's public lexical contract. In production
that contract is backed by the read-only OpenSearch index. It skips query
embeddings, reranking, parent expansion, answer generation, and evidence-model
verification. It still applies filters, Registry authorization, Information
Policy, version selection, deduplication, diversification, no-answer policy,
and citations. It returns at most three bounded authorized excerpts.

The service records the plan id/version, selected lane, retrieval strategy,
model requirement, and model policy in bounded audit metadata. It never records
the prompt, answer, document body, token, or credential.

Follow-up questions are deterministic by default. LLM-generated follow-ups are
available only through `AKL_RAG_FOLLOW_UP_MODE=llm`.

## Consequences

- Exact document lookup remains useful while the LLM tier is unavailable.
- Simple lookups have lower latency and do not consume embedding, reranker, or
  generation capacity.
- Synthesis quality and evidence controls remain unchanged for complex work.
- Router precision becomes a release metric. False lexical routing is guarded
  by explicit synthesis exclusions and regression tests.
- No-result lexical searches fail closed instead of silently escalating to a
  generative answer.
