# AKB Operations

This document is the flat operational entry point for AKB. Detailed deployment
and runbook material remains in `docs/deployment/`, `docs/OPERATIONS/`, and
service README files.

Foreign-environment operators start with
`docs/deployment/external-environment-installation.md`,
`docs/OPERATIONS/external-environment-runbook.md` and
`docs/OPERATIONS/disaster-recovery.md`. These guides distinguish portable
requirements from the site-specific `docker.home.cz` immutable release.

## Server-side browser sessions

Production OIDC uses database-backed AKB sessions. Configure three separate
operator-owned files with mode `0600`:

```dotenv
AKL_WEB_SESSION_ENCRYPTION_KEY_SOURCE_FILE=/srv/akl/env/akb-web-session-encryption.key
AKL_CHAT_WEB_SESSION_ENCRYPTION_KEY_SOURCE_FILE=/srv/akl/env/akb-chat-session-encryption.key
AKL_WEB_SESSION_STORE_SECRET_SOURCE_FILE=/srv/akl/env/akb-web-session-store.secret
AKL_WEB_SESSION_ABSOLUTE_TTL_DAYS=90
AKL_WEB_SESSION_IDLE_TTL_DAYS=30
AKL_WEB_IDENTITY_VALIDATION_INTERVAL_MINUTES=15
```

Web and standalone Chat have different encryption keys. Only the internal
AKB session-store HMAC credential is shared with Registry; it is not a browser
session secret and is never shared with STRATOS. Values must be independent
random secrets of at least 32 bytes and must not be placed in Git, Compose,
logs or deployment reports. Provision the distinct Chat key before promoting
this release. Rotating a key and restarting its consumer invalidates sessions
that cannot be decrypted; plan a controlled re-login for that application.
Apply Alembic migration `0026_web_sessions` on installations missing it.

On `docker.home.cz`, the operator-owned source files are mounted read-only in
the web containers. Their root entrypoint copies each required session secret
to the private `/run/akl-secrets` tmpfs, sets ownership to the unprivileged
`nextjs` process and uses that runtime copy. Keep the source files at `0600`;
do not broaden host permissions for a container user.

The browser cookie contains only an opaque selector. Operators may inspect
session counts and revocation audit events, but must not export the encrypted
payload, selector hash or authentication material.

A first protected page entry without an AKB session starts one normal PKCE
redirect to the approved issuer. With an existing session, a silent central
check can replace a different prior browser identity. The short signed
synchronization marker is bound to the selector, expires after 30 seconds and
is not an authorization credential. Separate session-only attempt and signed-out markers prevent
automatic retries after an error or logout. A manual retry is required.

Persistence comes only from the verified central access-token policy, never
from an AKB checkbox. The configured 90-day / 30-day values are upper bounds;
the absolute deadline starts at `stratos_session_started_at`, not at entry
into AKB. Short sessions are limited to 24 hours absolute / 8 hours idle.
IAM must coordinate the Keycloak `stratos-session-policy-mapper` for both
browser clients before accepting persistent SSO. Missing policy does not
silently create a long-lived cookie.

See [central SSO and managed identity](security/managed-identity.md) for exact
configuration, the read-only preflight, the separate-browser acceptance
matrix and the remaining worker-identity gate for managed mode. This change
does not activate managed identity or change production IAM configuration.

## STRATOS content-security profile

AKB owns the central Document Intake malware boundary for all document
origins. Web uploads use ClamAV `INSTREAM` through the shared internal service
at `tcp://scan.home.cz:3310`. The scanner is operated for applications in the
server VLAN; it is not a Docker service, volume or public endpoint owned by
AKB. Registry independently verifies the signed clean attestation and
Ingestion verifies the Registry state before reading the object.

Production runs with `STRATOS_CONTENT_SECURITY_MODE=clamd` and
`STRATOS_CONTENT_SECURITY_REQUIRED=true`. Scanner errors and timeouts fail
closed: an unscanned binary cannot become an available document. A temporary
scanner outage therefore makes Document Intake unavailable rather than
silently accepting content.
The exact contract and promotion gates are in
`docs/integration/AKB_DOCUMENT_INTAKE_V1.md` and ADR 0010.

## Office rendition profile

