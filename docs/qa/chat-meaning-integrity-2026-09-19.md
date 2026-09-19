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
- RAG: 393 passed (Python 3.14 local venv); one dependency deprecation warning.
- Web: 1048 passed with Node 26.8.1 and loopback test-server access.
- Web TypeScript: passed using Node 26.8.1.
- Linux/amd64 production Dockerfile builds passed for web and chat-web at
  2b4a518; no subsequent web changes. RAG image passed 392 tests on Python
  3.12 before the final additional source-coordinate dedup regression.
- Final dedup key also preserves separate documents, pages and table locators.
  The final RAG image is rebuilt and retested separately.
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

## Continued local candidate verification

Commits `1aa6cbe` and `f8866bd` add general structural prose grouping with
exact page boundaries, separately cited adjacent-page context, and closed
multi-passage model-verifier support. These are incremental C/D foundations,
not completion of the remaining acceptance above.

- Ingestion: 238 local tests passed, including general contract/regulation
  grouping, page boundaries, source spans and separate tables.
- RAG: 401 tests passed locally and in the exact Linux/amd64 Docker image
  `akb/rag-retrieval-service:multi-evidence-local-check` (Python 3.12).
- Skeleton and generated OpenAPI consistency passed.
- Isolated candidate `akb-chat-candidate-f8866bd` listens only on
  `127.0.0.1:18082`; readiness returned HTTP 200. Parent context is enabled
  only in that candidate. Existing shared RAG services remain unchanged.
- STRATOS repaired shared-local readiness by deactivating two stale synthetic
  C06 writer grants with organization-wide scope, retaining their records
  and recording audit events. Shared STRATOS readiness now returns 200.
- STRATOS restored the existing synthetic reader identity from the local
  suite credential record. Standard OIDC PKCE login and token exchange passed.
  The shared Registry still pointed at V1; an isolated instance using V2
  returned six authorized C06 fixture documents (HTTP 200). No permissions
  were broadened to work around this configuration error.
- Authenticated candidate Chat returned HTTP 200 but no answer: both configured
  search backends returned 404 for the missing index. The old implementation
  incorrectly treated this as an empty match and readiness as healthy. This
  is now corrected to HTTP 503 RETRIEVAL_INDEX_UNAVAILABLE and not-ready.
- Conversation persistence and audit writes returned 403 with the local RAG
  service identity. The local index and scoped service grants must be
  provisioned before meaningful multi-turn quality acceptance.
- Anonymous Chat and citation opening correctly returned HTTP 401.

No production deployment or document-index replacement is represented by
these results. The exact Linux/amd64 Docling-enabled ingestion image built successfully;
35 targeted parser and structural corpus tests also passed inside that image.
No successful real-model answer or 200-question quality run is claimed.
