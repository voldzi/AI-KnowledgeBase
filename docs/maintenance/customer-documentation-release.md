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
   `output/akb-stratos-predavaci-dokumentace-csu/`, its ZIP and the matching
   `output/pdf/akb-stratos-predavaci-dokumentace-csu-cs.pdf`.

The builder starts with an empty staging directory. It does not carry forward
old QA reports or unlisted files. It never changes Registry, approvals, recipients,
application configuration or production data.

## Existing AKB Documents

The original import mapping is retained internally in
`docs/qa/application-documentation-import-state-2026-08-27.json`. The observation
applies to the original revision 1.0 only. Revision 1.1 has new source hashes and
must be introduced as new versions of the same 16 document identities through
governed intake before approval/publication. Do not duplicate identities or mutate
existing version objects in place. Do not present a local PDF rebuild as a
successful application import, approval or reader acceptance test.

The customer inventory must not contain the internal mapping, actor names,
test-instance URL, observations or a link to this procedure. Preserve source
provenance in internal QA records and Git, outside the handed-over set.