Production enables `AKL_INGESTION_RENDITION_ENABLED=true`. Ingestion must report
`checks.renditions=ready` on `/ready`. Original storage is mounted read-only at
`/data/object-storage`; generated PDF display copies use the dedicated
`renditions` subtree of the existing ingestion work volume at
`/data/ingestion-jobs/renditions`. They do not share the original object
storage. A change of LibreOffice, fonts or rendering policy must increment
`AKL_INGESTION_RENDITION_ENGINE_REVISION`, which creates a new cache namespace.
The cache may be removed and rebuilt without changing Registry records,
document hashes, ingestion indexes or source citations.

### Controlled legacy rescan

Legacy files are scanned only by the Registry one-off command. It mounts the
object store read-only, streams one file at a time through the shared ClamAV and
writes only the verdict and an audit event. It never moves, deletes, reindexes
or republishes a document. Start with a dry run, then use bounded batches:

```sh
docker compose --env-file /srv/akl/env/akl.env -f infra/docker-compose/docker-compose.docker-home.yml \
  run --rm --no-deps registry-api python -m app.content_security_backfill --limit 25
docker compose --env-file /srv/akl/env/akl.env -f infra/docker-compose/docker-compose.docker-home.yml \
  run --rm --no-deps registry-api python -m app.content_security_backfill --apply --limit 25
```

`infected`, `scan_error` and `integrity_error` are fail-closed outcomes for
the batch. Investigate those records from their audit metadata; do not retry
errors automatically without an operator decision.

## Local Development

Create local configuration:

```bash
cp .env.example .env
```

Start the full local stack:

```bash
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml --profile ai up -d --build
```

Verify the bundled semantic registry without network access:

```bash
cd apps/web
pnpm semantic-registry:check
```

The controlled SSP refresh procedure is documented in
`docs/OPERATIONS/semantic-registry.md`. Do not synchronize SSP during web
startup or a production request.

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

### Dashboard read path

The operational dashboard renders an immediate loading state while its
permission-scoped server data is fetched. Independent Registry, audit and
authorization reads start concurrently. Workflow GETs do not materialize tasks
or escalate SLA priorities. Treat a sustained `listWorkflowTasks` latency above two seconds
as a Registry performance incident; do not hide it by weakening authorization
or omitting task visibility.

The personal `/tasks` workspace reads one page of the active tab (25 rows),
not every tab or the complete audit/ingestion history. Capability-based display
hints reuse the fresh access projection; task actions remain server-authorized.
Workflow reads have a 15-second web-to-Registry deadline. Invalid page envelopes,
duplicate rows or authorization-service failures must show an unavailable state,
never a misleading empty or complete queue. Registry filter requests have a
20-second browser deadline and ignore stale responses after another filter change.

Registry's `AKL_WORKFLOW_MAINTENANCE_ENABLED` defaults to `true`.
`AKL_WORKFLOW_MAINTENANCE_INTERVAL_SECONDS` defaults to 60 (range 15-3600).
The loop materializes derived document/governance/audit tasks and escalates
overdue work outside GET requests. A PostgreSQL transaction-level advisory lock
serializes cycles across replicas; a busy replica skips that cycle. Failed
cycles roll back and emit only `workflow_maintenance_failed`, without database
parameters. Successful cycles emit `workflow_maintenance_completed`. Monitor
these events and overdue queues; HTTP readiness alone is not proof that a cycle
succeeded. Disabling this loop pauses derived-task freshness and SLA escalation,
not explicit review submission or decisions.

Review submission and decisions use existing Registry transactions and audit
events. No SMTP setting, role grant or database migration is required. The
Registry loop above does not publish documents or grant rights. The task list
is the current notification surface. Future
outbox-backed e-mail and deadline-digest requirements are documented in
[the workflow runbook](ui/workflow-inbox.md). Do not enable a mail sender merely
by treating audit events as a delivery queue.

