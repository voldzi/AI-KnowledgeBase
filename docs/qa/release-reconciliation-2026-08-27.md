# Release Reconciliation, 2026-08-27

## Baseline and Scope

- Verified production: `957c1d5e445970568e46c61a78d9227b1ff4fcf7`.
- Gitea main: `dbe8042be7581defc315fd9966b19204a496a5d4`.
- Prepared branch: `codex/managed-stratos-identity`, based on both commits.
- Reviewed prepared tip: `53d0e1ff45ef6aa8ce13ebb00d5ef36278714d25`.

The working-baseline guard passes. The candidate includes assigned document
approval/owner workspaces, governed application-documentation retrieval,
current customer handover documentation, central SSO and optional managed
identity support. The additional correction preserves the document identifier
through upload authentication and separates contextual-route authorization
from membership in the navigation menu.

This is candidate verification, not a production acceptance record. Deployment
must still pass same-SHA CI, exact production image builds and immutable release
gates. Current Keycloak/external OIDC configuration remains authoritative;
managed identity activation requires separate coordinated IAM acceptance.

## Unfinished Work Review

- `codex/document-approval-workspace` in the temporary document-workflow
  worktree is patch-equivalent to candidate commit `af90137`. Do not apply it
  again. Remove its clean local worktree/branch only after release verification.
- `codex/chat-handover-readiness` has no unique patch missing from the candidate.
- Archived Budget diagnostics, document-rendition, historical-rule, mobile-chat
  and suggestion release branches contain no additional patch to apply.
- The older self-hosted CI and Gitea migration branches describe superseded
  execution paths. Current Gitea workflow and repo-scoped runner remain in use.
- Older routing, personalized suggestions, server-side sessions and app-switcher
  branches are superseded by newer implementations in current history. Their
  unique historical commits must not be reapplied as a bulk merge.
- The old source-access branch contains an older domain manifest. Reintroducing
  it would regress the accepted contract. STRATOS-owned code is out of scope.

Unmerged remote history is preserved. Clean-up is limited to verified merged or
patch-equivalent local branches and stale worktree registrations; it does not
remove documents, indexes, audit history or other applications' resources.

## Verification Before the Image Gate

- Web: 653 unit tests passed; semantic component registry, type checking and
  native Next.js build passed.
- Registry: 315 unit tests passed; its initially skipped PostgreSQL fixture was
  then run with an isolated PostgreSQL 16 instance. Both migration tests passed,
  including backfill and cross-document constraints.
- Ingestion: 125 tests passed after installing the declared Office/PDF test
  dependencies in the local virtual environment. Initial missing-dependency
  failures were environmental, not suppressed test cases.
- RAG retrieval: 247 tests passed.
- LLM gateway: 48 tests passed.
- Governance: 20 tests passed.
- Evaluation: 25 tests passed.
- Playwright: all 28 product-path tests passed with the normal mock profile.
- The DW-08 approval test also passed with explicit test subject `user_301`.
  Default administrator `user_dev` cannot approve the unassigned review; the
  assigned reviewer can record the decision. Mock identity changes are confined
  to the local test process.
- Upload regression covers file selection, hydration, page reload, PKCE return
  state, a manual authentication retry, denied readers and the standalone Chat
  profile.
- Skeleton, generated OpenAPI and Compose rendering passed.
- Redacted Gitleaks scan of the five prepared commits: no leaks found.

Reproduce the assigned-reviewer browser case with:

```bash
cd apps/web
AKL_WEB_DEV_SUBJECT=user_301 pnpm exec playwright test \
  e2e/document-workbench.spec.ts --grep DW-08
```

## Production Preparation

The existing release selector conservatively selects all eight managed runtime
images because this candidate changes shared contracts, Compose configuration
and scripts. Build web and standalone Chat with the repository-root context and
their distinct base-path arguments; build each Python service with its exact
service directory. Do not skip any selected service or change the selector
during this release.

The candidate requires a separate server-side session encryption key for Chat.
Provision the new protected key file without modifying the existing AKB web key
or printing either value. Keep issuer, browser registrations, service identities,
route grants and Director Copilot mode unchanged. Never send old client secrets
to a newly configured issuer.

After release, upload customer revision 1.2 as new versions of the existing 16
document identities through governed intake. Preserve policy and assignments.
Do not automatically approve or publish the new content. The previous import
record remains an immutable record of the original versions.

This internal report is excluded from the customer handover allowlist.
