# Reset PDF-first Document Corpus

Validated: 2026-06-14.

This runbook resets only the AKB document corpus and imports available original PDFs as the primary controlled source.
It is intended for development or pre-pilot environments where document data can be recreated from public sources.

It does not reset Keycloak, user profiles, role mappings, Grafana, observability data, or STRATOS application data.

## Why This Exists

`tools/import_original_pdf_versions.py` was designed to upgrade existing
Markdown-backed documents to PDF-backed versions. Its host-side `--apply` is
retired in every environment; authenticated imports use the governed
application UI/API. Host mutation is retired in every environment. The legacy
design would not be enough for a clean start anyway, because after deleting
documents there are no Markdown documents to upgrade.

`tools/prepare_public_pdf_corpus.py` discovers and downloads a curated public PDF corpus into the AKB import workspace.
`tools/reset_pdf_first_corpus.py` then creates new documents directly from those PDF sources when a matching raw PDF exists.
Markdown derivatives are used only as import metadata and text-source provenance.

## StrategicViewer Scope

StrategicViewer keeps a useful public digitalization catalog of roughly 150 records. That catalog is a scope reference,
not a ready PDF corpus:

- it contains laws, decrees, strategies, methodologies, systems, services, NPO projects, audits, and web landing pages,
- many records are HTML pages or project/service catalog entries, not official PDF documents,
- AKB should import official PDFs where they exist and separately report records that need PDF acquisition or an approved
  PDF snapshot policy.

Previous AKB import workspace status on `docker.home.cz` before the public PDF expansion:

- 20 matching raw PDFs are available under `/srv/akl/imports/*/raw`,
- 3 Markdown derivatives still have no same-stem raw PDF,
- the next corpus expansion should use StrategicViewer as the candidate list, then resolve each candidate to an official
  PDF or mark it as non-PDF backlog.

The expanded workflow targets about 150 public PDF sources from official domains such as DIA, NÚKIB, NKÚ, MPO,
archi.gov.cz, data.gov.cz, Digital Strategy EU, and related government endpoints. The preparation step validates each
selected item by downloading it and checking that the response is a PDF.

## Prepare Public PDF Corpus

Dry-run:

```bash
python3 tools/prepare_public_pdf_corpus.py \
  --target-count 150 \
  --max-pages 900 \
  --report reports/public_pdf_corpus_prepare_report.dry-run.json
```

Download into the production import workspace:

```bash
python3 tools/prepare_public_pdf_corpus.py \
  --download \
  --clean \
  --target-count 150 \
  --max-pages 900 \
  --imports-root /srv/akl/imports \
  --domain public-digitalization-corpus \
  --report reports/public_pdf_corpus_prepare_report.json
```

The tool can optionally read the StrategicViewer public digitalization seed file when it exists locally. If the file is
not present, the built-in curated official seed URLs are sufficient for the 150-PDF baseline.

Output layout:

- `/srv/akl/imports/public-digitalization-corpus/raw/*.pdf`
- `/srv/akl/imports/public-digitalization-corpus/source/<group>/*.md`

Each Markdown file contains title, classification, language, canonical URL, source PDF URL, SHA-256 and import
provenance. It is not the primary user-facing document; the PDF is.

Document titles must remain user-facing Czech titles. The preparation and reset tools therefore prefer, in order of
quality, explicit metadata title, catalog title, PDF metadata, first plausible PDF heading, source PDF URL title, and only
then the slug-like filename stem. Slug-derived ASCII titles are treated as a last-resort fallback because they can lose
Czech diacritics.

## Reset Tool

Dry-run is the default:

```bash
python3 tools/reset_pdf_first_corpus.py \
  --domain public-digitalization-corpus \
  --report reports/pdf_first_corpus_reset_report.dry-run.json
```

Apply requires explicit confirmation:

```bash
python3 tools/reset_pdf_first_corpus.py \
  --domain public-digitalization-corpus \
  --apply \
  --confirm reset-documents \
  --report reports/pdf_first_corpus_reset_report.json
```

Default production inputs for the reset tool:

- imports root: `/srv/akl/imports`
- object storage root: `/srv/seaweedfs/akl`
- bucket: `akl-documents`
- default domains: `cz-digital-governance`, `security-compliance-cz`
- expanded public corpus domain: `public-digitalization-corpus`
- compose file: `infra/docker-compose/docker-compose.docker-home.yml`
- env file: `/srv/akl/env/akl.prod.env`

By default the tool skips Markdown derivatives without a matching PDF and reports them under "Missing PDF Sources".
Use `--include-markdown-fallback` only when a temporary Markdown-backed document is explicitly acceptable.

## Repair Existing Titles

If a previous import stored slug-derived titles such as `Prvodce ... vyhlky ... bezpenosti`, repair only document
metadata and titles without touching binaries, versions, chunks, embeddings, or Qdrant:

```bash
python3 tools/repair_pdf_first_titles.py \
  --domain public-digitalization-corpus \
  --report reports/pdf_first_title_repair_report.dry-run.json
```

Apply requires explicit confirmation:

```bash
python3 tools/repair_pdf_first_titles.py \
  --domain public-digitalization-corpus \
  --apply \
  --confirm repair-titles \
  --report reports/pdf_first_title_repair_report.json
```

The repair script matches Registry documents by PDF-first metadata (`domain` and `source_path`), stores the previous
title in `metadata.original_import_title`, records the title source, and writes a `document.title_repaired` audit event.

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

Use StrategicViewer as a candidate catalog where available, then run the resolver step:

1. export StrategicViewer corpus records with title, owner, section, URL, category, and keywords,
2. resolve official PDFs from DIA, NÚKIB, NKÚ, MPO, archi.gov.cz, data.gov.cz, Digital Strategy EU and related sources,
3. download PDFs into `/srv/akl/imports/public-digitalization-corpus/raw`,
4. keep Markdown derivatives only as extraction/provenance helpers,
5. rerun this PDF-first reset/import for `--domain public-digitalization-corpus`,
6. keep the preparation and reset reports as operational evidence.

Do not silently generate PDF snapshots for HTML pages. If snapshots are accepted, mark them as `source_kind=pdf_snapshot`
and keep the canonical URL in metadata so users can distinguish official PDFs from generated convenience PDFs.
