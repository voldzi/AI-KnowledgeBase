# Phase 03 Local Production

Phase 03 turns the Phase 02 Controlled Document MVP into a locally useful knowledge base by importing AKL project documentation from `docs/`.

## Scope

- Bulk import Markdown files from `docs/`.
- Create Registry Documents and DocumentVersions with `document_type=project_documentation`.
- Seed source files into the Ingestion Service local object storage.
- Run ingestion and index chunks into Qdrant.
- Verify Qdrant points per `document_version_id`.
- Query RAG over imported project documentation and require citations.
- Open a RAG citation through `source-context` and show the exact cited chunk.
- Run the local production profile through `.env.local-prod` and compose override.
- Verify Employee Assistant route `/assistant` for the Phase 04 dual GUI model.

## Commands

Start from the Phase 02 real local RAG profile:

```bash
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml config
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml up -d --build
```

Run the Phase 02 regression smoke:

```bash
python3 scripts/phase_02_controlled_document_smoke.py
```

Import project documentation:

```bash
python3 tools/import_docs_folder.py \
  --source ./docs \
  --manifest docs/import-manifest.yaml \
  --mode reindex \
  --report reports/docs_import_report.json
```

Run the Phase 03 smoke:

```bash
python3 scripts/phase_03_docs_import_smoke.py
python3 scripts/phase_03_document_viewer_smoke.py
python3 scripts/phase_03_local_production_smoke.py
python3 scripts/phase_04_employee_assistant_smoke.py
```

Run local production profile:

```bash
cp .env.local-prod.example .env.local-prod
docker compose --env-file .env.local-prod \
  -f infra/docker-compose/docker-compose.dev.yml \
  -f infra/docker-compose/docker-compose.local-prod.yml \
  up -d --build
```

## Expected State

- `reports/docs_import_report.json` and `reports/docs_import_report.md` exist.
- Report `failed_documents` is `0`.
- Report `chunks_created` is greater than `0`.
- Report `qdrant_points` is greater than `0`.
- Qdrant contains payloads with:
  - `document_type=project_documentation`
  - `tags` including `akl-docs`
  - `document_version_id` matching imported Registry versions
- RAG answers the architecture query with at least one citation.
- `GET /api/v1/citations/{chunk_id}/open` returns `source_file_uri`, `viewer_mode`, and `chunk_text`.
- `GET /assistant` renders the Employee Assistant UI.
- `POST /api/v1/assistant/chat` returns either clarification or a cited answer, depending on question specificity.

## Operational Notes

Use `--mode reindex` for normal local refreshes. It avoids duplicate Document rows and refreshes Qdrant points for the latest version. Use `--mode new-version` when a changed Markdown file should become a new Registry version. Use `--mode skip-existing` for one-time bootstrap runs that must not touch already imported files.

The import uses `metadata.source_path` as the idempotency key. The source URI is stable under `s3://akl-documents/docs-import/...` and maps to the dev compose local object storage under the Ingestion Service container.

If source-context returns `SOURCE_FILE_URI_MISSING`, reindex the document. Older Qdrant points created before the viewer metadata change do not contain source file metadata.
