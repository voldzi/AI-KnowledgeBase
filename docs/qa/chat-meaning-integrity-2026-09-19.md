# Chat meaning integrity — implementation checkpoint, 2026-09-19

Scope: roadmap stage A and the source-bound conversation foundation of B.
This is not completion of the full A–E quality programme or approval for pilot.

Implemented:
- Meaning-preserving deduplication, immutable explicit effective dates and
  exact source recognition without the optional Sb. suffix.
- Unicode-preserving within-document queries; source resolution excludes
  paragraph coordinates; source-bound follow-ups retain the requested budget.
- Removal of predefined legal answers, forced legal-passage promotion and
  factual rewriting after evidence verification. Canonical source aliases
  remain and require corpus evaluation; these are not a general planner.
- Freshly authorized prior answer for referential follow-ups, only when all
  its source versions remain in the final context; no history substitution
  after revocation, topic change or context-budget exclusion.
- Exact append receipt matched to its own turn; additive API fields for claim
  evidence; persisted UI evidence status and neutral source-only badges.
- Non-recursive follow-up templates and continuity reports explicitly marked
  as not assessing factual correctness or completeness.

Local evidence:
- RAG: 392 passed (Python 3.14 local venv); one dependency deprecation warning.
- Web: 1048 passed with Node 26.8.1 and loopback test-server access.
- Web TypeScript: passed using Node 26.8.1.
- Continuity evaluator regression: passed.
- Skeleton and generated OpenAPI consistency: passed.
- Initial sandbox web run could not bind loopback; successful rerun used the
  appropriate local-network permission. This was not an application failure.

No production documents, versions, index contents, grants, policy bindings,
model settings or running services were changed. Public MCP health/readiness
passed, but that describes the currently deployed version, not this candidate.
The shared local akb-stratos-test STRATOS API was unhealthy when inspected;
separate stratos-local ProjectFlow API was restarting. Neither was modified.
An authenticated shared integration test must not be claimed from unit tests.

Remaining acceptance, in order:
1. Verify this candidate with real model and source-bound multi-turn cases in
   an isolated healthy integration environment, including concurrent turns,
   changed permissions and historical dates.
2. Complete stage B structured conversation planning, topic return and typed
   follow-up actions; the current bounded reference is not a complete planner.
3. Stage C structural chunking and coverage, both sides of comparisons,
   qualified cross-encoder and model/context settings; no index switch yet.
4. Stage D independent multi-passage claim checking and inline citations.
5. Stage E reviewed 240-case dataset with 60 held-out scenarios, immutable
   runtime/index manifest, factual and completeness scores, then selective
   release and authenticated smoke. Do not call 200 continuity requests a
   completed factual quality evaluation.
