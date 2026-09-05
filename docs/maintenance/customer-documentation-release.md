# Customer Documentation Release

This is an internal maintenance procedure, not part of the customer package.
The customer source list is
`docs/handover/akb-stratos-dokumentacni-sada.json`. Only its listed Markdown
sources, that inventory, the derived PDF and checksums may be distributed.
Do not recursively copy `docs/` or a previous output directory into a handover.

## Validation and Build

1. Update current customer-facing facts and the documentation revision together.
   Keep actual limitations and pilot assumptions; do not copy development history,
   test-account details, source-worktree paths or retired products into the text.
   Customer names must not appear in common sources, titles, tags, filenames,
   inventory fields or PDF metadata. Keep installation-specific facts in a
   separate restricted acceptance record, not in this reusable package.
2. Run `python tools/build_documentation_handover.py`. This read-only check rejects
   excluded content, unexpected inventory fields, duplicate identities, revision
   mismatches, symlinks and links to unlisted files.
3. Run the focused tests:
   `python -m pytest -q tests/test_documentation_handover.py` and, from the
   ingestion service, `python -m pytest -q tests/test_documentation_corpus.py`.
4. Build with `python tools/build_documentation_handover.py --build --font-dir <font-directory>`.
   The Python environment needs `markdown-it-py`, `PyYAML`, `reportlab` and `pypdf`.
   The font directory must contain DejaVu Sans regular, bold, oblique, bold-oblique
   and DejaVu Sans Mono. No runtime application dependency changes are required.
5. Render the PDF and inspect every page for text, table and footer collisions.
   The builder also verifies that all source text fragments occur in the PDF.
6. Verify ZIP membership and checksums. Generated output replaces only
   `output/akb-stratos-predavaci-dokumentace/`, its ZIP and the matching
   `output/pdf/akb-stratos-predavaci-dokumentace-cs.pdf`.

The builder starts with an empty staging directory. It does not carry forward
old QA reports or unlisted files. It never changes Registry, approvals, recipients,
application configuration or production data.

## Existing AKB Documents

The original import mapping is retained internally in
`docs/qa/application-documentation-import-state-2026-08-27.json`. The observation
applies to the original revision 1.0 only. Each new revision has new source hashes and
must be introduced as new versions of the same 16 document identities through
governed intake before approval/publication. Do not duplicate identities or mutate
existing version objects in place. Do not present a local PDF rebuild as a
successful application import, approval or reader acceptance test.

Renaming a customer-facing source file does not change its stable `external_ref`
or Registry document ID. Update the current document title and other display
metadata through an authorized metadata operation, not only the Markdown file.
The current document UI does not expose an existing-title/tag editor. If no
supported authenticated metadata client is available, an explicitly authorized
maintenance repair must be restricted to the reviewed document-ID allowlist:
back up the old display metadata, verify the expected state under a transaction
lock, change only titles/tags, and emit a metadata-only audit event. Verify that
versions, source hashes, access policies, assignments, tasks and publication
records are unchanged. Never use this exception for content intake, approval or
publication; new files still go through the governed upload and scan workflow.
Historical versions and their audit records remain unchanged. New content must
be reviewed by its assigned approver before publication; an earlier review does
not approve the new revision.

Current content includes the optional managed identity and central SSO contracts.
Keep their implementation, runtime activation and acceptance evidence separate.
Do not infer an IAM activation or an AKB application deployment from a document
upload. Each upload must preserve the existing document ID, assignments and
Information Policy; the changed version needs its own content review.

The customer inventory must not contain the internal mapping, actor names,
test-instance URL, observations or a link to this procedure. Preserve source
provenance in internal QA records and Git, outside the handed-over set.

Historical verification records describe only their named content revision and
observation time. Record the latest governed-intake results separately, including
the source hash, new version, scan, processing and review state for every document.
Do not reuse an earlier upload result as evidence for a changed source.

The revision 1.3 intake and display-metadata verification is recorded in
`docs/qa/customer-neutral-handover-2026-08-28.md`. It is internal evidence, not
part of the distributable inventory or proof of content approval/publication.
