# Document Intelligence

Document Intelligence is the Phase 03 layer that turns ingested documents into structured, citeable knowledge. It stays service-oriented:

- Registry API owns documents, versions, metadata, access policies, and audit events.
- Ingestion Service owns parsing, chunking, source metadata, embeddings, and indexing.
- RAG Retrieval Service owns retrieval, answer modes, source-context lookup, no-answer policy, and citation opening.
- Web UI owns document, citation, and viewer presentation.

## Implemented Baseline

- Markdown/text/PDF/DOCX parsing produces citeable chunks.
- Chunk payloads include source reference metadata:
  - `source_file_uri`
  - `source_file_name`
  - `source_mime_type`
  - `source_size_bytes`
  - `source_sha256`
  - `char_start`
  - `char_end`
  - `section_path`
  - `section_title`
  - `page_number`
- RAG exposes:
  - `GET /api/v1/chunks/{chunk_id}/source-context`
  - `GET /api/v1/citations/{chunk_id}/open`
- RAG exposes STRATOS extraction endpoints for Budget contract proposals:
  - `GET /api/v1/stratos/extractions/profiles`
  - `POST /api/v1/stratos/extractions/contracts/propose`
  - `GET /api/v1/stratos/extractions/{extraction_id}`
  - `POST /api/v1/stratos/extractions/{extraction_id}/feedback`
- Citation opening is audited as `citation.opened`.
- Chunk opening is audited as `chunk.opened`.

## Answer Modes

The RAG API accepts these Phase 03 modes:

```text
ask
standard_answer
normative_with_citations
normative_answer_with_citations
retrieve_only
summary
extract_obligations
extract_roles
extract_deadlines
extract_risks
find_procedure
find_owner
find_responsibility
create_checklist
create_faq
create_kb_article
find_conflicts
find_missing_metadata
explain_process
it_support_answer
manager_brief
audit_question
```

Each mode uses a mode-specific instruction while retaining the same hard rule: no sourced answer without citations. `compare` and `compare_documents` are still explicit future work for multi-document diffing.

## Employee Chat API

Phase 04 adds an employee-facing API on the RAG Retrieval Service:

```text
POST /api/v1/assistant/chat
POST /api/v1/assistant/clarify
GET  /api/v1/assistant/suggestions
GET  /api/v1/assistant/conversations/{conversation_id}
GET  /api/v1/assistant/citations/{chunk_id}/open
```

The assistant wraps retrieval, no-answer policy, answer composition, and citation opening in a plain-language contract for employees. It asks clarifying questions for vague access, incident, and approval requests before it retrieves.

## Assistant Tool Router

The AKB web/API bridge now routes each employee chat turn before it calls a
backend tool. The router is intentionally small and auditable:

- `registry_document_report` answers document inventory and list questions from
  Registry API metadata, for example "kolik máme dokumentů na téma
  digitalizace" or "seznam smluv do tabulky".
- `rag_document_answer` answers document-content questions through RAG
  Retrieval Service, including structured reports that interpret cited chunks,
  for example "vytvoř sestavu z obsahu smlouvy".

The router does not expose technical tool names in the user-facing answer and
does not send registry routing metadata into the RAG prompt. For RAG calls it
adds an internal `assistant_query_plan` to the assistant context; for structured
answers it also adds a bounded `answer_format_instruction`, requiring meaningful
multi-column tables and source-supported obligation rows when the user asks for
obligations.

`assistant_query_plan` is deterministic for a given message and routing outcome.
It records:

- `plan_id` and `version`;
- the selected intent such as `grounded_answer`, `structured_report`,
  `obligation_table`, `document_metadata_report`, or `document_list`;
- the planned output kind (`answer`, `table`, or `registry_report`);
- registry topics and report kind when Registry metadata is used;
- quality gates, including whether citations and row-level citations are
  required.

Every response returned by the AKB web/API bridge carries the same internal
enterprise envelope in `current_context`:

- `assistant_contract_version`
- `assistant_query_plan`
- `assistant_tool`
- `assistant_tool_reason`
- `answer_source`
- `structured_output_requested`
- `obligation_output_requested`
- `report_artifact_count`

These fields are for routing, continuation, audit, and diagnostics. They are not
rendered as user-facing prose. Persisted conversation history is re-normalized
with the preceding user prompt so a structured answer keeps the same report
artifact and non-duplicated display text after a page reload.
`POST /api/assistant/clarify` uses the same response normalizer as
`POST /api/assistant/chat`; clarify turns are always kept on the RAG path
because they continue an already-started document-content conversation.

Internal warning flags such as registry/report routing markers are not rendered
as raw codes in the Employee Chat Portal. The UI either hides purely technical
flags or maps operational warnings to short user-facing messages.

## Employee Chat Report Artifacts

When the employee asks for a table, report, overview, Excel/PDF export, or
similar structured output, `POST /api/v1/assistant/chat` may return
`report_artifacts` alongside the normal answer and citations. A report artifact
is a bounded, server-validated table specification:

- `columns` defines stable keys, labels, and simple scalar types.
- `rows` contains scalar cell values only.
- each row may carry AKB citations back to document versions and chunks.
- `export_formats` currently contains `xlsx` and `pdf`.
- `artifact_contract_version: "report.v2"` marks the enriched artifact contract.
- `artifact_kind` distinguishes `content_table` from
  `registry_metadata_table`.
- row `source_refs` describe whether a cell is cited, metadata-derived,
  explicitly not stated, or uncited.
- `provenance` records whether the artifact came from a RAG Markdown table, a
  RAG structured artifact, or Registry metadata.
- `quality` records validation status, issue codes, informative row count, and
  row citation coverage.

The LLM does not execute spreadsheet code. AKB builds the artifact from the
cited answer and authorized citations, and the web BFF exports it through:

```text
POST /api/assistant/reports/export
```

The export endpoint validates row/column limits and writes either a static
`.xlsx` workbook with `Sestava` and `Citace` sheets or a static `.pdf` report
with the same content. It returns the file as a private download. It does not
call internal storage directly from the browser and does not create macros,
formulas, scripts, or external links.

Content artifacts must keep row-level citations. Registry metadata artifacts
are the only exception: they are permission-scoped metadata aggregations from
Registry API, not an interpretation of document content, and therefore may have
zero chunk citations.

AKB now applies the Assistant Structured Artifact Protocol before a report is
shown or exported:

- reports need at least two meaningful columns and at least one row,
- rows must contain at least two non-empty, non-placeholder values,
- raw Markdown table syntax and repeated user prompts are rejected,
- generic cited-answer summaries are rejected as report artifacts,
- content reports must remain citation-bound,
- Registry metadata reports are allowed without chunk citations because they
  are permission-scoped metadata aggregations.

Markdown table extraction is a compatibility bridge only. It can replace a bad
generic report when the answer contains a useful table, but it is not the target
enterprise report generation model. When AKB promotes a Markdown table into a
valid report artifact, the display answer keeps the surrounding prose but
removes the original Markdown table so the user sees the table only once in the
report surface. See
`docs/adr/0005-assistant-structured-artifact-protocol.md`.

## Registry Metadata Reports

The employee chat distinguishes content questions from registry inventory
questions. When a user asks for counts, lists, tables, or exports over document
topics, for example "kolik máme dokumentů na téma digitalizace a řízení
projektů", the AKB web BFF answers from Registry API metadata summary before
calling RAG. This keeps exact inventory work out of the LLM path:

- Registry API still applies `document.read` authorization for the current
  user.
- The preferred path is
  `GET /api/v1/documents/metadata-summary?topic=...`.
- STRATOS context is passed through to the metadata summary as
  `tenant_id`, `external_system`, `entity_type`, `entity_id`, `external_ref`,
  and repeated `context_tag` filters. The web fallback applies the same filters
  if it must scan `/documents`.
- The answer is marked with `answer_source: "registry_metadata_summary"` when
  the summary endpoint is used, or `answer_source: "registry_metadata"` when a
  compatibility fallback scans `/documents`.
- The returned `report_artifacts` contain no chunk citations because the result
  is a metadata aggregation, not an interpretation of document content.
- The audit event stores report metrics and a SHA-256 hash of the prompt, not
  the prompt text or document content.
- The compatibility fallback web registry client currently scans up to 20,000
  permission-visible documents. If that ceiling is reached, the response
  includes `REGISTRY_SCAN_LIMIT_REACHED`.

Registry metadata reports now have two structured shapes:

- `document_inventory_summary` for count/aggregate questions such as
  "kolik máme dokumentů na téma digitalizace".
- `document_list` for list requests such as "seznam smluv do tabulky"; AKB
  uses the permission-scoped `/documents` endpoint with the same STRATOS context
  filters and returns document metadata rows with XLSX/PDF export.

For production use across very large document sets, the current endpoint should
be optimized into a SQL-backed aggregate/search projection that can group by
topic, type, classification, owner, ingestion state, tenant, external system,
and context tags without transferring all rows through the web layer.

## Conversation Persistence

Assistant conversations are persisted in Registry API
(`assistant_conversations`, `assistant_messages`, and
`assistant_conversation_shares` tables, migrations 0006 and 0008).
After every chat turn the RAG service appends the user message and the
assistant response (including response type, citations, confidence, warnings,
and bounded report artifacts when present) via
`POST /api/v1/assistant/conversations/{conversation_id}/messages`.

The Registry API publishes history management under a separate path so it does
not collide with the RAG assistant conversation endpoint:

```text
GET   /api/v1/assistant/conversation-history
GET   /api/v1/assistant/conversation-history/{conversation_id}
PATCH /api/v1/assistant/conversation-history/{conversation_id}
PUT   /api/v1/assistant/conversation-history/{conversation_id}/shares
```

