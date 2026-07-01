# ADR 0005: Assistant Structured Artifact Protocol

## Status

Accepted

## Context

AKB employee chat is becoming the primary STRATOS entry point for document and
organizational knowledge. Users can ask natural-language questions and request
tables, Excel exports, PDF reports, document lists, obligations, comparisons,
and other structured outputs.

The initial implementation allowed report artifacts to be produced from cited
answers and, in some cases, normalized from Markdown tables in the assistant
answer. That was useful for early MVP feedback, but it is not sufficient for an
enterprise system: a visually plausible Markdown table can still be a
one-column list, contain empty information, repeat the user prompt, leak raw
Markdown syntax, or expose an export button for a generic answer summary.

Professional enterprise assistants separate the user-facing answer from a
validated artifact contract. The artifact is the source for UI tables and file
exports; Markdown is only a readable representation.

## Decision

AKB will treat assistant structured outputs as typed, server-validated
artifacts. The web BFF must not display or export a report artifact unless it
passes enterprise quality validation.

The first protocol version applies to `AssistantReportArtifact`:

- a report must have at least two columns,
- a report must have at least one row,
- rows must contain at least two non-empty, non-placeholder values,
- cells must not contain raw Markdown table syntax,
- cells must not repeat the user prompt as a report value,
- generic cited-answer summaries such as `Sestava z odpovědi AKB` are not
  enterprise report artifacts,
- content reports must keep citations on rows or otherwise declare cited source
  coverage,
- Registry metadata reports may have no chunk citations because they are
  permission-scoped metadata aggregations rather than content interpretation.

Markdown table parsing remains a compatibility bridge. It may create a report
artifact only when the parsed table satisfies the same quality rules.

Export endpoints use the same quality validation as the chat UI. A report that
cannot be shown must not be downloadable as XLSX or PDF.

The second compatible increment is `report.v2`. It keeps the existing
`report_artifacts` array and required fields, but allows additional
machine-readable fields:

- `artifact_contract_version: "report.v2"`;
- `artifact_kind` (`content_table` or `registry_metadata_table`);
- row-level `source_refs`;
- artifact `provenance`;
- artifact `quality`.

The AKB web/API bridge also attaches an `assistant_query_plan` to
`current_context`. The plan records the selected intent, backend tool, planned
output kind, registry topics, and quality gates. It is internal state for
continuations, audit, and diagnostics; it is not user-facing prose.

Guided report mode is represented as validated request context, not as visible
prompt engineering. The Employee Chat Portal may send
`assistant_report_request` with a bounded template, detail level, export format,
and known column keys. The web BFF uses that request to force structured output,
populate `assistant_query_plan`, build `answer_format_instruction`, and narrow
available export buttons. The original user question remains natural language.

For content tables, `report.v2` requires row-level citations. Registry metadata
tables are the explicit exception because they are permission-scoped metadata
aggregations rather than document-content interpretation.

## Consequences

- Bad tables disappear instead of being displayed as empty reports.
- RAG/service implementations must produce real structured artifacts instead of
  relying on generic citation-summary rows.
- Registry metadata reports remain valid without citations because Registry API
  is the authoritative source for permission-scoped metadata counts and lists.
- Future artifact types such as charts, workbooks, PDF briefs, source bundles,
  and action proposals must be added through explicit contracts and validators.

## Follow-Ups

1. Move RAG report generation from generic cited-answer summaries to
   task-specific structured extractors.
2. Add an assistant tool router so inventory, RAG, extraction, comparison, and
   action proposals are selected explicitly.
3. Extend the protocol with artifact-level provenance, row-level confidence,
   and artifact schema versioning. The initial compatible version is now
   `report.v2`; future work should move more structured artifact generation into
   task-specific extractors instead of Markdown compatibility parsing.
4. Add evaluation datasets for structured output quality, not only answer
   correctness.
