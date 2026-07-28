# Director Copilot V2 AKB impact report (historical pre-acceptance record)

Date: 2026-07-25

Verdict at the time: AKB implementation PASS; joint STRATOS integration acceptance pending

Superseded by the production acceptance of `director-copilot-2` revision
`2.0.3` and the V1 retirement record in
`docs/maintenance/director-copilot-v1-retirement.md`.

## Scope

AKB then consumed the additive `director-copilot-2` contract revision `2.0.2`
for Budget, ProjectFlow, ArchFlow and AIIP. This report predates the accepted
2.0.3 production runtime and must not be used as an operating instruction.

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
