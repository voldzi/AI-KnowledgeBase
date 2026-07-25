# Director Copilot V2 AKB impact report

Date: 2026-07-25

Verdict: AKB implementation PASS; joint STRATOS integration acceptance pending

## Scope

AKB now consumes the additive `director-copilot-2` contract revision `2.0.2`
for Budget, ProjectFlow, ArchFlow and AIIP. V1 remains unchanged and is the
default because V2 mode defaults to `disabled`.

Implemented:

- exact contract and manifest SHA-256 pinning in the production build;
- target-specific single-audience service tokens and a separate actor bearer;
- dynamic manifest validation with fail-closed drift handling;
- bounded conversation state for period, metric, granularity and entity
  filters;
- cursor pagination, response size limits and deterministic idempotency keys;
- fresh access projection and scope reauthorization before synthesis;
- deterministic project financial/delivery correlation by canonical identity;
- typed AIIP-to-ArchFlow relationship traversal;
- independent Registry authorization of ProjectFlow document links;
- separate complete, partial, no-data, not-authorized and unavailable output;
- governed history reauthorization and metadata-only success/failure audit;
- disabled, post-response shadow and active runtime modes.

## Security impact

No database access, free SQL, prompt-authored scope, browser authorization
header or LLM-created relationship was added. Unknown contracts, facts, links,
reason codes, organization identity, policy lineage and unsafe deep links fail
closed. Live-source failure does not route to document RAG. Audit and history
exclude prompts, answers, tokens and raw source payloads.

## Verification

- web unit and contract tests: 409 passed, 0 failed;
- TypeScript: passed;
- production Next.js build: passed;
- contract hash and runtime-copy check: passed;
- repository skeleton and OpenAPI generation checks: passed;
- Docker Desktop and docker-home Compose rendering: passed;
- Chroma reindex: 34 changed files, 324 chunks indexed, 219 stale chunks
  removed;
- post-index retrieval: V2 ADR, operations and implementation documents found.

## Remaining joint gate

This report does not authorize `active`. STRATOS must deploy the referenced
source revisions into a shared test environment, set AKB to `shadow`, and run
the multi-turn and negative matrix from
`docs/integration/DIRECTOR_COPILOT_V2_IMPLEMENTATION.md`. The final protocol
must record all component releases, reason codes, latencies, audit evidence,
zero data leakage and zero live-data-to-RAG substitution.
