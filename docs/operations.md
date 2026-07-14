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
current release marker and full Git SHA
docker compose ps
service /health
public /akb/api/health
narrow assistant/source smoke
```

Do not manipulate VPN, VLAN, firewall, or network segmentation from this repo.
Production deploys use the immutable exact-SHA workflow in
`docs/OPERATIONS/immutable-docker-home-release.md`; `/srv/akl/repo` is not a
release source and must not be pulled, checked out, or switched during deploy.

## Configuration

Configuration starts from `.env.example`. Values are namespaced with `AKL_*`
for compatibility. Production values belong outside Git, for example in
`/srv/akl/env/akl.prod.env` on `docker.home.cz`.

When configuration changes, update `.env.example`, this document, and the
specific deployment document.

Production Registry governance requires STRATOS endpoints for current access
projection, registered bindings, runtime decisions, governed information
resources, information publications, and anonymous public decisions. Configure
the last three with `AKL_STRATOS_INFORMATION_RESOURCES_URL`,
`AKL_STRATOS_INFORMATION_PUBLICATIONS_URL`, and
`AKL_STRATOS_PUBLIC_DECISIONS_URL`; keep `AKB_POLICY_SERVICE_TOKEN` only in the
external production environment.
Do not log the token or user credentials. Static calls are authorized only as
the fixed `service:akb` identity; integration-envelope actors are stored only
as audit metadata. A missing endpoint or service credential fails governed
writes closed.

AIIP governed upload additionally requires
`AKL_STRATOS_AIIP_AKB_RESOURCES_URL` and
`AKB_AIIP_INGEST_SERVICE_TOKEN`. The latter is a separate central-call
credential and production start rejects it when it equals
`AKB_POLICY_SERVICE_TOKEN`. Allow only the exact route grant
`aiip-service=aiip-upload`; do not add `authz`, document administration, or a
wildcard route grant to that client. The AKB web bridge forwards the
`aiip-service` transport bearer and a separate current actor bearer; Registry
must receive both. Rotate the two static AKB tokens independently, update the
external secret store, restart Registry, and verify readiness plus one denied
missing-actor probe before accepting traffic. Never print either token in
shell output, logs, manifests, or test reports.

The downstream ingestion pipeline has a third, independent Keycloak boundary.
Provision `svc-ingestion` with role `service_ingestion`, audience `akl-api`, and
store its secret in `/srv/akl/env/svc-ingestion.client-secret` mode `0600`.
`ingestion-service` obtains short-lived tokens through
`AKL_INGESTION_REGISTRY_TOKEN_URL`; the secret file is mounted read-only only
into that container. Registry must trust the client with exactly
`authz|audit|documents-read|ingestion-status`. Do not add generic grants to
`aiip-service`, share either client secret, or use an inbound AIIP bearer as a
fallback. `/ready` must return HTTP `503` with Registry `not_ready` when this
identity cannot be obtained; rotate the secret and recreate only the ingestion
container before a bounded ingestion smoke.

Set the same independent, random value of at least 32 characters as
`AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN` in the Registry and web containers. It is
only a private resolver credential; it is never accepted as a STRATOS policy
credential and never appears in a public response or log. A missing/mismatched
value disables public source delivery. Public metadata and source responses
must remain `no-store`; operators verify revoke by observing an immediate 404
after the next fresh central decision.

### Forward-only governance migrations (`0015`–`0017`)

Treat `0015_document_publications` and `0016_public_audit_aggregation` as
forward-only production migrations. The second migration adds nullable
aggregation identity plus occurrence/last-seen fields to existing audit rows;
it does not rewrite or prune authenticated audit.
`0017_canonical_own_scope` adds the canonical owner coordinate to document and
version governance scopes. It backfills every existing `own` row from the
persisted document owner, clears its former generic scope id, and only then
enables the database shape constraint. This prevents an existing private row
from being reinterpreted as organization-wide content.
Use the environment-specific Compose command and backup procedure from the
deployment runbook; the sequence is mandatory:

1. Create and verify a current backup/restore point before changing the
   Registry database. On `docker.home.cz`, the immutable release workflow must
   first stop and verify quiescence of the Compose Registry writer, then
   produce a PostgreSQL custom dump under `/srv/akl/backups`, its SHA-256, a
   successful `pg_restore --list`, and a non-secret inventory containing the
   full current Alembic revision before Alembic is allowed to start. The
   general backup policy remains in
   `docs/OPERATIONS/backup-restore.md`.
2. Deploy full-Git-SHA image tags for only the affected Registry, RAG, and web
   services, then run `alembic upgrade head` in the target `registry-api`
   image. Confirm with `alembic current` that
   revision `0017_canonical_own_scope` (or a later approved head
   containing it) is active.
3. Require the Registry and web readiness endpoints to pass before public
   traffic is tested. The release must also prove exact image tag/ID and
   release/Compose labels. A failed readiness or identity check stops the
   rollout and leaves the applied-runtime SHA marked for forward-fix recovery.
4. Use a deliberately disposable, already approved public document version to
   smoke the anonymous metadata endpoint and source endpoint. Require HTTP
   `200`, `Cache-Control: no-store`, only the sanitized metadata allowlist, and
   source bytes matching the published length and SHA-256. The metadata call
   must not contain a storage URI or internal source descriptor.
   Also require a valid single Range to return `206` with the exact
   `Content-Range`/ETag and an unsatisfiable range to return `416`. Exercise
   configured `429` rate/concurrency behavior only in an isolated smoke or
   with temporarily lower non-production limits.
5. Revoke that same disposable publication through the authenticated
   publication endpoint with `{"status":"REVOKED","reason":"deployment
   smoke"}`. Require the response status to be `REVOKED`, then require fresh
   anonymous metadata and source requests to return `404`.
6. Never archive a document version or logically delete its document while a
   local publication is `DRAFT` or `PUBLISHED`. Registry returns `409
   publication_lifecycle_active` for both operations. Revoke through the
   authenticated publication endpoint first, verify the local state is
   `REVOKED`, and only then perform the archive or logical delete.

Do not use `alembic downgrade`, a database reset, or a corpus reset as a
rollback for this migration. `REVOKED` is terminal, so a smoke publication
must never be a live public version that operators expect to republish; use a
new immutable document version and a new approval for any later publication.
Configure `AKL_PUBLIC_RATE_*`, `AKL_PUBLIC_CONCURRENCY_*`,
`AKL_PUBLIC_LIMITER_MAX_KEYS`, the independent `AKL_REGISTRY_PUBLIC_*`
backstop, and the three `AKL_PUBLIC_AUDIT_*` settings from
the environment template. Keep `AKL_PUBLIC_TRUSTED_PROXY_HOPS=0` until every
ingress hop is proven to sanitize and append `X-Forwarded-For`; enabling a
wrong value weakens per-client fairness, while the mandatory global limits
still cap total work.
If deployment fails after images or a migration were applied, leave
`/srv/akl/current` unchanged and deploy a reviewed descendant SHA through the
forward-fix wrapper. Do not interpret the old symlink as permission to run old
code against the new schema.

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
- `docs/OPERATIONS/immutable-docker-home-release.md`
- `docs/OPERATIONS/reset-pdf-first-corpus.md`
- `docs/OPERATIONS/akb-epoch-reset.md`
