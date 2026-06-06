# Import Docs Folder

`tools/import_docs_folder.py` imports local Markdown documentation into AKL as controlled project documentation.

## Prerequisites

- Phase 02 real local RAG profile is running.
- Registry API, Ingestion Service, RAG Retrieval Service, LLM Gateway, and Qdrant are healthy.
- Ingestion Service uses local object storage mode from the dev compose stack.
- Qdrant collection `akl_document_chunks` uses `bge-m3` embeddings with vector size `1024` and distance `Cosine`.

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

Import the full docs folder:

```bash
python3 tools/import_docs_folder.py \
  --source ./docs \
  --manifest docs/import-manifest.yaml \
  --mode reindex \
  --report reports/docs_import_report.json
```

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

## Modes

- `skip-existing`: if a Registry document with `metadata.source_path` already exists, leave it unchanged and count its latest Qdrant points when a version exists.
- `new-version`: if the document exists, create and publish a new version, then ingest it.
- `reindex`: if the document exists, reuse its latest version and run ingestion again. If it does not exist, create the document and first version.

The idempotency key is Registry document metadata field `source_path`. Repeated runs do not create duplicate Document rows for the same Markdown path.

## Reports

The importer writes:

- JSON report: `reports/docs_import_report.json`
- Markdown report: `reports/docs_import_report.md`

The report contains found, imported, skipped, and failed document counts, total chunks, total Qdrant points, errors, and import timing.

## Smoke Test

```bash
python3 scripts/phase_03_docs_import_smoke.py
```

The smoke test imports a limited subset of `docs/`, verifies Qdrant points, and asks RAG:

```text
Jaká je architektura AKL platformy?
```

The answer must include citations.

## Document Viewer Smoke Test

After source-context support is enabled, run:

```bash
python3 scripts/phase_03_document_viewer_smoke.py
```

The test reindexes a small docs subset, asks a RAG question, opens the first citation through `GET /api/v1/citations/{chunk_id}/open`, and verifies that `source_file_uri`, `viewer_mode`, and `chunk_text` match the Qdrant payload.
