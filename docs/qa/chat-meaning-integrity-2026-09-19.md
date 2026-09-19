# Chat meaning integrity — implementation checkpoint, 2026-09-19

Scope: roadmap stage A and the source-bound conversation foundation of B.
This is not completion of the full A–E quality programme or approval for pilot.

## Current deployed checkpoint

RAG is deployed on `docker.home.cz` at
`366638048190a857a6ea68c74a8170511ee2b22d`, image
`sha256:8c4d457ef7d1afa6b18d188aae2b59321876e6f74297145b2824f408d9dbe35e`.
The earlier local-only statements below describe their dated checkpoint, not
the current deployment state. Web/chat-web retain the tested `2b4a518` image
trees. Registry, ingestion, document versions, policy bindings and indexes were
not replaced by these Chat releases.
After the diagnostic, a separate standard official-source sync added the
current 90/1995 version; see the linked diagnostic report for the exact ID and
successful live Chat/citation test. Historical versions were not rewritten.

- Exact Linux/amd64 RAG image: 418 tests passed; same local suite passed.
- Chat MCP: 11 tests passed, including exact parent/scope forwarding and
  rejection of incomplete explicit binding.
- `4d7c806` fixed Czech inflected and English answer references. A real typed
  “Můžeš tuto odpověď vysvětlit jednodušeji?” returned HTTP 200, persisted,
  retained the same immutable document version and opened its citation (200).
- `f957ebe` separates source-discovery vocabulary from within-source semantic
  ranking. The previously failing explicit procurement-principles question
  now includes transparency, proportionality, equal treatment and prohibition
  of discrimination, citing the actual indexed principles passage. Reply,
  persistence and citation opening passed; response latency was 11.45 seconds.
- `3666380` excludes earlier document identifiers when the user explicitly
  selects a new source; referential comparison still retains both sources.
  Live procurement → 89/1995 topic switch cited only its current immutable
  version `ver_c1107c7717c84575b18a908a88c3d244`. Anonymous Chat/citation were
  401, forged source binding clarified without citations. A new conversation
  asking to simplify an absent answer requested the missing text with no
  document citation (general-answer route, not structured clarification).
  Procurement principles and exact citation opening passed again (12.3 s).
- Deployment rebuilt only RAG on the MacBook, loaded that immutable image,
  activated only RAG without dependencies/build, checked health/readiness and
  authenticated smoke, and recorded completion. No full remote CI ran.
- Deployment/rollback manifests are under
  `/srv/akb/state/chat-integrity-3666380/` (previous RAG image `f957ebe`).
  To revert, use the manifest's original Compose file chain and `old` image ID,
  activate only RAG with `--no-build --no-deps --pull never`, then repeat health,
  readiness and authenticated citation smoke. Preserve all volumes/configuration.

Runtime findings: cross-encoder, parent expansion, adaptive and V2 retrieval
remain off. The configured GTE endpoint is reachable but the existing batch 32
and 15-second timeout failed the bounded model diagnostic. Batch 8 and a
45-second per-batch timeout completed in about 99 seconds for 24 candidates;
this was an isolated diagnostic, not a live configuration change. Enabling
it alone did not establish complete evidence coverage. Deterministic shadow
claim verification still marks many paraphrases unsupported/partial; an
HTTP-200 answer is not proof of factual accuracy.

The [200-real-turn diagnostic](chat-api-200-diagnostic-2026-09-19.md) completed
on the preceding `f957ebe` image: 179 HTTP 200, 16 HTTP 502, five HTTP 503;
83/100 pairs met all operational criteria. It is separate from factual
quality acceptance. No reviewed 240+60 factual benchmark is claimed here.

STRATOS found no matching policy audit for the earlier Registry 503. The
underlying general authority failure remains under investigation; fixing the
typed source scope avoids that particular failing path but does not prove
all authorization dependencies healthy. A narrow read-only probe identified
`document_profile_admission_unavailable`: STRATOS returned
`OFFICIAL_SOURCE_APPROVED_EVIDENCE_CHANGED` for 90/1995 Sb. Its stored immutable
version began 2026-01-15 with an open end; current official evidence closes it
on 2026-09-14 and names a new text from 2026-09-15. This is not an Access V2 or
grant failure. A governed refresh must preserve old snapshots and add current
evidence; the handling of historically cited open-ended snapshots must be
agreed before changing the admission contract.

The official-source worker is enabled, but the inspected configuration checks
every six hours with `MAX_NEW_PER_RUN=2` and a seven-day full-refresh interval.
A complete 100-root sweep itself therefore takes up to 12.5 days. State at
inspection: last full sweep 2026-09-11T02:11:45Z, last cycle
2026-09-19T10:24:56Z, full cursor 8, 291 completed version keys, one failure.
Metadata discovery freshness and expensive ingestion throughput need separate
budgets; this configuration was not changed during the benchmark.

STRATOS also confirmed there is no
materialized delayed upload runner or manifest; no unidentified files were
uploaded in response to that handoff.

## Earlier local checkpoint

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
