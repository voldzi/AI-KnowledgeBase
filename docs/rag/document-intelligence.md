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

## Employee Assistant API

Phase 04 adds an employee-facing API on the RAG Retrieval Service:

```text
POST /api/v1/assistant/chat
POST /api/v1/assistant/clarify
GET  /api/v1/assistant/suggestions
GET  /api/v1/assistant/conversations/{conversation_id}
GET  /api/v1/assistant/citations/{chunk_id}/open
```

The assistant wraps retrieval, no-answer policy, answer composition, and citation opening in a plain-language contract for employees. It asks clarifying questions for vague access, incident, and approval requests before it retrieves.

## Conversation Persistence

Assistant conversations are persisted in Registry API
(`assistant_conversations` and `assistant_messages` tables, migration 0006).
After every chat turn the RAG service appends the user message and the
assistant response (including response type, citations, confidence, and
warnings) via `POST /api/v1/assistant/conversations/{conversation_id}/messages`.
`GET /api/v1/assistant/conversations/{conversation_id}` on the RAG service
returns `status: "persisted"` with the full message history; when the
conversation does not exist or Registry API is unavailable, the response
degrades to `status: "ephemeral"` with the
`CONVERSATION_HISTORY_NOT_PERSISTED` warning. Persistence failures never block
the chat response itself.

## Language Contract

RAG answers and Employee Assistant responses support Czech and English:

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

## Next Steps

- Persist insights in a dedicated service/table owned by the appropriate service boundary.
- Add extraction jobs for obligations, risks, roles, deadlines, FAQ, glossary terms, and controls.
- Add conflict and version comparison workflows.
- Add exact source rendering for PDF coordinates, Office previews, tables, slides, and OCR bounding boxes.