Production deploys use the immutable exact-SHA workflow in
`docs/OPERATIONS/immutable-docker-home-release.md`; `/srv/akl/repo` is not a
release source and must not be pulled, checked out, or switched during deploy.
If an existing immutable `current` predates
`AKL_IMMUTABLE_ORCHESTRATOR_CONTRACT=2`, its scripts are not used to roll out
the first hardened release. Follow the canonical runbook's target-side
`--transition-existing-current` procedure; it prepares an exact target from a
disposable checkout, then revalidates the old current and target before the
target orchestrator obtains the standard lock. After contract 2 is current,
ordinary releases resume through `/srv/akl/current/scripts/`.
The host does not need `psql`, `pg_dump`, or `pg_restore`. Registry release
database operations use the exact, already-local image configured by
`AKL_RELEASE_POSTGRES_TOOL_IMAGE`; mutable tags and implicit pulls fail closed.
The same exact image performs three writable-primary checks before build, three
more after build immediately before any Registry writer may be stopped, and
three more after backup immediately before migration. Every connection must
report `transaction_read_only=off` and `pg_is_in_recovery()=false` plus the
configured exact `current_database()`/`current_user`; read-only, recovery, or
wrong database/user fails closed at that boundary. Backup inventory records the observed
backend address/port when available. This is routing evidence, not a
privileged cluster-identity assertion.
Run the workflow from a clean shell without sourcing the production env. It
rejects ambient env-file key collisions and any ambient variable interpolated
by the exact target Compose file, including variables absent from the env file;
production env values containing `$` are forbidden. Preparation and first-host
bootstrap enforce the same rule. Release entry scripts disable xtrace before
reading configuration. Deploy creates one linked single-link mode-`0600` env
snapshot in a private mode-`0700` directory below `/srv/akl/env` and binds every
Compose/database/backup/verification step to its root/directory/file
device/inode/size/SHA-256 identity; changing the persistent env mid-attempt cannot
retarget migration. Normal exit removes and fsyncs the snapshot. A SIGKILL copy
blocks the next attempt until the exact stale-snapshot cleanup procedure is run.
Git replacement refs/config injection and
ambient Docker daemon routing are rejected; production Docker must be the
local default Unix socket.

## Internal CI

AKB uses internal Gitea as its primary Git source. The normal Gitea Actions
workflow is verification-only. A separate manually approved production
workflow can trigger the existing immutable host release through a
forced-command SSH identity after successful CI for the exact current `main`
SHA. Its setup and rollback are documented in
`docs/OPERATIONS/gitea-production-deploy.md`. Runner isolation and shadow-CI
evidence are in `docs/OPERATIONS/gitea-actions-shadow-ci.md`; digest pinning,
untrusted PR isolation, cache retention and monitoring are in
`docs/OPERATIONS/akb-gitea-ci-runner.md`.

## Configuration

Configuration starts from `.env.example`. Values are namespaced with `AKL_*`
for compatibility. Production values belong outside Git, for example in
`/srv/akl/env/akl.prod.env` on `docker.home.cz`.

When configuration changes, update `.env.example`, this document, and the
specific deployment document.

Document-grounded chat requests use
`AKL_WEB_RAG_ASSISTANT_TIMEOUT_MS` (default `45000`). When the bounded timeout
expires, the web bridge fails the turn explicitly instead of leaving the chat
indefinitely in a sending state. Live STRATOS tools retain their independent,
shorter Director Copilot timeout.

### Director Copilot activation

Director Copilot V2 is the only AKB federation path. The current release
candidate is pinned to wire contract `director-copilot-2`, revision `2.0.4`,
and may be promoted only with the matching STRATOS revision. It is enabled only
when all three governed sources and the dedicated service identity are
configured:

```text
AKL_DIRECTOR_COPILOT_ENABLED=false
AKL_DIRECTOR_COPILOT_V2_MANIFEST_CACHE_TTL_MS=300000
```

Set all three governed source URLs, token URL, exact client ID and host secret
path in the private production environment:

```text
AKL_DIRECTOR_COPILOT_ENABLED=true
AKL_DIRECTOR_COPILOT_TOKEN_URL=https://login.zeleznalady.cz/realms/stratos/protocol/openid-connect/token
AKL_DIRECTOR_COPILOT_CLIENT_ID=svc-akb-director-copilot
AKL_DIRECTOR_COPILOT_CLIENT_SECRET_FILE=/srv/akl/env/svc-akb-director-copilot.client-secret
AKL_DIRECTOR_COPILOT_BUDGET_BASE_URL=http://stratos-api:4000
AKL_DIRECTOR_COPILOT_PROJECTFLOW_BASE_URL=http://projectflow-api:4010
AKL_DIRECTOR_COPILOT_ARCHFLOW_BASE_URL=http://stratos-api:4000
```

V2 returns the user-visible live-data answer and writes
`assistant.director_copilot_v2_returned`. A live-source failure never falls
back to document RAG. The joint dialogue, negative authorization, history
reauthorization, audit and latency gates are recorded in
`docs/integration/DIRECTOR_COPILOT_V2_IMPLEMENTATION.md`.