New conversations default to private visibility and 180-day retention. Owners
and admins may archive a conversation, shorten or extend `retention_until`, and
replace active user/group shares. Shared subjects can read the conversation;
`commenter` shares may append to the conversation without changing its owner.
Expired conversations are treated as not found and archived conversations are
hidden from the default list.

`GET /api/v1/assistant/conversations/{conversation_id}` on the RAG service
still returns `status: "persisted"` with the full message history when Registry
history is available; when the conversation does not exist or Registry API is
unavailable, the response degrades to `status: "ephemeral"` with the
`CONVERSATION_HISTORY_NOT_PERSISTED` warning. Persistence failures never block
the chat response itself.

## Language Contract

RAG answers and Employee Chat Portal responses support Czech and English:

- `response_language: "cs"` writes the final answer and assistant clarifications in Czech.
- `response_language: "en"` writes the final answer and assistant clarifications in English.
- If omitted, the default is Czech (`cs`).

The Web UI language switcher sends the selected language to:

- `POST /api/v1/rag/query`
- `POST /api/v1/rag/answer`
- `POST /api/v1/assistant/chat`
- `POST /api/v1/assistant/clarify`
- `GET /api/v1/assistant/suggestions?response_language=cs|en`

The selected answer language is independent from document language. Source citations and source excerpts remain verbatim from the source document.

Response types:

```text
answer
clarification_needed
no_answer
restricted
handoff_recommended
```

Conversation history is persisted through Registry API when Registry is reachable. The endpoint returns a conversation id for correlation and later retrieval. If persistence is unavailable, RAG returns an explicit `ephemeral` status and `CONVERSATION_HISTORY_NOT_PERSISTED` warning instead of hiding the degradation.

## Source Context Contract

`source-context` returns:

```json
{
  "chunk_id": "chunk_...",
  "document_id": "doc_...",
  "document_version_id": "ver_...",
  "document_title": "Architecture",
  "source_file_uri": "s3://akl-documents/docs-import/...",
  "source_mime_type": "text/markdown",
  "source_file_name": "ARCHITECTURE.md",
  "viewer_mode": "markdown",
  "location": {
    "page_number": 1,
    "section_path": ["Architecture"],
    "section_title": "Architecture",
    "paragraph_number": null,
    "char_start": 0,
    "char_end": 1200,
    "bbox": null
  },
  "chunk_text": "...",
  "before_text": "Previous chunk context when available.",
  "after_text": "Following chunk context when available.",
  "warnings": []
}
```

Unsupported location fields are returned as `null`; the system must not invent page, bbox, slide, sheet, or paragraph positions.

`before_text` and `after_text` are assembled from neighboring chunks inside the same `document_version_id`. The default window is one chunk on each side and can be raised with `AKL_RAG_SOURCE_CONTEXT_WINDOW` when a deployment needs wider document context.

## Insights Architecture

The target insight shape is:

```json
{
  "insight_id": "string",
  "document_id": "string",
  "document_version_id": "string",
  "chunk_id": "string",
  "insight_type": "obligation|role|deadline|risk|decision|definition|process_step|control|exception|reference|summary|faq|glossary_term",
  "title": "string",
  "content": "string",
  "confidence": "high|medium|low",
  "citation": {},
  "metadata": {}
}
```

AI-produced insights must start as `proposed`; a human must accept or reject them before they become governed knowledge.

## STRATOS Contract Extraction

`contract_financial_v1` is the first controlled extraction profile for Budget &
Contract. It extracts proposed field values only when an authorized chunk
contains citeable evidence. Each proposal includes:

- `field`, `proposed_value`, `normalized_value`, `unit`, `confidence`,
  `status: "proposed"` and a reason,
- citation with `document_id`, `document_version_id`, `chunk_id`, page/section
  where available, `quoted_text`, `viewer_url`, and warnings,
- extraction-level `missing_information`, `warnings`, `source_chunk_ids` and
  status (`PROPOSED`, `PARTIAL`, `SUPERSEDED`, `ACCEPTED_IN_SOURCE_APP`,
  `REJECTED_IN_SOURCE_APP`, etc.).

Registry API persists extraction results in `document_extractions` and feedback
in `document_extraction_feedback` (Alembic migration `0007`). The idempotency
key is tenant-aware and includes the external app identity, document/version and
profile. A new document version supersedes older non-final extraction results.

AKB owns document AI extraction and audit. Budget owns final structured
entities and is the only system allowed to write Budget contract tables after
human confirmation. Budget must not store AKB binaries, extracted full text,
chunks, embeddings, prompts, or second-source AI result copies.

## Next Steps

- Add shared STRATOS review UI for accept/edit/reject/open citation workflows.
- Add extraction jobs for obligations, risks, roles, deadlines, FAQ, glossary terms, and controls.
- Add conflict and version comparison workflows.
- Add exact source rendering for PDF coordinates, Office previews, tables, slides, and OCR bounding boxes.
