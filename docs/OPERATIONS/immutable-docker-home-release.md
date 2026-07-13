# Immutable Releases On `docker.home.cz`

This is the production release and recovery procedure for the AKB Registry,
RAG retrieval service, and web application. It deliberately does not deploy
from the mutable `/srv/akl/repo` working tree.

## Safety Invariants

- Every release is a full, lowercase 40-character Git commit SHA reachable
  from the configured protected `origin/main` ref.
- Runtime source is extracted from the bare Git mirror into
  `/srv/akl/releases/<full-sha>`. The extracted Git tree is verified against
  the commit and made read-only.
- `/srv/akl/env/akl.prod.env` and `/srv/akl/backups` are persistent and are
  never placed in a release directory.
- On the first immutable transition, the existing dirty
  `/srv/akl/repo` checkout is neither built, changed, nor selected as runtime
  source. The workflow captures the running legacy Compose Registry
  predecessor's exact container ID, image reference/ID, project/service,
  one-off flag, config hash, and config-file label before quiescing it.
- Every Compose call has an explicit project name, `--env-file`, and compose
  file from the target release. Deployment never runs `git pull`, `git
  checkout`, or `git switch` in `/srv/akl/repo`.
- Images use the full Git SHA as their unique tag; an existing target tag is
  never overwritten. Verification resolves that tag to its image ID and
  requires the running container to use the same tag, image ID, release-SHA
  label, Compose project, service, config file, and config hash. Only changed
  `registry-api`, `rag-retrieval-service`, and `web` services are built and
  recreated. A release touching another runtime service fails closed.
- Before any Registry database read for the release backup, the workflow
  identifies and stops the sole Compose `registry-api` database writer and
  proves that no project Registry writer remains running. It then creates a
  PostgreSQL custom-format dump, verifies its SHA-256, validates it with
  `pg_restore --list`, and writes a non-secret inventory containing the full
  Alembic revision such as `0016_public_audit_aggregation`.
- Registry migrations are forward-only. Recovery deploys a reviewed
  descendant commit; it does not downgrade Alembic, reset a database, restore
  in place, or delete a Docker volume.
- `/srv/akl/state/applied-runtime.env` is an atomic, mode-`0600` watermark of
  the latest SHA whose migration or runtime start may have been attempted. It
  is written before `alembic upgrade` and before affected services start. If
  it differs from the verified `/srv/akl/current`, ordinary deployment is
  blocked and only a descendant forward-fix from that exact SHA is accepted.
- `/srv/akl/current` advances atomically only after the affected containers are
  running and internal and public health/readiness/smoke checks pass.

## Persistent Host Layout

```text
/srv/akl/
  git/AI-KnowledgeBase.git/       # bare mirror; no working tree
  releases/<full-sha>/            # verified, read-only Git archives
  current -> releases/<full-sha>  # last fully verified release
  env/akl.prod.env                # mode 0600, never committed
  state/applied-runtime.env       # mode 0600, latest possibly applied SHA
  backups/registry-*/             # dump, checksum, restore list, inventory
  deployments/*.txt               # non-secret attempt records
  repo/                            # optional legacy/maintenance checkout only
```

Do not place mutable data, secrets, backups, or logs below `releases/`.

## One-Time Host Preparation

Install Bash, Git, Docker Compose, Python 3, curl, tar, `sha256sum`, and
PostgreSQL client tools (`psql`, `pg_dump`, and `pg_restore`). Then create the
persistent directories and private environment file:

```bash
sudo install -d -m 0700 \
  /srv/akl/env \
  /srv/akl/backups \
  /srv/akl/deployments \
  /srv/akl/git \
  /srv/akl/releases \
  /srv/akl/state
sudo install -m 0600 \
  infra/docker-compose/docker-home.env.example \
  /srv/akl/env/akl.prod.env
```

Replace every placeholder in the copied file through the approved secret
handling path. Do not print the completed file. At minimum, keep these release
controls explicit:

```dotenv
AKL_RELEASE_GIT_URL=https://github.com/voldzi/AI-KnowledgeBase.git
AKL_RELEASE_TRUSTED_REF=refs/remotes/origin/main
AKL_RELEASE_COMPOSE_PROJECT=akl
AKL_RELEASE_EXPECTED_REGISTRY_DB_HOST=haproxy.home.cz
AKL_RELEASE_EXPECTED_REGISTRY_DB_PORT=5000
```

`AKL_RELEASE_REGISTRY_STOP_TIMEOUT_SECONDS` is an optional safety tuning value
between 1 and 300 seconds; the default is `30`.

The environment path must be a regular file, not a symlink, and it must not be
group- or world-readable. The workflow rejects placeholder values and unsafe
permissions before preparing or changing runtime state.

For the first transition from the legacy checkout, first prove the workflow
scripts themselves are unmodified in that checkout; do not update that
checkout during the change window:

```bash
test -z "$(git -C /srv/akl/repo status --porcelain -- \
  scripts/backup_registry_release.sh \
  scripts/deploy_docker_home.sh \
  scripts/deploy_docker_home_release.sh \
  scripts/lib/immutable_release_common.sh \
  scripts/prepare_docker_home_release.sh \
  scripts/rollback_docker_home_release.sh \
  scripts/verify_docker_home_release.sh)"
```

Use `/srv/akl/repo/scripts/deploy_docker_home.sh` only for that controlled
first transition. After the first successful immutable release, always invoke
the tooling through `/srv/akl/current/scripts/`. The compatibility entry point
must never update, clean, reset, or build from `/srv/akl/repo`; all release
source still comes from the verified exact-SHA archive below
`/srv/akl/releases`.

## Pre-Deployment Gate

1. Select the exact full SHA after its protected-branch CI and review are
   complete. Do not deploy a branch name or mutable tag.
2. Verify production non-destructively: current symlink and SHA marker,
   `/srv/akl/state/applied-runtime.env`, deployment records, Compose service
   state, health/readiness, database/HAProxy reachability, free disk space
   under `/srv/akl`, and the last verified backup. `applied_sha` must equal the
   current SHA and `state` must be `verified` for an ordinary deployment.
3. Confirm the change contains only the supported Registry, RAG, or web runtime
   scope. Shared policy contracts are treated as Registry changes. Changes to
   another runtime service require a separately reviewed workflow extension.
4. Confirm no database reset, corpus reset, volume removal, Alembic downgrade,
   or network change is included in the change window.

Useful read-only checks:

```bash
readlink -f /srv/akl/current
cat /srv/akl/current/.akl-release-sha
sed -n '1,8p' /srv/akl/state/applied-runtime.env
docker compose \
  --project-name akl \
  --env-file /srv/akl/env/akl.prod.env \
  -f /srv/akl/current/infra/docker-compose/docker-compose.docker-home.yml \
  ps
curl -fsS https://stratos.zeleznalady.cz/akb/api/health
curl -fsS https://stratos.zeleznalady.cz/akb/api/ready
```

## Deploy An Exact SHA

Set `RELEASE_SHA` to the approved full SHA and invoke the script from the last
verified release:

```bash
RELEASE_SHA=0123456789abcdef0123456789abcdef01234567
/srv/akl/current/scripts/deploy_docker_home_release.sh --sha "$RELEASE_SHA"
```

The script, in order:

1. obtains an exclusive host deployment lock;
2. fetches into the bare mirror and verifies exact SHA ancestry;
3. extracts and verifies the read-only release directory;
4. determines the affected Registry/RAG/web services from the Git diff;
5. renders Compose and builds only those services with full-SHA image tags;
6. when Registry is affected, captures the exact old project container and
   image ID, stops the Registry writer with the configured timeout, verifies
   quiescence, creates the verified backup, records the target SHA in the
   applied-runtime watermark, and only then runs `alembic upgrade head` and
   confirms the one full expected Alembic head;