A response rejected by the pinned V2 contract is not reported as a network
outage. AKB keeps the result fail-closed, records
`DIRECTOR_COPILOT_V2_SOURCE_CONTRACT_INVALID` with value-free validator
diagnostics, and tells the user that the source responded but could not be
safely verified. Suggestions for a known failing execution profile remain
disabled until that profile passes the shared production contract test again.

### Temporal controlled-document maintenance

The `/controlled-documentation` workspace is the operator surface for
effective-dated legal and internal-document packages. A gestor creates a draft
from exact governed document versions, adds attachments/forms, moves the
package to `approved`, reviews cited rule proposals and only then moves the
package to `valid`. Controlled extraction may read an exact unpublished source
with the gestor's `document.update` decision, but ordinary RAG remains limited
to published versions. A
schvalovatel may perform the same final publication action when their current
capability permits it; no separate technical-document role is required.

For `law` and `implementing_regulation`, AKB accepts only a verified e-Sbírka
source. The legal-package planner creates a draft for each published effective
source version, including historical intervals. A later source version does
not erase a non-overlapping historical version. This automation is limited to
preparing traceable evidence; a gestor still reviews and explicitly validates
rules before Budget or another application can consume them.

An overdue `review_due_on` produces
`SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE`. It does not automatically invalidate a
directive. A conflict warning or a detected higher-authority replacement must
create gestor review work before an application consumes the rule. The
procedure and public-procurement pilot are defined in
`docs/ARCHITECTURE/temporal-controlled-documentation.md`.

When AKB cannot read an immutable source version, the governed workflow keeps
running only with an explicit bounded warning such as
`SOURCE_TEXT_EXTRACTION_FAILED` or the applicable source-download reason.
It must not synthesize source-backed rule proposals from unavailable content,
and such a result is never consumer eligible for Budget or another application.
The gestor must repair or replace the source version before reviewing rules.

Before changing the mode to `active`, verify that
`svc-akb-director-copilot` can obtain five separate exact-audience tokens.
The additional audit route is:

```text
scope=director-copilot-akl-api
audience=akl-api
Registry route grant=audit
```

Do not activate V2 when this token is unavailable. The Registry audit is a
required completion gate, not a best-effort side effect.

The production Registry environment must include the matching narrow route
allowlist entry and route grant:

```text
trusted service client=svc-akb-director-copilot
svc-akb-director-copilot=audit
```

The production Compose mounts the host file named by
`AKL_DIRECTOR_COPILOT_CLIENT_SECRET_FILE` read-only into both web profiles and
the entrypoint copies it to a private in-container tmpfs before dropping
privileges. When enabled, immutable release preflight requires an absolute,
operator-owned, single-link regular file with exact mode `0600` before the
build boundary. The identity must be exactly `svc-akb-director-copilot`; never
reuse the actor, web-ingestion, RAG or broad AKB policy credential. Keep
the feature disabled if either source URL, token audience, current actor
projection or source PEP cannot be verified.

Each V2 source receives a separately requested service token with exactly one
target audience and the independent current actor bearer. Readiness validates
the runtime manifests against the pinned closed contract. Manifest drift blocks
the V2 live-data path fail-closed and must be remediated before it is enabled
again.

The embedding shadow manifest is validated independently with:

```text
python3 scripts/check_embedding_shadow_profiles.py
```

It does not start models or affect production answers.

Assistant conversation retention is enforced by Registry, not by the browser.
Production Compose enables the worker with these bounded settings:

```text
AKL_ASSISTANT_CONVERSATION_RETENTION_DAYS=180
AKL_ASSISTANT_PURGE_ENABLED=true
AKL_ASSISTANT_PURGE_INTERVAL_SECONDS=3600
AKL_ASSISTANT_PURGE_BATCH_SIZE=500
AKL_ASSISTANT_DELETION_AUDIT_RETENTION_DAYS=730
```

The first cycle runs immediately after Registry startup and then once per
configured interval. It deletes only rows whose `retention_until` has passed,
uses PostgreSQL row locks with `SKIP LOCKED`, cascades messages and shares in
the same transaction, and leaves a content-free audit tombstone. After a
database restore, start Registry with the worker enabled and verify the
`assistant_conversation_purge_completed` aggregate log plus the
`akb.assistant.conversations.deleted` metric before accepting chat traffic.
Disabling the worker is allowed only during the bounded database migration or
restore maintenance window.

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

