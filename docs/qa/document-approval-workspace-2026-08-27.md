# Personal Document Workflow Verification

Date: 2026-08-27. Implementation worktree: `codex/document-approval-workspace`,
based on `957c1d5e445970568e46c61a78d9227b1ff4fcf7`.
Status: locally verified, not committed, not deployed. This is not production
acceptance evidence or authorization to publish existing documents.

## Delivered Scope

- `/tasks`: personal approvals, personal tasks and assigned documents;
  the team view remains administrator-only.
- Personal document filters: responsibility, latest accessible version state,
  validity/review attention and title.
- Exact-version submission, assigned human/group decision, return to gestor,
  resubmission and separate publication.
- Existing publication remains in force while a replacement is prepared.
- Date calculations use Europe/Prague. Expiry and review are separate; absent
  dates are not inferred from document age.
- E-mail delivery is a documented follow-up, not an enabled feature.

## Automated Results

| Check | Result |
| --- | --- |
| Registry API suite | 250 passed, 1 skipped |
| Web suite | 561 passed, 0 failed |
| Web TypeScript | passed |
| Web production Next.js build | passed, including Director Copilot 2.0.4 contract check |
| Repository skeleton | passed |
| OpenAPI generation check | passed |
| Whitespace/diff check | passed |

The Registry suite retains its optional PostgreSQL migration integration skip
when its dedicated test database is not configured. Existing dependency
deprecation warnings were not changed. Web scanner tests require local
loopback sockets and were rerun successfully outside the filesystem sandbox.

Focused cases cover:

- exact version and source binding; idempotent repeated submission;
- separation of assignment from capability, self-approval denial and rejection
  of service/unit-only approvers;
- source, attachment, metadata, assignment and newer-version changes;
- rejected approval replay and prevention of patch/resolve/reassign bypasses;
- one returned task, preserved comments and a new review cycle on resubmission;
- preservation of the published version until the replacement is published;
- changed/unavailable Information Policy, per-version visibility and
  authorization before pagination;
- incomplete, duplicated or changing paginated personal lists;
- mandatory clean scan and exact source attestation;
- Prague midnight/DST, inclusive validity end, missing/invalid review dates;
- safe localized errors and technical-only audit event metadata;
- stored OpenAPI parity with the new runtime paths and schemas.

## Browser Checks

The in-app browser used synthetic local data on `127.0.0.1:3047`, never a
production account. Desktop 1280 x 900 and mobile 390 x 844 were inspected.

- Assigned reviewer: one personal review, exact-version document link,
  approve/return controls and correct return to the same task view.
- Gestor/owner: seven assigned synthetic documents and no assigned review;
  own tasks and document filters remain distinct.
- Title filtering reduced the document table to the expected single row.
- Missing review dates are visible, not represented as valid dates.
- Page scroll width equals viewport width at 390 px. Wide document tables
  retain their own horizontal scrolling; view tabs remain scrollable.
- Shared STRATOS controls, visible focus and compact mobile heading were
  visually checked. This is not a complete screen-reader certification.

The existing mock API factory creates fresh clients between requests. A mock
action can return success without persisting across a full page refresh;
therefore browser checks prove rendering/navigation, not production durability.
Durable approval state, queue closure and security decisions were verified by
the Registry API tests. The mock client also has an in-process full-cycle test.

## Release Conditions

1. Review the isolated branch without overwriting the original worktree's
   unrelated documentation changes.
2. Build the affected `web` and `registry-api` production Docker images;
   include `chat-web` if the repository release impact selector requires its
   shared web source. The native web build above is not Docker image evidence.
3. Run required same-SHA CI and the existing immutable release gates. No gate
   is waived by these local results.
4. In a database-backed staging environment, verify the full browser sequence
   as two distinct authorized users, refresh each personal queue, revoke one
   required capability and confirm the next decision is denied.
5. Verify simultaneous submissions/decisions using PostgreSQL, source change
   after submission, replacement publication and previous-version access.
6. After a separately authorized release, check health/readiness and personal
   queues with real access projection. Do not bulk-approve existing content.

No migration, SMTP credential, Keycloak grant or STRATOS modification is part
of this increment. See `docs/ui/workflow-inbox.md` for the separately approved
outbox/e-mail design.

The managed Chroma index currently targets the original repository path, not
this isolated worktree. Reindex the implemented branch after integration into
that managed path; an original-path refresh does not index this new code.
