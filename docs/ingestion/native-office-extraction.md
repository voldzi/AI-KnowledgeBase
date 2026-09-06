# Native Office extraction and exact source coordinates

The native XLSX/XLSM and PPTX adapters extract text from the immutable original
file. Supported extensions and adapter ceilings come from the shared
[format-capability catalog](../CONTRACTS/DOCUMENT_FORMAT_CAPABILITIES_V1.md).
This is bounded text/table extraction, not a claim to reproduce every Office
calculation, layout or visual element.

## Worksheets

The reader processes the actual worksheet stream, including data after long
runs of blank rows. It does not trust the producer's worksheet dimension or
stop after a fixed number of empty rows. Every retained cell stays in its
original column; embedded cell whitespace is normalized and literal `|` is
escaped. Leading/interior/trailing empty cells do not shift other values.

Blocks contain at most 40 nonempty source rows, with the first nonempty row
repeated as context in continuation blocks. This repetition does not establish
that a workbook has a formally approved table header. The exact source row of
that context is retained. Native extraction reads stored cached values and
never executes formulas, macros or external links. Formula cells (including
missing caches), merged cells, images and charts produce explicit review
warnings. High text density does not clear `requires_review`.

## Presentations

Text, tables and speaker notes keep their original one-based slide coordinate.
Table cells retain all column positions, including empty cells and blank table
rows. Tables have a separate shape/table identity, so two tables on one slide
cannot acquire each other's row coordinates. Oversized tables split by whole
rows with the source header repeated; a row and header exceeding the configured
chunk ceiling fail the job instead of splitting the cell association. Merged
cells, charts, images and grouped shapes require review of the original source.

## Citation contract

Native Office blocks use `page_number=null` and `pages_processed=0`: a worksheet
or slide is not a verified page in a PDF rendition. Internal metadata keeps
`sheets_processed` or `slides_processed`; non-paginated text quality uses the
existing logical-body calculation.

`metadata.source_locator` is carried through chunking and indexing into the RAG
payload mapper. It has a `kind` (`sheet` or `slide`), exact sheet name or slide
number, original `row_numbers`, and relevant column/shape/table coordinates.
Row numbers include the original repeated header and may be non-contiguous.
Each split chunk gets its own row subset. Chunks with different locators do not
merge; parent retrieval cannot attach another sheet, row range or table under
the seed's citation.

The source-context before/after panes use chunk candidates with the same exact
version, file coordinates, policy coordinates and locator. Both the selected
chunk and its eligible neighbours are reauthorized before text is assembled.
Revoked access, missing TLP or unavailable current authorization cannot return
the selected text through the neighbour path. A failed neighbour index lookup
can return only the reauthorized selected source with an explicit warning.

Existing public DTO fields are used:

- `ChunkCitation.page_number` stays null; `section_path` includes the sheet or
  slide, table where applicable, and all cited row ranges.
- `SourceLocation.sheet_name`, `slide_number`, `row_number` and `column_name`
  carry the corresponding original coordinate. `row_number` is the first cited
  row, including a repeated header; the complete ranges are in `section_path`.
- Citation cards show sheet/row or slide information. Opening the original file
  does not fabricate a PDF page fragment. No coordinate implies that Office
  PDF pagination or a native spreadsheet scroll position has been verified.

Older/malformed index metadata cannot turn a sheet index into a physical page.
Missing source coordinates produce an explicit source-location warning; new
exact locators require reingestion of the immutable original. The clean target
has no legacy document migration requirement.

## Processing limits and failures

`OfficeLimits` reads its defaults from the generated shared catalog. Current
ceilings are 4,096 ZIP entries, 128 MiB total expanded size, 64 MiB per expanded
member, 100,000 visited rows (including blank rows), 512 columns, 2,000,000 visited
cells, 10,000,000 extracted characters, 1,000 slides and a 30-second cooperative
processing deadline. Limits apply to the complete file, not independently to
each worksheet or slide. Existing job chunk limits also apply.

A limit violation produces `XLSX_PROCESSING_LIMIT` or `PPTX_PROCESSING_LIMIT`;
encrypted archives are rejected separately. These failures are terminal before
OCR fallback. No partial parser result, embedding or index write is accepted.
ZIP member sizes bound Office-library input; time is checked during adapter
iteration. This is not a separate process or a hard operating-system memory/CPU
sandbox, and library calls themselves cannot be interrupted by the cooperative
check. Adversarial Office sandboxing remains a separate release-hardening scope.

## Evidence

`tests/test_office_locators.py` in ingestion uses real sparse and multi-sheet
workbooks, incorrect declared dimensions, presentation tables, empty cells,
large blocks, review conditions and limits. Actual ingestion jobs prove exact
payloads and no index writes after processing-limit denial.

RAG `tests/test_office_source_locators.py` runs real Office parsing/chunking and
the production index payload builder in an isolated process, then checks the
production RAG mapper, source context and parent-context isolation. Web
`tests/citation-source-location.test.ts` renders the actual citation components
and preserves the separate physical-PDF-page behavior.
