# ADR 0019: One document format capability catalog

Status: accepted for the clean AKB working implementation, 2026-09-05.

## Decision

Use one versioned JSON format catalog for file selection, binary preflight and
ingestion adapter selection. Generate copies into the existing service build
contexts and check their parity in CI. Document family, workflow and source
authority remain separate concepts.

An allowed filename extension is not sufficient evidence that AKB can extract
and cite its content. Formats without a complete admitted adapter are explicitly
unavailable; the UI offers conversion to supported formats before bytes are
uploaded. In this clean environment we do not retain a permissive upload path
that only fails later during extraction.

The catalog declares exact citation kinds and processing limits. Text sections,
sheet rows and slides must not be labeled as physical PDF pages. Runtime engine
availability, extraction quality, policy and current authorization remain
independent checks. A catalog entry grants none of them.

## Consequences

DOC/RTF/GIF/SVG intake is unavailable until their extraction adapters are added
and verified. PNG/JPEG/WebP use the standard image OCR path with explicit limits
and review; they do not depend on PDF-only OCR routing. Office and structured
text limitations are visible during selection. Adding a parser changes the
catalog, adapter, relevant fixtures and documentation together.

The schema and current behavior are described in
[Document Format Capabilities V1](../CONTRACTS/DOCUMENT_FORMAT_CAPABILITIES_V1.md).
