# Phase 03 Local Production

Phase 03 turns the Phase 02 Controlled Document MVP into a locally useful knowledge base by importing AKB project documentation from `docs/`.

## Scope

- Bulk import Markdown files from `docs/`.
- Create Registry Documents and DocumentVersions with `document_type=project_documentation`.
- Seed source files into the Ingestion Service local object storage.
- Run ingestion and index chunks into Qdrant.
- Verify Qdrant points per `document_version_id`.
- Query RAG over imported project documentation and require citations.
- Open a RAG citation through `source-context` and show the exact cited chunk.
- Run the local production profile through `.env.local-prod` and compose override.
- Verify Employee Chat Portal route `/chat` and legacy `/assistant` redirect.

## Commands

Start from the Phase 02 real local RAG profile:

```bash
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml config
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml up -d --build
```

Do not run `phase_01_smoke.py`, `phase_02_controlled_document_smoke.py`, or the
host Markdown/PDF importers against this production/OIDC-shaped profile. They
fail before mutation in every environment, even when a bearer is supplied.
Create and ingest documents through the governed AKB application UI/API. Host
tools remain available only for explicit dry-run inventory.

Run the Phase 03 smoke:

```bash
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
- Report `opensearch_documents` is greater than `0` when `AKL_PHASE_03_REQUIRE_OPENSEARCH=true`.
- Qdrant contains payloads with:
  - `document_type=project_documentation`
  - `tags` including `akb-docs`
  - `document_version_id` matching imported Registry versions
- OpenSearch contains matching `project_documentation` chunks with the `akb-docs` tag.
- RAG answers the configured smoke query with at least one citation.
- `GET /api/v1/citations/{chunk_id}/open` returns `source_file_uri`, `viewer_mode`, and `chunk_text`.
- `GET /chat` renders the Employee Chat Portal UI.
- `GET /assistant` redirects to `/chat`.
- `POST /api/v1/assistant/chat` returns either clarification or a cited answer, depending on question specificity.

## Operational Notes

Legacy importer modes may be used only together with `--dry-run` for planning.
Normal refreshes, new versions, and reindex operations use the governed
application UI/API.

The import uses `metadata.source_path` as the idempotency key. The source URI is stable under `s3://akl-documents/docs-import/...` and maps to the dev compose local object storage under the Ingestion Service container.

If source-context returns `SOURCE_FILE_URI_MISSING`, reindex the document. Older Qdrant points created before the viewer metadata change do not contain source file metadata.
