# Document format capabilities V1

The binding AKB catalog is
[`contracts/document-formats/v1/catalog.json`](../../contracts/document-formats/v1/catalog.json).
It defines supported extensions, MIME aliases, extraction adapter, source locator,
requirements, processing budgets and Czech/English limitations. Document family
and business source profile are separate contracts.

`scripts/generate_document_formats.py` copies the catalog into the existing web
and ingestion Docker build contexts. The skeleton check rejects stale copies.
Do not edit a generated catalog or maintain a second upload accept list.

## Implemented consumption

- Web file selection and binary preflight use the same admitted extensions and
  MIME rules. Filename and MIME disagreement fails before intake. Recognized
  formats with no admitted extractor fail with `FILE_FORMAT_UNAVAILABLE` (415).
- The UI explains the selected format's limitations. Replacing/removing a file
  invalidates an earlier asynchronous hash/preflight result.
- Ingestion validates the catalog before choosing its parser, including optional
  Docling modes. The text adapter also handles the catalog's YAML, architecture
  and API specification text sources. This is serialized text extraction, not
  execution or interpretation of diagrams, compressed diagram content or API calls.
- PNG/JPEG/WebP have a native image path using Tesseract supplied by the standard
  OCRmyPDF image. OCR must be enabled. Verified single-frame images are bounded
  to 25 million pixels; animated/multi-frame images fail instead of silently
  extracting only the first frame. OCR output requires human review.
- XLSX/XLSM and PPTX use exact sheet/row and slide locators. Native Office
  processing budgets are read from the same catalog. See
  [native Office extraction](../ingestion/native-office-extraction.md).

There is no automatic enabling of an unavailable runtime dependency. Configured
OCR/Docling availability, malformed input, processing budgets and extraction
quality can still reject an otherwise admitted format. This static catalog is
an adapter contract, not a live readiness response or approval to publish.
Document policy, clean intake and current authorization remain mandatory.

## Explicit limits

DOC, RTF, GIF and SVG are currently marked unavailable for this complete intake
and extraction flow. Export to an admitted PDF/DOCX or single-frame raster
format. Existing Office rendition support alone is not an ingestion adapter.
EML/MSG and user archives are not advertised. New adapters require fixtures and
a coordinated catalog revision before their extensions are admitted.

Spreadsheets use stored cell values; formulas are not recalculated and macros
are not executed. Office images/diagrams, merged cells and complex layouts need
review. A good text-density score is not proof that every visual or business
fact has been captured. Original bytes remain the immutable source.

Only PDF page numbers identify physical PDF pages. Text sources, DOCX, sheets
and slide decks must use their supported section/sheet/row/slide coordinates.
Image OCR refers to the original image; no PDF page is invented.

## STRATOS client requirements

Consume the same catalog revision when offering attachments. Send the exact
filename/MIME/hash to the approved preflight operation and use its canonical
binary URL. Show an unavailable-format reason before uploading; do not change
the extension or send a false MIME to force admission. A new source profile
cannot broaden parser capabilities or bypass the mandatory document profile.

The pinned ingestion Debian snapshot has architecture-specific `unpaper`
rebuilds: `7.0.0-3+b2` on amd64 and `7.0.0-3+b3` on arm64. Both were verified
against the same 2026-08-24 snapshot. Dependency hashes and the production
architecture/release gates remain in force.
