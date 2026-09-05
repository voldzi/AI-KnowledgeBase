# Customer Handover Identity Update, 2026-08-27

## Result

Customer documentation revision **1.2 is prepared and validated**. Its upload to
the existing AKB document identities is **blocked, not completed**. No new
document, version, approval, publication or access grant was created during this
update. Do not treat this report as an import or production acceptance record.

## Source and Runtime Evidence

- AKB implementation baseline: `8c3d683e8f9395b768aeee6a8788d1a4ae5d7115`.
- Gitea main baseline: `dbe8042be7581defc315fd9966b19204a496a5d4`.
- Verified AKB production release: `957c1d5e445970568e46c61a78d9227b1ff4fcf7`.
- STRATOS source baseline: `a739bfd7a752966bc0a16fa61100773b2a6b931d`.
- Reviewed STRATOS contracts: `docs/64_MULTI_SOURCE_IDENTITY.md` and
  `docs/65_CENTRAL_SSO.md`, including the current consolidated release notes.
- Public AKB health and readiness returned HTTP 200 during the initial check.
  This did not guarantee availability of authenticated document operations.

The prepared AKB identity implementation is not the verified production release.
The customer set distinguishes supported implementation, explicit configuration,
coordinated IAM activation and acceptance of the target installation. Neither
uploading documentation nor publishing Git history activates the managed issuer
or the central session-policy mapper.

## Updated Deliverables

The allowlisted inventory contains 16 Markdown sources: the handover, executive
overview, capability reference, security assessment, five pilot guides,
authoring methodology, intake procedure and five authoring templates.

Revision 1.2 covers optional managed identity, central SSO, signed session-policy
claims, absolute and inactivity limits, per-request authorization, separate
service identities, internal-only pilot connectivity and recovery constraints.
Templates remain templates, not evidence of an installed customer environment.

The derived PDF has 46 pages. All pages were rendered and visually inspected,
including tables, Czech glyphs, source labels and page footers. The ZIP contains
19 allowlisted files with checksums. Generated output remains outside Git and
can be rebuilt with `tools/build_documentation_handover.py`.

## Validation

- Handover validation: 16 documents, revision 1.2, passed.
- Handover tests: 25 passed.
- Ingestion documentation-corpus tests: 19 passed.
- Skeleton and generated OpenAPI checks: passed.
- Whitespace/error check: passed.
- Redacted Gitleaks scan of commits not yet on the GitHub main backup: no leaks
  found. No token, cookie or secret was copied into this report or customer set.

These checks do not prove production ingestion, reader authorization, approval,
publication or Chat answers over revision 1.2.

## Upload Blockers

The authenticated administrator opened the existing handover document and its
normal new-version action. The form identified the correct document and proposed
Registry version 1.1 after the existing version 1.0. Registry version numbering
is independent of the source documentation revision 1.2; do not create filler
versions to make the numbers match.

Two independently observed routing defects prevent a stable upload form:

1. `apps/web/src/app/upload/page.tsx` invokes
   `getServerRequestContextForPath("/upload")` before preserving `document_id` in
   the authentication return path. After central SSO validation the request can
   return without the identifier and redirect to the document registry.
2. `apps/web/src/components/app-shell.tsx` treats membership in the main
   navigation list as the test for the current route. `/upload` is a contextual
   route, not a main navigation entry. After hydration the shell redirects the
   otherwise authorized upload form to Chat. A full authentication return URL
   allowed the form to render but did not prevent this subsequent redirect.

A separate transient server-rendering failure displayed diagnostic digest
`4004442785`. Redacted server-log inspection identified
`ACCESS_PROJECTION_UNAVAILABLE` in that failure. The digest is not a correlation
ID. No authorization bypass or fallback was attempted.

No upload submission succeeded or was observed. The original import mapping in
`application-documentation-import-state-2026-08-27.json` remains the immutable
record of revision 1.0, not evidence of this revision's upload.

## Safe Completion Sequence

1. Correct contextual-route handling without weakening server-side capability
   or Information Policy checks; preserve the complete validated upload return
   path across SSO.
2. Test an authorized administrator and a denied reader, with and without a
   current SSO-validation marker. Verify that hydration preserves the form.
3. Release the narrow correction through the normal same-SHA gates, separately
   from any unaccepted managed-identity activation.
4. Upload revision 1.2 through governed intake as new versions of the same 16
   document identities. Preserve assignments and policy. Record exact version
   IDs, source hashes, scanner attestations and ingestion results.
5. Submit for the assigned content review only through the authorized workflow.
   Do not inherit approval from old content or publish during a binary upload.
6. After approval/publication, run the reader and Chat acceptance cases listed
   in the customer intake procedure. Preserve access to exact historical
   citations; do not mutate old version objects.

This report is internal QA material and is excluded from the customer package.
