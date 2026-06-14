# AKB Operations

This document is the flat operational entry point for AKB. Detailed deployment
and runbook material remains in `docs/deployment/`, `docs/OPERATIONS/`, and
service README files.

## Local Development

Create local configuration:

```bash
cp .env.example .env
```

Start the full local stack:

```bash
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml --profile ai up -d --build
```

Pull required local AI models through LLM Gateway:

```bash
curl -sS http://localhost:8083/api/v1/models/pull \
  -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3","kind":"embedding"}'

curl -sS http://localhost:8083/api/v1/models/pull \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemma4:12b","kind":"chat"}'
```

## Production-Like Local Stack

```bash
cp .env.local-prod.example .env.local-prod
docker compose --env-file .env.local-prod \
  -f infra/docker-compose/docker-compose.dev.yml \
  -f infra/docker-compose/docker-compose.local-prod.yml \
  up -d --build
```

## Production Host

The supported production host name is:

```text
docker.home.cz
```

Before changing production, verify current state non-destructively:

```text
git HEAD
docker compose ps
service /health
public /akb/api/health
narrow assistant/source smoke
```

Do not manipulate VPN, VLAN, firewall, or network segmentation from this repo.

## Configuration

Configuration starts from `.env.example`. Values are namespaced with `AKL_*`
for compatibility. Production values belong outside Git, for example in
`/srv/akl/env/akl.prod.env` on `docker.home.cz`.

When configuration changes, update `.env.example`, this document, and the
specific deployment document.

## Health And Readiness

Backend services expose:

```text
GET /health
GET /ready
```

The web frontend exposes:

```text
GET /api/health
GET /api/ready
```

Production base-path deployment publishes these under `/akb/api/...`.

## Backup And Restore

Back up:

- PostgreSQL databases,
- object storage document sources,
- Qdrant collections or snapshots,
- Keycloak configuration,
- evaluation datasets and reports,
- production configuration outside Git.

Local production backup helpers:

```bash
scripts/backup_local_prod.sh
RESTORE_CONFIRM=restore-akl scripts/restore_local_prod.sh backups/local-prod/<backup-directory>
```

## Document Corpus Reset

For pre-pilot document reloads, prepare the public PDF corpus first and then reset/import only the document corpus:

```bash
python3 tools/prepare_public_pdf_corpus.py --download --clean --target-count 150 --max-pages 900
python3 tools/reset_pdf_first_corpus.py --domain public-digitalization-corpus --apply --confirm reset-documents
```

The workflow keeps user profiles, roles, Keycloak, observability and STRATOS application data intact. Details:
`docs/OPERATIONS/reset-pdf-first-corpus.md`.

## Validation Commands

Smallest relevant checks first:

```bash
bash scripts/validate-skeleton.sh
ruby scripts/generate_openapi_index.rb --check
python3 -m json.tool openapi/openapi.json >/dev/null
```

Application smoke checks are listed in `README.md`.

Detailed references:

- `docs/deployment/local-dev.md`
- `docs/deployment/local-production.md`
- `docs/deployment/docker-home-cz.md`
- `docs/OPERATIONS/07_DEPLOYMENT_MODEL.md`
- `docs/OPERATIONS/backup-restore.md`
- `docs/OPERATIONS/reset-pdf-first-corpus.md`