7. recreates only affected services with `--no-deps`;
8. checks the exact image tag/ID, image and container release labels, Compose
   ownership/config labels, running state, and exact release version for every affected service,
   plus public health/readiness and a fail-closed anonymous request for a
   guaranteed-missing public slug (an unaffected web keeps its prior image
   SHA); the missing-slug response must be the structured AKB JSON contract
   with `Cache-Control: no-store`, not a generic proxy 404;
9. atomically changes `/srv/akl/current` and records success.

For a Registry release, inspect the generated backup without printing secrets:

```bash
BACKUP_DIR=/srv/akl/backups/registry-<utc>-<full-sha>
cd "$BACKUP_DIR"
sha256sum --check registry.dump.sha256
pg_restore --list registry.dump >/dev/null
sed -n '1,40p' inventory.txt
```

Keep the dump, checksum, restore list, and inventory together. Their creation
does not authorize an in-place restore.

## Failed Verification And Forward-Fix Recovery

On any failure, the script leaves `/srv/akl/current` unchanged and writes a
failed record below `/srv/akl/deployments`. If the applied-runtime watermark
was already advanced, it remains on the target SHA with `state=failed` even
when readiness fails. Containers may already contain the failed image, and a
Registry migration may already be committed; therefore the old symlink is
evidence of the last verified release, not permission to start old code
against a newer schema.

The exact stopped old Registry container is restarted automatically only when
the failure occurs before the applied-runtime watermark is advanced (for
example, a failed dump). Once migration or runtime start is possible, the old
container is never restarted automatically. Do not edit or delete the
watermark to bypass recovery. This pre-apply restoration also applies to the
captured dirty-checkout predecessor during the first immutable transition;
the workflow restarts that exact container and verifies the captured image and
Compose identities rather than recreating it from `/srv/akl/repo`.

If a killed host process leaves `/srv/akl/.immutable-deploy.lock`, inspect its
`owner` file and prove that the recorded PID is absent and that no related
Compose, backup, or migration process is running before removing the stale
directory. Never remove the lock merely to bypass a live deployment.

Record the failed SHA and error/correlation identifiers. Prepare and review a
new commit that is a descendant of the failed commit, then run:

```bash
FAILED_SHA=0123456789abcdef0123456789abcdef01234567
FORWARD_FIX_SHA=89abcdef0123456789abcdef0123456789abcdef
/srv/akl/current/scripts/rollback_docker_home_release.sh \
  --failed-sha "$FAILED_SHA" \
  --forward-fix-sha "$FORWARD_FIX_SHA"
```

If the first immutable attempt advanced the runtime watermark but failed
before `/srv/akl/current` existed, invoke the same reviewed wrapper from the
failed exact-SHA release instead:

```bash
/srv/akl/releases/${FAILED_SHA}/scripts/rollback_docker_home_release.sh \
  --failed-sha "$FAILED_SHA" \
  --forward-fix-sha "$FORWARD_FIX_SHA"
```

The recovery wrapper requires `FAILED_SHA` to equal the applied-runtime
watermark, verifies that the fix descends from it, and uses the same backup, migration,
readiness, smoke, and atomic activation gates. It intentionally provides no
command for an old image rollback, Alembic downgrade, database reset, volume
deletion, or automatic restore. A destructive or point-in-time database
recovery is a separate reviewed incident procedure with an outage, ownership,
and restore validation plan.

## Local And CI Verification

The release scripts, their ShellCheck rules, and the isolated fake-runtime
workflow are checked with:

```bash
bash scripts/check_immutable_release_workflow.sh
```

This test never contacts production and does not run Docker containers. It
proves full Alembic revision handling, writer stop/backup/migration ordering,
safe pre-apply Registry restoration (including the dirty predecessor on the
first immutable rollout), persistent recovery after failed
readiness, rejection of ordinary and non-descendant recovery attempts, and
fail-closed image ID/label verification with temporary Git, database-client,
Compose, and HTTP fixtures.