The downstream ingestion pipeline has a third, independent Keycloak boundary.
Provision `svc-ingestion` with role `service_ingestion`, audience `akl-api`, and
store its secret in `/srv/akl/env/svc-ingestion.client-secret` mode `0600`.
`ingestion-service` obtains short-lived tokens through
`AKL_INGESTION_REGISTRY_TOKEN_URL`; the secret file is mounted read-only only
into that container. Registry must trust the client with exactly
`authz|audit|documents-read|ingestion-status`. Do not share either client
secret or use an inbound user bearer as a fallback. `/ready` must return HTTP
`503` with Registry `not_ready` when this
identity cannot be obtained; rotate the secret and recreate only the ingestion
container before a bounded ingestion smoke.

Interactive web-to-ingestion traffic has a fourth independent boundary.
Provision `svc-akb-web-ingestion` with role
`service_akb_web_ingestion`, audience `akl-api`, and store its secret at
`/srv/akl/env/svc-akb-web-ingestion.client-secret` mode `0600`. It receives no
Registry route grant. Web mounts the host file read-only and copies it into a
private tmpfs for the unprivileged runtime user. Registry separately requires
`/srv/akl/env/ingestion-authorization.secret`, owned by the release operator,
mode `0600`, with at least 32 random bytes. Never reuse either client secret as
the signing secret.

The immutable release preflights those two files, the existing
`svc-ingestion.client-secret`, and
`akb-rag-service.client-secret` before burning the SHA or building images.
First rollout selects Registry, Ingestion, RAG, Evaluation, Governance, web,
and standalone chat. The four confidential transport files listed above and
their corresponding environment keys must exist before the maintenance
window.

Set the same independent, random value of at least 32 characters as
`AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN` in the Registry and web containers. It is
only a private resolver credential; it is never accepted as a STRATOS policy
credential and never appears in a public response or log. A missing/mismatched
value disables public source delivery. Public metadata and source responses
must remain `no-store`; operators verify revoke by observing an immediate 404
after the next fresh central decision.

### Forward-only governance and chat migrations (`0015`–`0021`)

Treat `0015_document_publications` and `0016_public_audit_aggregation` as
forward-only production migrations. The second migration adds nullable
aggregation identity plus occurrence/last-seen fields to existing audit rows;
it does not rewrite or prune authenticated audit.
`0017_canonical_own_scope` adds the canonical owner coordinate to document and
version governance scopes. It backfills every existing `own` row from the
persisted document owner, clears its former generic scope id, and only then
enables the database shape constraint. This prevents an existing private row
from being reinterpreted as organization-wide content.
`0018_ingestion_attempts` creates one authoritative ingestion-attempt CAS row
per document, protected by a same-document composite version foreign key,
unique job id, and bounded status constraint. It backfills only unambiguous
current job/version/status values from external references. Partial, conflicting
or invalid legacy state aborts the migration for explicit reconciliation; the
migration never guesses a winner.
`0019_database_hardening` adds same-document foreign keys for the current
version/file projection, validated document state/date/size constraints,
version and ingestion lookup indexes, and the missing analyst workspace
tables. Ingestion startup additionally creates Qdrant keyword payload indexes
for document/version/type/classification/status/tags and policy coordinates.
`0020_assistant_authorship` adds verified display snapshots and server-derived
message authorship. `0021_assistant_retention`
assigns every legacy null-retention conversation a fresh 180-day grace period
from migration time and then makes the deadline mandatory. It intentionally
does not calculate from an old update timestamp, so the migration itself
cannot immediately purge historical rows.
Use the environment-specific Compose command and backup procedure from the
deployment runbook; the sequence is mandatory:

1. Create a current Registry dump artifact before changing the database. On
   `docker.home.cz`, the immutable release workflow must
   first stop and verify quiescence of the Compose Registry writer through
   lock-bound per-deployment evidence and repeated `docker ps -a` checks, then
   produce a PostgreSQL custom dump under `/srv/akl/backups`, its SHA-256, a
   successful `pg_restore --list`, and a non-secret inventory containing the
   exactly one full current Alembic revision, critical table row counts, plus
   exact tool image identity and client versions. The dump, list, checksum, inventory, directories, and parent are
   fsynced before Alembic is allowed to start. PostgreSQL clients run only
   from the pinned image with a private pgpass bind below
   `/srv/akl/state/postgres-credentials`. A SIGKILL remnant blocks a later
   release and is removed only by the exact validated cleanup procedure. The general
   exact isolated Registry rehearsal is in
   `docs/OPERATIONS/immutable-docker-home-release.md`. These checks
   establish checksum integrity and syntactic custom-dump/TOC readability, not
   a proven restore point; only the documented isolated restore rehearsal does
   that.
