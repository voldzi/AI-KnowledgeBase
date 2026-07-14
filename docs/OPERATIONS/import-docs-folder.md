# Import Docs Folder

`tools/import_docs_folder.py` provides dry-run inventory for local Markdown
documentation. Mutation is retired in every environment and fails before
Registry, Ingestion, object-storage, or index writes. Actual imports use the
governed application UI/API.
It is a Markdown-source importer. If the Markdown file is only a text derivative
of an original PDF, use `tools/import_original_pdf_versions.py` only for a
dry-run inventory; host-side `--apply` is retired in every environment and
actual imports use the governed application. See
`docs/OPERATIONS/import-original-pdf-sources.md`.

## Prerequisites

- Phase 02 real local RAG profile is running.
- Registry API, Ingestion Service, RAG Retrieval Service, LLM Gateway, Qdrant, and OpenSearch are healthy for the real local profile.
- Ingestion Service uses local object storage mode from the dev compose stack.
- Qdrant collection `akl_document_chunks` uses `bge-m3` embeddings with vector size `1024` and distance `Cosine`.
- OpenSearch index `akl_document_chunks` is available on `AKL_IMPORT_OPENSEARCH_URL` for host-side import verification.

## Manifest

The default manifest is `docs/import-manifest.yaml`.

Default metadata:

```yaml
document_type: project_documentation
classification: internal
status: valid
owner: akl-team
language: cs
source_system: git
```

`path_rules` match repository-relative paths inside the selected source folder and can override metadata such as `area`, `classification`, `document_type`, `status`, `owner`, `language`, `source_system`, and `tags`.

## Run

Dry run without Registry/Ingestion/Qdrant writes:

```bash
python3 tools/import_docs_folder.py \
  --source ./docs \
  --manifest docs/import-manifest.yaml \
  --mode skip-existing \
  --limit 5 \
  --dry-run \
  --report reports/docs_import_report.json
```

## Retired Mutation Modes

- `skip-existing`, `new-version`, and `reindex` remain usable only as dry-run
  planning inputs. Without `--dry-run`, the tool exits before mutation.

The idempotency key is Registry document metadata field `source_path`. Repeated runs do not create duplicate Document rows for the same Markdown path.

## Original Source Files

Markdown imports store the Markdown file as the Registry `source_file_uri` and as the object shown by signed source
opening. This is correct for repository documentation and Markdown-native controlled documents.

For corpora prepared from external PDFs, keep the Markdown derivative only as
ingestion/import working material and run only the original PDF dry-run
inventory after the Markdown documents exist:

```bash
python3 tools/import_original_pdf_versions.py --report reports/original_pdf_import_report.dry-run.json
```

Do not add `--apply` in any profile. The PDF tool is also dry-run-only and exits
before mutation. Actual imports use the governed application UI/API. Documents
without a governed PDF import path remain Markdown-backed until the original is
supplied.

## Reports

The importer writes:

- JSON report: `reports/docs_import_report.json`
- Markdown report: `reports/docs_import_report.md`

The report contains found, imported, skipped, and failed document counts, total chunks, total Qdrant points, errors, and import timing.
When OpenSearch is reachable, it also contains `opensearch_documents`; set `AKL_IMPORT_REQUIRE_OPENSEARCH=true` or pass `--require-opensearch` to fail the import when OpenSearch has fewer indexed chunks than the ingestion report created.

## Smoke Test

Importer-backed mutating smoke flows are retired; neither bearer credentials
nor disabled/mock auth enables them. Perform imports through the governed
application UI/API, then verify Qdrant/OpenSearch and ask RAG:

```text
Jak funguje RAG retrieval a citace?
```

The answer must include citations.

## Document Viewer Verification

After a governed import, use the application/citation flow to open the first
citation through `GET /api/v1/citations/{chunk_id}/open` and verify that
`source_file_uri`, `viewer_mode`, and `chunk_text` match the indexed payload.

## OpenSearch Backfill

After enabling OpenSearch on an environment that already has Qdrant chunks, backfill the fulltext index from existing Qdrant payloads before relying on hybrid retrieval:

```bash
python3 scripts/backfill_opensearch_from_qdrant.py \
  --qdrant-url http://qdrant:6333 \
  --opensearch-url http://opensearch:9200
```

This only writes the OpenSearch chunk index. It does not change Registry documents, source files, Qdrant vectors, or document versions.
