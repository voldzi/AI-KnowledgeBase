# Reset PDF-first Document Corpus

Validated: 2026-06-14.

This runbook resets only the AKB document corpus and imports available original PDFs as the primary controlled source.
It is intended for development or pre-pilot environments where document data can be recreated from public sources.

It does not reset Keycloak, user profiles, role mappings, Grafana, observability data, or STRATOS application data.

## Why This Exists

`tools/import_original_pdf_versions.py` upgrades existing Markdown-backed documents to PDF-backed versions. That is not
enough for a clean start, because after deleting documents there are no Markdown documents to upgrade.

`tools/reset_pdf_first_corpus.py` creates new documents directly from PDF sources when a matching raw PDF exists. Markdown
derivatives are used only as import metadata and text-source provenance.

## StrategicViewer Scope

StrategicViewer keeps a useful public digitalization catalog of roughly 150 records. That catalog is a scope reference,
not a ready PDF corpus:

- it contains laws, decrees, strategies, methodologies, systems, services, NPO projects, audits, and web landing pages,
- many records are HTML pages or project/service catalog entries, not official PDF documents,
- AKB should import official PDFs where they exist and separately report records that need PDF acquisition or an approved
  PDF snapshot policy.

Current AKB import workspace status on `docker.home.cz`:

- 20 matching raw PDFs are available under `/srv/akl/imports/*/raw`,
- 3 Markdown derivatives still have no same-stem raw PDF,
- the next corpus expansion should use StrategicViewer as the candidate list, then resolve each candidate to an official
  PDF or mark it as non-PDF backlog.

## Tool

Dry-run is the default:

```bash
python3 tools/reset_pdf_first_corpus.py \
  --report reports/pdf_first_corpus_reset_report.dry-run.json
```

Apply requires explicit confirmation:

```bash
python3 tools/reset_pdf_first_corpus.py \
  --apply \
  --confirm reset-documents \
  --report reports/pdf_first_corpus_reset_report.json
```

Default production inputs:

- imports root: `/srv/akl/imports`
- object storage root: `/srv/seaweedfs/akl`
- bucket: `akl-documents`
- domains: `cz-digital-governance`, `security-compliance-cz`
- compose file: `infra/docker-compose/docker-compose.docker-home.yml`
- env file: `/srv/akl/env/akl.prod.env`

By default the tool skips Markdown derivatives without a matching PDF and reports them under "Missing PDF Sources".
Use `--include-markdown-fallback` only when a temporary Markdown-backed document is explicitly acceptable.

## Apply Behavior

The apply run:

1. deletes Registry document rows and document-related workflow tasks/audit events,
2. clears the AKB document object-storage bucket,
3. deletes the Qdrant document chunk collection so it is recreated cleanly,
4. clears ingestion job JSON files,
5. creates draft documents and draft versions with PDF source URIs,
6. runs AKB ingestion components for parsing, chunking, embedding, and Qdrant indexing,
7. publishes only versions whose ingestion produced chunks,
8. archives failed versions and records import audit events.

## Verification

After apply, verify:

```bash
ssh docker.home.cz 'cd /srv/akl/repo && sed -n "1,140p" reports/pdf_first_corpus_reset_report.md'
curl -fsS https://stratos.zeleznalady.cz/akb/api/health
```

Registry/Qdrant checks:

- Registry document count equals `published_documents` in the report.
- Current valid source distribution is PDF-only unless `--include-markdown-fallback` was used.
- Qdrant point count is greater than or equal to the report `chunks_created`.
- Opening a document from AKB uses the signed same-origin source endpoint and renders the PDF.

## Expansion To About 150 Documents

Use StrategicViewer as a candidate catalog, then add a resolver step:

1. export StrategicViewer corpus records with title, owner, section, URL, category, and keywords,
2. resolve each URL to an official PDF, preferably `e-sbirka.gov.cz`, DIA, NÚKIB, NKÚ, EU, or ministry sources,
3. download PDFs into `/srv/akl/imports/<domain>/raw`,
4. keep Markdown derivatives only as extraction/provenance helpers,
5. rerun this PDF-first reset/import,
6. keep a report of records that remain HTML-only or catalog-only.

Do not silently generate PDF snapshots for HTML pages. If snapshots are accepted, mark them as `source_kind=pdf_snapshot`
and keep the canonical URL in metadata so users can distinguish official PDFs from generated convenience PDFs.
