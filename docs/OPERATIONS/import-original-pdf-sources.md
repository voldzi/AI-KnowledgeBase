# Import Original PDF Sources

Validated: 2026-06-11.

This runbook inventories documents imported from Markdown derivatives. The
host tool is dry-run-only in every environment; all mutations use the governed
AKB application UI/API.

## Current Production Finding

The 2026-06-11 production audit found:

- Registry: 23 documents and 35 versions.
- Current source objects: all 35 Registry versions point to present `.md` objects with matching SHA-256 hashes.
- Object storage: 23 stored document source files, all `.md`.
- Qdrant: 23 document ids and 23 version ids indexed from `text/markdown`.
- Import workspace: 20 matching raw PDFs are available under `/srv/akl/imports/*/raw`.
- Missing original PDFs: 3 Markdown sources do not have a same-stem PDF in raw import storage:
  - `cz-digital-governance/source/archi-klicove-zakony-egovernment.md`
  - `cz-digital-governance/source/archi-pokyn-ikovs.md`
  - `cz-digital-governance/source/nukib-legislativa-zkb.md`

The historical migration target is 20 current PDF source versions and 3
remaining Markdown source versions; it must not be applied with this host tool
in production.

## Tool

Use:

```bash
python3 tools/import_original_pdf_versions.py
```

The script is dry-run by default. It:

- scans `/srv/akl/imports/<domain>/source/**/*.md`,
- matches each Markdown source to `/srv/akl/imports/<domain>/raw/<same-stem>.pdf`,
- copies matching PDFs into the AKB document bucket,
- creates a draft Registry version for each PDF,
- starts Ingestion Service for the PDF source,
- publishes the new PDF version only after ingestion creates chunks,
- supersedes the previous valid Markdown version,
- records audit events,
- resolves Qdrant from the host side and removes points for superseded Markdown versions unless `--keep-superseded-qdrant` is set,
- writes JSON and Markdown reports.

Historical production inventory inputs used by dry-run:

- imports root: `/srv/akl/imports`
- object storage root: `/srv/seaweedfs/akl`
- bucket: `akl-documents`
- domains: `cz-digital-governance`, `security-compliance-cz`
- report: `reports/original_pdf_import_report.json`
- object-storage writer fallback: compose service `web` with mount `/data/object-storage`

## Prerequisites

- Run a backup or confirm a recent restore point per `docs/OPERATIONS/backup-restore.md`.
- Confirm production is healthy before applying data changes:

```bash
ssh docker.home.cz 'cd /srv/akl/repo && git rev-parse --short HEAD'
ssh docker.home.cz 'cd /srv/akl/repo && docker compose --env-file /srv/akl/env/akl.prod.env -f infra/docker-compose/docker-compose.docker-home.yml ps'
curl -fsS https://stratos.zeleznalady.cz/akb/api/health
```

- Do not print env files, tokens, database URLs, or service secrets.

## Dry Run

Run from the production checkout:

```bash
ssh docker.home.cz 'cd /srv/akl/repo && python3 tools/import_original_pdf_versions.py --report reports/original_pdf_import_report.dry-run.json'
```

Expected dry-run totals for the 2026-06-11 corpus:

- `planned_pdf_versions=20`
- `missing_pdf_sources=3`
- `copied_objects=0`
- `created_versions=0`
- `ingested_versions=0`

Review:

```bash
ssh docker.home.cz 'cd /srv/akl/repo && sed -n "1,120p" reports/original_pdf_import_report.dry-run.md'
```

## Apply Is Retired

Do not run `--apply` in any environment. The host tool fails before
object-storage, Registry, Ingestion, or Qdrant mutation regardless of
environment, auth mode, or bearer presence. Authenticated and local development
imports both enter through the governed AKB application UI/API, which enforces
the Registry-issued exact-version proof, `svc-akb-web-ingestion` transport,
bounded OBO, idempotency, and authoritative attempt/CAS contract.

The dry-run inventory remains supported because it does not mutate Registry,
object storage, Ingestion, or Qdrant. There is intentionally no production
`--apply` command in this runbook.

On `docker.home.cz`, Registry API runs in the app network and Qdrant runs in data/management networks. The script
therefore does not require Registry API to reach Qdrant directly; Qdrant point counts and superseded-point cleanup are
performed by the host-side script after Registry publication.

The object storage root is owned by the runtime storage user/group. If the SSH user cannot write a new object directly,
the script streams the PDF into the `web` service storage mount and sets readable object permissions.

If a PDF ingestion fails, that new version is archived and the old valid Markdown version remains current. Check report errors before retrying.

## Governed Import Verification

Verify:

- services remain healthy,
- report has zero errors,
- 20 PDF source versions were created and ingested,
- current valid/latest source distribution is 20 PDF and 3 Markdown,
- Qdrant contains points for the new PDF version ids,
- old superseded Markdown version points were removed unless explicitly retained,
- signed source open still redirects unauthenticated users to login and does not expose internal Docker hostnames.

For a separate governed production import performed through the application,
use Browser after deploy for an authenticated manual check when credentials are
available:

- open `/akb/chat`,
- ask a question that cites one imported PDF-backed document,
- open the citation,
- click the document action,
- confirm the original PDF opens on the cited page and the AKB native viewer still highlights the cited area when source-location metadata is present.
