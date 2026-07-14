# AKB Intelligence Workbench

Validated: 2026-07-10.

## Goal

Intelligence Workbench is the first AKB-owned analytical surface for
TOVEK-like work over controlled documents. It is intentionally implemented as a
new menu and route so the existing Document Workbench, Knowledge Chat,
Registry, RAG, ingestion, STRATOS external document bridge, citations, source
opening, and audit flows remain unchanged.

The product goal is not to clone TOVEK. The goal is to provide comparable
analytical capabilities with AKB guarantees:

- permission-scoped results,
- controlled document identity and version context,
- readiness and extraction-quality signals,
- source links back to AKB document detail/viewer,
- entity and relationship evidence tied to citations.

## First Implemented Slice

Route:

```text
/intelligence
```

Implemented in this slice:

- new STRATOS shell menu item `Intelligence`,
- server-rendered page guarded by the existing `knowledge_workspace` access
  rule,
- Registry client support for the existing
  `GET /api/v1/documents/readiness-report` endpoint,
- production and mock Registry client implementations,
- Intelligence Workbench UI with local module navigation:
  - Overview,
  - Corpus,
  - Search,
  - Cases,
  - Entities,
  - Relationships,
  - Quality,
- AKB Query Composer in the Search section:
  - visual query boxes/chips,
  - immediate local suggestions for fields, operators, corpus terms, document
    metadata, OpenSearch entity values and saved case queries already delivered
    by the permission-scoped page,
  - server-side query validation, execution plan and live authorized OpenSearch
    hit estimate before search,
  - guided broadening actions when the current query has zero estimated hits,
  - permission-scoped dictionary built only from documents, facets and analyst
    cases available to the current user,
  - preview of the generated OpenSearch analyst query,
- permission-scoped document list, Registry metadata summary, document
  readiness report, corpus facets, issue samples, metadata-derived candidate
  entities, OpenSearch entity facets and relationship summaries,
- persistent analyst cases, saved queries and evidence references in Registry
  API,
- links back to authoritative AKB document detail.

The web layer still mediates browser access through approved AKB bridge routes.
Registry API now owns the analyst case persistence contract, while controlled
document records, versions and source files remain unchanged by Intelligence
workflows.

## Data Flow

```text
browser -> /intelligence
        -> AKB web server route
        -> Registry API list documents
        -> Registry API metadata summary
        -> Registry API readiness report
        -> Registry API analyst case APIs
        -> Ingestion Service entity facets/search/relationships
        -> /api/intelligence/query/suggestions for validation/hit preview/recovery
        -> Intelligence Workbench UI
        -> /documents/{document_id} for authoritative source review
```

The browser still does not call Registry API, Qdrant, OpenSearch, object
storage, ingestion, or LLM services directly.

## Boundary Decisions

- Registry remains the source of truth for document metadata, versions,
  assignments, workflow, authorization, external document references, readiness
  aggregates, and audit events.
- Intelligence Workbench does not mutate controlled document records, versions
  or source files. It may persist analyst-owned case metadata, saved queries and
  evidence references in Registry API.
- It does not replace Knowledge Chat or RAG answer generation.
- It does not bypass Registry authorization.
- It does not duplicate source files outside AKB object storage.
- STRATOS integrations keep using the existing external document contract.

## Current Analytical Capability

The first slice provides a corpus-level analytical cockpit:

- authorized corpus size,
- readiness score,
- review and blocked counts,
- document/status/classification/owner facets,
- issue distribution,
- issue samples for remediation,
- document search across title, id, owner, gestor, tags and metadata,
- candidate entities derived from trusted metadata:
  - document numbers,
  - owners/gestors,
  - tags,
  - external systems,
- deterministic chunk-level entity index facets from OpenSearch:
  - entity type distribution,
  - top normalized values grouped by entity type,
  - chunk coverage for entity-bearing chunks,
- advanced OpenSearch analyst search over authorized chunks:
  - smart/fuzzy BM25 search,
  - boolean query-string search,
  - exact phrase search,
  - proximity phrase search with controlled slop,
  - fielded search with `title:`, `body:`, `section:`, `entity:`, `source:`,
    `type:` and `class:` aliases,
- server-backed Query Intelligence Layer at
  `POST /api/intelligence/query/suggestions`:
  - validates only the assembled query; suggestion dictionary data is not
    reloaded for every keystroke,
  - derives permission-scoped Registry document ids for the current user and
    keeps only those ids in a five-second in-process cache to coalesce typing,
  - validates visual token output for unbalanced quotes/parentheses, blocked
    leading wildcards and malformed boolean operators,
  - returns an execution plan with inferred analyst mode, search fields, clause
    count and estimated cost,
  - runs a bounded `limit=1` analyst search to return the authorized total hit
    estimate without transferring result bodies,
  - previews at most two broader recovery queries only when the current query
    has zero hits,
  - degrades to local composition when preview is unavailable without exposing
    unauthorized source data,
- persistent analyst case work:
  - analyst-owned cases,
  - saved analyst queries,
  - evidence sets with document/version/chunk/page/section references,
  - audit events for case creation, query save and evidence add,