2. Deploy full-Git-SHA image tags for only the affected Registry, Ingestion,
   RAG, Evaluation, Governance, web, standalone chat, and internal LLM gateway
   services, then run
   `alembic upgrade head` in the target
   `registry-api` image. A shared production Compose change is accepted only
   when a structural comparison proves that it changes complete blocks of
   those eight services and leaves every unmanaged block and the top-level
   envelope byte-identical. Durably record each post-build image ID and verify exact
   SHA/project/service labels again before Alembic/restart, after recreation,
   and after all smoke tests immediately before activation. Reconciliation loads
   the original IDs from the deployment record named by the verified runtime
   marker; it never trusts a newly resolved mutable tag. Alembic and Compose
   recreation execute from the recorded image IDs directly, so a concurrent tag
   retarget cannot select different bytes. Require the target image to declare
   exactly one head and `alembic current` to return exactly one canonical
   revision equal to it (currently `0018_ingestion_attempts` or a later
   approved single head). Multi-head or malformed state fails closed.
3. Require Registry, Ingestion, RAG, Evaluation, Governance, web, and standalone
   chat health/readiness for every selected
   service before public traffic is tested. Ingestion `/ready` is authenticated;
   the release runs its exact in-container `svc-ingestion` probe and never
   treats an anonymous 401/403 as readiness. It also verifies the non-mutating
   exact web-transport route. The release must prove exact image tag/ID and
   release/Compose labels. A failed readiness or identity check stops the
   rollout, quarantines provable unverified target containers, and leaves the
   applied-runtime SHA marked for forward-fix recovery.
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
The pre-stop writable-primary gate precedes target build and may retry the same
approved SHA. Immediately before build, the workflow durably creates
`/srv/akl/state/burned-shas/<full-sha>`; a pre-existing target tag also creates
it. Once this marker exists or `target_build_may_have_started=true`, retain
immutable tags and deploy a reviewed descendant even when no tag exists and
`migration_started=false`. Never delete a burn marker to force a retry. A
pre-quiesce gate failure is still before writer stop but already post-build and
therefore requires a descendant.
If a crash occurs while stopping the Registry writer, treat a durable
`registry_stop_may_have_started=true` deployment record as evidence that the
writer may be stopped even when verified quiescence was not yet recorded. If
the marker is already fully `verified` for the target but `current` is still
old, rerun that same SHA to re-verify and reconcile activation without a build
or migration. If `current` already names the same fully verified target but the
success record is missing, the same no-forward-fix retry records
`reconciled_verified_success` without changing the link again; a rollback
wrapper is not a reconciliation shortcut.

## Health And Readiness

Backend services expose:

```text
GET /health
GET /ready
```

The web frontend exposes:

```text
GET /health
GET /ready
GET /api/health
GET /api/ready
```

Production base-path deployment publishes the API variants under
`/akb/api/...`. The standalone chat profile explicitly allows the root
`/health` and `/ready` probes on `chat.zeleznalady.cz`; both responses are
uncached and do not require an interactive OIDC session.

## RAG Registry Service Identity

Provision `akb-rag-service` in the STRATOS Keycloak realm with only the
`service_rag` role and `akl-api` audience. Keep the generated secret outside
Git in a mode-`0600` host file. The RAG container mounts that file read-only
and exchanges it for short-lived Registry tokens. Never print the secret or
access token in deployment logs.

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

Create a dry-run OKF import inventory with the STRATOS OKF metadata profile:

```bash
python3 tools/import_docs_folder.py \
  --source ./okf \
  --manifest docs/import-manifest.yaml \
  --mode skip-existing \
  --okf-profile \
  --dry-run \
  --report reports/okf_import_report.json
```

Host importer mutation is retired in every profile and fails before writes.
Actual OKF imports use the governed application UI/API.

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
# Central document storage

Production storage configuration, migration, verification, rollback, and
credential handling are defined in
[Central S3 Object Storage](OPERATIONS/central-s3-object-storage.md).
