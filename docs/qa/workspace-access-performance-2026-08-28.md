# Workspace Access And Navigation Verification

Date: 2026-08-28. Working branch: `codex/workspace-access-performance`.
Baseline: Gitea main `a6e9068e28267ed77d8a9e59bd035fae7cbd1089`.
Production inspected during diagnosis:
`c7014b43e2fbe76c818813a10a5e0904d7b8b326`.

Status: implemented and verified locally; not committed, released or deployed.
This record does not authorize changes to STRATOS, IAM, assignments, document
publication or production configuration.

## Findings Addressed

- A document reader could have personal review assignments without access to
  the Tasks route. The route is now **Moje prace / My workspace** and is
  available to active document readers and managers. Assignment alone still
  does not grant approval, publication or team access.
- Loading personal work previously fetched multiple complete collections.
  The page now requests only the active view, with server-side filters and
  25-row pagination. Authorization precedes counts and pagination.
- Reading tasks performed derived-task maintenance and escalation. GET is
  now read-only; a transactional background cycle performs maintenance with
  a PostgreSQL advisory lock between replicas. Explicit review submission
  and decisions remain immediate.
- Repeated identical authorization work within one render/read request is
  deduplicated. No cross-request authorization TTL or stale policy fallback
  was introduced; unavailable policy still fails closed.
- The published employee-directive projection was applied to detail access
  but not consistently to listing/search. Those paths now share the same
  effective-package and exact-source checks. Service identities, unpublished
  versions and more restrictive classifications do not gain employee access.
- Navigation, filtering and failed requests now show explicit pending or
  unavailable states. A failed request is not represented as an empty queue.
  Generic page errors are localized and do not reveal raw exception messages.
  Retry reloads the current GET page because resetting an error boundary
  alone was observed to replay a failed server-component response.

## Document Counts Are Not Global Access Grants

The production diagnosis observed 517 stored document identities, 516 entries
visible to the administrator and 142 visible to the tested document reader.
These are different measures and were not treated as evidence of deleted
documents. Existing organization, budget, publication and Information Policy
restrictions remain in place. The listing labels its count as permission-
filtered; this change does not expose the full registry to every employee.

The employee-directive listing defect was verified separately from those
totals. No document, attachment, version, index, audit record or assignment
was deleted or bulk-modified.

## Automated Verification

| Check | Result |
| --- | --- |
| Registry API suite | 330 passed, 1 skipped |
| Web suite | 675 passed, 0 failed |
| Web production-mode Next.js build | Passed, including TypeScript and Director Copilot 2.0.4 contract validation |
| Docker Compose configuration | Passed with the production example environment |
| Repository skeleton | Passed |
| Generated OpenAPI consistency | Passed |
| Diff whitespace validation | Passed |

The skipped Registry test requires a dedicated PostgreSQL administrator URL
for a destructive migration fixture. It was not run against production.
The suite retains 22 dependency/deprecation warnings.

Focused regression coverage includes:

- personal versus team access, including attempts to opt into team data;
- assignment without decision capability and unchanged publication checks;
- filtering before pagination and exact-version visibility;
- employee-directive listing/detail parity and restrictive-policy denials;
- per-request policy memo isolation and no fallback after policy failure;
- malformed, incomplete and duplicate paginated responses;
- transport failure, timeout and invalid JSON classification;
- read-only task listing;
- maintenance transaction commit/rollback, lock contention and safe errors.

## In-App Browser Verification

These checks used local synthetic data, not a production identity. The
inspected browser viewport was 1038 px wide; no horizontal page overflow was
observed. This is not mobile or assistive-technology acceptance.

1. Manager: opened all four views, filtered the team queue, opened an exact
   document version and returned to the same view and filters.
2. Reader: personal workspace visible; team/admin/audit navigation absent.
   Directly requesting the team view remained limited to personal work.
3. Reader with a review assignment but no decision capability: review visible,
   no approval action offered and a clear lack-of-decision-rights message.
4. Filtering: previous rows hidden during refresh, progress visible, typing
   focus retained and URL state preserved across document navigation.
5. Unavailable backend: queue marked unavailable with an unknown count,
   not a successful zero-row result.
6. Unexpected error: localized recovery screen, no raw upstream exception.
   After the fault changed, Retry made a fresh request rather than replaying
   the old error payload.

The mock client is rendering/navigation evidence, not proof of real policy
enforcement or durable production decisions. Those constraints are covered
by Registry tests and require the production acceptance below.

## Performance Scope

The diagnosis observed multi-page personal-document loading around 145 s in
total and task responses around 7-12 s. Those observations are not a benchmark
of the changed code. This change removes complete-collection loading from
the personal screen, removes maintenance writes from GET and reduces repeated
identical policy calls within a request. It does not remove policy checks or
guarantee the latency of Access Governance.

Measure the changed code against the same authorized data volume after a
separately approved release. Report first visible progress, navigation p50/p95,
Registry/PDP call counts and failure recovery. Do not claim a production speedup
from local mock timings.

## Release And Acceptance Conditions

1. Review the final diff on a branch containing current main and production.
   Build the exact affected production images and run required same-SHA CI.
   The native build above does not replace the immutable Docker release gate.
2. Expected runtime changes are `web`, shared-source `chat-web` and
   `registry-api`; verify the repository's impact selector before release.
3. No schema migration is required. Review the maintenance enable flag and
   interval documented in `docs/operations.md`; production default is 60 s.
4. In PostgreSQL staging, verify concurrent Registry replicas, lock contention,
   rollback on maintenance error and immediate explicit review submission.
5. Under both an administrator and an authorized employee, check personal
   queues, current access projection, exact-version navigation, Back, filters
   and denied decision actions. Do not broaden grants to make counts match.
6. Verify that the authorized published employee directive is present in both
   listing/search and detail, while denied drafts and restricted sources stay
   inaccessible. Revoke access and repeat in a new request.
7. Exercise timeout, unavailable policy and recovery. No old rows, raw errors,
   false zero counts or stale authorization may replace a failed result.
8. Check desktop, narrow mobile, keyboard focus and pending announcements.
   Re-measure the real navigation path and inspect health/readiness after
   deployment. Production acceptance has not yet been performed.

No STRATOS change, role grant, e-mail worker or production deployment is
included in this local increment.