- relationship seeds from high-volume document type, classification and status
  buckets.

The workbench now renders both metadata-derived candidates and OpenSearch-backed
chunk entity facets. The facet endpoint is read-only and does not expose chunk
text. Existing corpus chunks can be upgraded with the OpenSearch entity backfill
without re-parsing, OCR, embedding regeneration or Registry mutation. Full
reingestion is still required when the source text itself must improve, for
example after OCR quality fixes.

For retrieval-index consistency, historical Qdrant payloads can be upgraded with
the companion Qdrant entity backfill. That operation changes payload metadata
only; it does not rewrite vectors or regenerate embeddings.

## Chunk Entity Layer

Implemented profile:

```text
rule_based_v1
```

The first entity layer runs inside `services/ingestion-service` during logical
chunking. It writes entity evidence into `DocumentChunk.metadata.intelligence`
and promotes summary fields into both Qdrant and OpenSearch payloads:

```json
{
  "metadata": {
    "intelligence": {
      "entity_extraction_profile": "rule_based_v1",
      "entity_count": 2,
      "entity_types": ["document_number", "email"],
      "entity_values": ["RMO12/2024", "ops@example.cz"],
      "entity_pairs": ["document_number:RMO12/2024", "email:ops@example.cz"],
      "entities": [
        {
          "type": "document_number",
          "value": "RMO 12/2024",
          "normalized_value": "RMO12/2024",
          "start": 120,
          "end": 131,
          "confidence": 0.88,
          "source": "chunk_text",
          "extraction_profile": "rule_based_v1"
        }
      ]
    }
  },
  "entity_types": ["document_number", "email"],
  "entity_values": ["RMO12/2024", "ops@example.cz"],
  "entity_pairs": ["document_number:RMO12/2024", "email:ops@example.cz"]
}
```

Supported entity types in this first profile:

- `email`
- `url`
- `ipv4`
- `phone`
- `date`
- `document_number`

Person, organization, unit, place and free relationship extraction are
intentionally not enabled in `rule_based_v1`. They need alias resolution,
confidence review and stronger false-positive evaluation before production
storage.

## Implementation Log

2026-07-10:

- Consolidated the Search section around Query Composer as the primary search
  path. Raw OpenSearch syntax, mode, fields and proximity controls are now
  progressively disclosed under advanced settings.
- Moved entity-specific evidence search to the Entities section so the Search
  section no longer presents three competing query surfaces.
- Added live authorized hit estimates and zero-result recovery actions to the
  Query Intelligence response and UI.
- Kept corpus/entity/case suggestions local to the already authorized page
  payload; the preview bridge no longer reloads entity facets and case data on
  every input change. Client debounce is 350 ms.
- Query chips display the actual value instead of the longer suggestion action
  label.
- Added analyst role aliases and role-aware navigation visibility. This is UX
  affordance only; backend authorization remains authoritative.
- Added QA coverage for query recovery and role navigation rules.

2026-07-09:

- Added web route `apps/web/src/app/intelligence/page.tsx`.
- Added UI component
  `apps/web/src/features/intelligence/intelligence-workbench.tsx`.
- Added route and rail/sidebar navigation in
  `apps/web/src/components/app-shell.tsx`.
- Added web Registry client method `getDocumentReadinessReport`.
- Added TypeScript readiness types in `apps/web/src/lib/types/documents.ts`
  and `apps/web/src/lib/types/api.ts`.
- Added mock readiness computation for local/mock web mode.
- Added compact Intelligence Workbench styles in `apps/web/src/app/globals.css`.
- Documented architecture and information architecture updates in this file,
  `docs/architecture.md`, `docs/ui/information-architecture.md`, and
  `docs/maintenance/project-status.md`.
- Added ingestion-side entity extraction profile `rule_based_v1` in
  `services/ingestion-service/intelligence/entities.py`.
- Logical chunking now stores `metadata.intelligence` for each chunk.
- Qdrant and OpenSearch payloads now expose `entity_types` and `entity_values`
  as top-level fields; OpenSearch ensures the mapping idempotently for existing
  indexes.
- Added `entity_pairs` payload field to preserve type/value pairing for
  OpenSearch facets.
- Added scoped ingestion endpoint
  `POST /api/v1/intelligence/entities/facets/query`. The legacy unscoped GET is
  local mock/disabled only and fails closed in production.
- Web Intelligence page now fetches entity facets through the existing
  server-side ingestion API client and renders a `Chunk entity index` panel.
- Added ingestion endpoint `POST /api/v1/intelligence/entities/search` for
  OpenSearch-backed chunk evidence search filtered by text, entity type and
  entity value. The request requires authorized document IDs.
- Added web bridge route `POST /api/intelligence/entities/search`, which obtains
  a short-lived Registry proof over the exact authorized
  document/version/policy-hash coordinates before calling ingestion and filters
  returned hits again before sending them to the browser.
- Intelligence Workbench now includes an `Evidence search` panel and clickable
  entity values that return cited chunk snippets with document/version metadata.
