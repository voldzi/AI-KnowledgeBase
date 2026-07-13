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
  -d '{"model":"gemma4:12b-mlx","kind":"chat"}'
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

Production Registry governance requires all four STRATOS endpoints for current
access projection, registered bindings, runtime decisions, and governed
information resources. Configure the last one with
`AKL_STRATOS_INFORMATION_RESOURCES_URL`; keep
`AKL_STRATOS_POLICY_SERVICE_TOKEN` only in the external production environment.
Do not log either the token or delegated user credentials. A missing endpoint,
service credential, or delegated actor fails governed writes closed.

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

## AIIP Application API

Provision `aiip-service` in the STRATOS Keycloak realm only after both public
AIIP operations are deployed. Assign only `service_aiip`, add audience
`akb-api`, keep the generated secret outside Git with mode `0600`, and do not
print the secret or access token in deployment logs.

Provision the internal RAG-to-Registry credential with the same idempotent
helper before restarting RAG:

```bash
AIIP_CLIENT_ID=akb-rag-service \
AIIP_ROLE=service_rag \
AIIP_AUDIENCE=akl-api \
AIIP_SECRET_FILE=/srv/akl/env/akb-rag-service.client-secret \
SERVICE_CLIENT_NAME='AKB RAG to Registry' \
./scripts/ensure_aiip_service_client.sh
```

The RAG container mounts this file read-only and exchanges it for short-lived
Registry tokens. It does not receive the `aiip-service` secret.

After deployment, verify a synthetic `internal` harmonization, an authorized
tenant-scoped duplicate search, exact idempotent replay, a conflicting replay,
and `restricted` rejection. Existing AIIP documents require reingestion so the
new tenant/source identity fields reach Qdrant and OpenSearch. Detailed
contract and acceptance behavior is in
`docs/integration/AKB_AIIP_APPLICATION_API.md`.

## Backup And Restore

Back up:

- PostgreSQL databases,
- object storage document sources,
- Qdrant collections or snapshots,
- OpenSearch fulltext indexes,
- Keycloak configuration,
- evaluation datasets and reports,
- production configuration outside Git.

Local production backup helpers:

```bash
scripts/backup_local_prod.sh
RESTORE_CONFIRM=restore-akl scripts/restore_local_prod.sh backups/local-prod/<backup-directory>
```

## Document Corpus Reset

The coordinated new-epoch full reset is a separate gated operation documented
in `docs/OPERATIONS/akb-epoch-reset.md`. Its command is dry-run by default and
requires an exact confirmation plus verified isolated-restore manifest for
apply. Do not use it before G4, two G5 rehearsals, G6 restore, and G7 approval.

For pre-pilot document reloads, prepare the public PDF corpus first and then reset/import only the document corpus:

```bash
python3 tools/prepare_public_pdf_corpus.py --download --clean --target-count 150 --max-pages 900
python3 tools/reset_pdf_first_corpus.py --domain public-digitalization-corpus --apply --confirm reset-documents
```

The workflow keeps user profiles, roles, Keycloak, observability and STRATOS application data intact. Details:
`docs/OPERATIONS/reset-pdf-first-corpus.md`.

## Document Readiness Check

Before pilot acceptance or after a corpus import, run the Registry readiness
aggregate from an authorized context:

```bash
curl -H "Authorization: Bearer <token>" \
  "https://<akb-host>/registry/api/v1/documents/readiness-report?max_issues=100"
```

The report is permission-scoped and uses metadata only. Treat
`blocked_documents > 0` as a release blocker for the reviewed corpus segment and
use `issue_counts` to prioritize missing gestor/access policy/source version,
validity/source-hash, duplicate-source, ingestion, and OCR quality remediation.

## Retrieval Quality Gate

Use the Intelligence submenu `Kvalita vyhledávání` to create a private silver
baseline from Registry-visible documents and run the first retrieval benchmark.
Evaluation datasets and reports are persisted in the `evaluation-datasets` and
`evaluation-reports` volumes. Back up both volumes before destructive retrieval
or corpus changes. Detailed thresholds, maturity rules and acceptance flow are
in `docs/evaluation/retrieval-quality-lab.md`.

## OKF Knowledge Bundles

STRATOS application repositories may provide Open Knowledge Format bundles as
Markdown files with YAML frontmatter. Validate and plan them before importing:

```bash
python3 tools/okf_profile.py validate --source ./okf --report reports/okf_validate_report.json
python3 tools/okf_profile.py plan-import --source ./okf --report reports/okf_import_plan.json
```

Import OKF concepts through the existing Markdown importer with the STRATOS OKF
metadata profile enabled:

```bash
python3 tools/import_docs_folder.py \
  --source ./okf \
  --manifest docs/import-manifest.yaml \
  --mode reindex \
  --okf-profile \
  --report reports/okf_import_report.json
```

Profile details: `docs/integration/STRATOS_OKF_PROFILE.md`.

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
- `docs/OPERATIONS/akb-epoch-reset.md`
