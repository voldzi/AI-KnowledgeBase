# ADR 0003: STRATOS Document AI Boundary

Status: Accepted

## Context

ProjectFlow, Budget & Contract, and future STRATOS applications need document
AI capabilities without duplicating document storage, text extraction,
chunking, embeddings, retrieval, LLM calls, citations, or audit logic.

AKB already owns controlled documents, source files, ingestion, Qdrant-backed
retrieval, RAG citations, source opening, and document audit events.

## Decision

AKB is the single Document AI backend for STRATOS applications.

STRATOS applications may store only business-owned references and context:

- `external_system`
- `external_ref`
- `tenant_id`
- `entity_type`
- `entity_id`
- context tags
- returned AKB ids and canonical open URLs

They must not store binary document copies, extracted text, chunks, embeddings,
source preview payloads, or RAG prompt/response internals.

Shared UI components are distributed through the STRATOS shared UI package and
must call only the approved AKB web/API bridge or embed the AKB-hosted viewer.
Browser clients must not call Registry, Ingestion, Qdrant, object storage, or
LLM services directly.

## Consequences

- `docs/29_STRATOS_SHARED_LIBRARIES.md` defines the shared component standard.
- `docs/integration/STRATOS_EXTERNAL_DOCUMENTS_API.md` defines the stable AKB
  integration API contract.
- Citation opening uses AKB viewer URLs, not ordinary external links.
- AKB controls authorization and audit for document selection, upload, source
  opening, ingestion status, and citation jumps.