- Added ingestion endpoint `POST /api/v1/intelligence/entities/relationships`
  for deterministic evidence-backed `co_occurs` edges from entity pairs in the
  same authorized chunk.
- Added web bridge route `POST /api/intelligence/entities/relationships`, which
  obtains and forwards the same exact Registry-issued scope proof and filters
  returned edge evidence before sending it to the browser.
- Intelligence Workbench now includes an `Entity relationships` panel. Clicking
  an entity value loads both cited search results and relationship edges that
  include the selected entity.
- Added ingestion endpoint `POST /api/v1/intelligence/analyst/search` for
  OpenSearch-backed advanced analyst search with smart, boolean, phrase,
  proximity and fielded query modes. The endpoint requires authorized document
  IDs and never performs browser-direct OpenSearch access.
- Added web bridge route `POST /api/intelligence/analyst/search`, which obtains
  and forwards the same exact Registry-issued scope proof before calling
  ingestion and filters returned hits again before sending them to the browser.
- Caller-supplied `allowed_document_ids` is a compatibility filter only, never
  authority. Ingestion confirms the proof through Registry before binding any
  OpenSearch filter.
- Intelligence Workbench now includes an `Advanced analyst search` panel with
  mode, field and proximity controls. Results reuse the evidence hit card and
  link back to authoritative AKB document detail/source review.
- Added Registry API analyst case persistence under
  `GET/POST /api/v1/intelligence/cases`,
  `GET/PATCH /api/v1/intelligence/cases/{case_id}`,
  `POST /api/v1/intelligence/cases/{case_id}/saved-queries` and
  `POST /api/v1/intelligence/cases/{case_id}/evidence`.
- Added web bridge routes under `/api/intelligence/cases`. Browser clients still
  do not call Registry API directly.
- Intelligence Workbench now includes an `Analyst case` panel. Users can create
  a case, select an active case, save the current advanced search query and add
  search hits to an evidence set. Evidence stores bounded snippets and source
  references; audit metadata stores only identifiers/counts, not query text or
  document body snippets.
- Intelligence Workbench now uses a local submenu to keep navigation bounded:
  `Overview`, `Corpus`, `Search`, `Cases`, `Entities`, `Relationships` and
  `Quality`. The main STRATOS shell menu stays short, while each Intelligence
  capability is rendered as a focused working area instead of one long page.
- Added AKB Query Composer v1 in the `Search` workspace. It lets users build
  analyst queries from visual chips and suggestions instead of typing raw
  OpenSearch syntax. Suggestions come from field aliases, boolean operators,
  permission-scoped document titles/metadata, metadata-derived candidates,
  OpenSearch entity facets and saved queries in analyst cases. The composer
  writes the resulting query into the existing analyst search flow and can run
  it directly.
- Added server-backed Query Intelligence Layer for the composer under
  `/api/intelligence/query/suggestions`. The browser now asks the web bridge for
  permission-scoped suggestions and a validation plan; local suggestions remain
  as a fallback if the bridge is unavailable.
- Added `scripts/backfill_opensearch_entities.py` for idempotent backfill of
  `metadata.intelligence`, `entity_types`, `entity_values`, `entity_pairs` and
  `search_text` on existing OpenSearch chunk documents.
- Added `scripts/backfill_qdrant_entities.py` for idempotent payload-only
  backfill of the same entity metadata on existing Qdrant points.
- Ran the production OpenSearch entity backfill on `docker.home.cz` for
  `akl_document_chunks`: 16,856 chunks scanned and updated, 3,694 chunks with
  entities, 9,279 entities found, 0 skipped text chunks and 0 bulk failures.
  A follow-up `--missing-only --dry-run` scanned 0 chunks, confirming that the
  existing OpenSearch corpus carries the `rule_based_v1` profile.
- Ran the production Qdrant entity payload backfill on `docker.home.cz` for
  `akl_document_chunks`: 16,856 points scanned, 16,856 points carrying the
  `rule_based_v1` profile, 3,694 points with entity pairs, 9,279 entities
  counted from payload metadata and 0 update failures. A follow-up
  `--missing-only --dry-run` returned `updated=0`.

## Next Slices

1. Analyst case hardening:
   - add export formats for case evidence reports,
   - add saved query presets and query history,
   - add query explain/diagnostic metadata for result tuning without exposing
     document bodies in logs.

2. Relationship graph hardening:
   - add optional persistent relationship snapshots for expensive corpora,
   - separate chunk, section and document-level co-occurrence confidence,
   - add rule-based and LLM-assisted relation extraction after evaluation.

3. Graph/timeline/map UI:
   - graph view for entity-document relationships,
   - timeline from document validity, issue dates and extracted events,
   - map view only for validated location/symbol data.

4. Watchlists:
   - entity watchlists,
   - saved-query watchlists,
   - alerts after new ingestion.

## Acceptance Bar

Each future Intelligence capability must answer:

- what was found,
- why it is related,
- where the evidence is in AKB,
- who is allowed to see it,
- how reliable the extraction is.

Capabilities that cannot provide source evidence, authorization enforcement and
audit-safe metadata stay outside production Intelligence Workbench.
