# Immutable Releases On `docker.home.cz`

This is the production release and recovery procedure for the coordinated AKB
Registry, Ingestion, RAG retrieval, and web runtime. It deliberately does not
deploy from the mutable `/srv/akl/repo` working tree.

## Safety Invariants

- Every release is a full, lowercase 40-character Git commit SHA reachable
  from the configured protected `origin/main` ref.
- Git provenance runs with replacement objects disabled. Dangerous ambient
  `GIT_*` configuration is rejected and the bare mirror must contain no
  `refs/replace/*`; neither config injection nor a replacement commit may
  change the tree that is prepared or verified.
- Runtime source is extracted from the bare Git mirror into
  `/srv/akl/releases/<full-sha>`. The extracted Git tree is verified against
  the commit, recursively fsynced, made read-only, and published only after
  the release directory and its parent are durable.
- The root SHA marker and release manifest are provenance metadata, not Git
  tree exceptions with arbitrary content. Both must be single-link regular
  files (never symlinks or hardlinks). The marker contains exactly the target
  SHA; the manifest contains only the ordered `git_sha`, `trusted_ref`, and
  canonical UTC `prepared_utc` fields matching the active release contract.
- `/srv/akl/env/akl.prod.env` and `/srv/akl/backups` are persistent and are
  never placed in a release directory.
- On the first immutable transition, the existing dirty
  `/srv/akl/repo` checkout is neither built, changed, nor selected as runtime
  source. The workflow captures the running legacy Compose Registry
  predecessor's exact container ID, image reference/ID, project/service,
  one-off flag, config hash, and config-file label before quiescing it.
- An existing immutable `current` whose deploy script predates hardened
  orchestrator contract 2 is upgraded only through the explicit target-side
  `--transition-existing-current` bootstrap below. Neither `prepare` nor deploy
  is run from the old `current`. A disposable exact-target checkout prepares
  the target tree; the target deploy repeats every state-sensitive guard under
  the normal exclusive lock before build, writer stop, or migration.
- Every release entry script disables shell xtrace before reading configuration,
  so `bash -x` or inherited `SHELLOPTS=xtrace` cannot print database URLs or
  other env-file values. Every Compose call has an explicit project name,
  `--env-file`, and compose file from the target release. Deployment never runs
  `git pull`, `git checkout`, or `git switch` in `/srv/akl/repo`.
- Compose interpolation is fail-closed against shell precedence. Before any
  lock, build, writer stop, or migration, the workflow rejects every ambient
  variable whose key also exists in the production env file and every ambient
  variable referenced by the exact target Compose file, even when that key is
  absent from the env file. Bare, duplicate, and invalid env-file keys are also
  rejected, and env-file values containing `$` are forbidden so Compose cannot
  perform a second ambient interpolation pass. Preparation and first-host bootstrap apply the same target-Compose
  check. Do not `source` the production env. After validation, one randomized
  operator-owned mode-`0700` directory is created below `/srv/akl/env` and a
  linked, single-link mode-`0600` snapshot is created inside it with exclusive,
  no-follow semantics on the same filesystem. Its root/directory/file paths,
  ownership, modes, device/inode, size, and SHA-256 are retained in memory and
  rechecked by the orchestrator and child scripts before critical operations.
  Every Compose, database, backup, and verification call uses only that regular
  snapshot path, which Docker Compose can safely reopen; replacing the persistent
  env file during the attempt cannot reroute migration or runtime configuration.
  Normal exit verifies the identity again, unlinks the file, fsyncs and removes
  its private directory. SIGKILL can leave this private copy behind, so every new
  attempt fails closed on a matching stale directory until the exact recovery
  command below validates and removes that single snapshot after stale-lock
  investigation. Deployment passes
  only its computed full-SHA image/version controls to Compose; application
  configuration comes from the snapshot `--env-file` alone.
- Docker operations reject ambient daemon-routing variables, require the
  `default` context to resolve to `unix:///var/run/docker.sock`, and never pull
  a release tag during `compose run` or `compose up`. HTTP verification starts
  curl with `--disable`, so a user `.curlrc` cannot reroute or weaken the gate.
- Images use the full Git SHA as their unique tag; an existing target tag is
  never overwritten. Immediately after build, the workflow resolves every
  affected tag to its image ID, verifies the exact SHA, Compose-project, and
  service labels, and durably records those IDs. Every later Alembic command
  and affected-service `compose up` is rendered with those `sha256:<image-id>`
  values directly, never with the tag. It repeats the same tag/ID and
  label checks before Alembic, before restart, immediately after recreation,
  and again after all health/public smoke tests immediately before the verified
  marker. A missing, retagged, relabeled, or concurrently recreated image fails
  before activation. Runtime verification never promotes a freshly resolved
  mutable tag to expected evidence: it receives the durable post-build image ID
  and requires both the tag and the sole running Compose container to retain
  that ID, release-SHA label, Compose project, service, config file, and config
  hash. Verified-marker reconciliation loads the original IDs from the strict
  mode-`0600` deployment record named by the marker deployment ID and repeats
  the same final gate; it does not re-declare identity from the current tag.
  Only changed `registry-api`, `ingestion-service`,
  `rag-retrieval-service`, and `web` services are built and recreated. A
  release touching another runtime service fails closed. A change to the shared
  production Compose file is accepted only when a structural comparison proves
  that its complete top-level envelope and every unmanaged service block are
  byte-identical; only changed blocks belonging to those four managed services
  are selected. Adding/removing a service or changing reverse proxy,
  platform-status, networks, volumes, or another unmanaged block fails before
  build.
  `infra/keycloak/realm-stratos.json` is the sole explicit non-runtime
  exception: the shared STRATOS realm is reconciled and verified through the
  independent Keycloak administration workflow, so changing this declarative
  export neither selects nor mutates an AKB Compose service. Every other path
  below `infra/keycloak/` remains fail-closed. The exception does not apply the
  realm export and must not be used as evidence that live Keycloak matches it.
- Immediately before Compose may recreate an affected service, the workflow
  durably records `target_services_start_may_have_started=true`. Any handled
  failure after that boundary and before the verified marker quarantines every
  affected target service: it enumerates the exact Compose project/service,
  requires a non-one-off container whose configured and running image are both
  the durable target image ID, plus the expected release provenance labels and
  target Compose-file identity, then force-removes
  the container and proves that no matching container remains. This removes the
  restart policy as well as stopping the process. It never starts a predecessor
  after migration. Per-service success/failure fields are written to the durable
  deployment record. If container identity cannot be proven, removal fails, or
  the failed runtime/deployment evidence cannot be published, the deployment
  lock is deliberately preserved for explicit incident investigation.
- The pre-stop writable-primary gate runs before any target image build. A
  failure there is retryable with the same approved SHA because no immutable
  target artifact may have been created. Immediately before the first build
  command, the workflow durably creates
  `/srv/akl/state/burned-shas/<full-sha>` and sets
  `target_build_may_have_started=true` and
  `retry_requires_descendant_sha=true`. A pre-existing target tag creates the
  same permanent marker. Partial target tags are retained, but the marker—not
  tag presence—is authoritative: that SHA must not be retried or reused even if
  build failed before tagging or a tag later disappeared. The only same-SHA
  exception is verified-runtime activation/success reconciliation, which is
  selected before the burn rejection and never rebuilds.
- Before any Registry database read for the release backup, the workflow
  enumerates the sole predecessor with `docker ps -a`, records whether that
  exact container was running or restarting, and explicitly issues Compose `stop` even when
  the predecessor is already stopped in a restart gap. It then proves that no
  project Registry writer remains running. Quiescence is not handed to the
  backup through a free boolean: a private, durable per-deployment evidence
  file is bound to the active deployment lock, Compose project, and exact
  predecessor ID. Docker state is rechecked from `ps -a` at backup entry,
  immediately before `pg_dump`, before target-head inspection, and immediately
  before the runtime marker/migration. A pre-apply failure restarts only a
  predecessor captured as running or restarting; an already-stopped predecessor remains
  stopped. The workflow creates a PostgreSQL custom-format dump, verifies its
  SHA-256, validates it with `pg_restore --list`, and writes a non-secret
  inventory containing exactly one full Alembic revision such as
  `0018_ingestion_attempts` plus row counts for `documents`,
  `document_versions`, `document_files`, `document_access_policies`, and
  `audit_events` used by the isolated restore gate.
- `psql`, `pg_dump`, and `pg_restore` are never taken from the host. The
  workflow requires `AKL_RELEASE_POSTGRES_TOOL_IMAGE` to name an already-local
  exact `name@sha256:<digest>` or `sha256:<image-id>`, verifies that identity
  before building or stopping a writer, and always runs it with `--pull
  never`, host networking, a read-only root filesystem, and only the required
  bind mounts. The database password is supplied through a mode-`0600` pgpass
  file below the operator-owned mode-`0700`
  `/srv/akl/state/postgres-credentials` root, never a command argument or
  inventory field. Normal and handled-error exits strictly validate and remove
  the per-operation directory. SIGKILL may leave it behind, so a later deploy
  fails closed until the exact directory is investigated and explicitly
  cleaned with the recovery command below.
- Three independent connections to the configured HA endpoint run at each of
  three boundaries: before any target build (`pre-stop`), after build and
  predecessor capture immediately before the durable stop boundary
  (`pre-quiesce`), and after the durable backup immediately before migration
  (`pre-migration`). Every result must report `transaction_read_only=off`,
  `pg_is_in_recovery()=false`, the exact configured `current_database()` and
  `current_user`, and a well-formed backend address/port. All gates use the
  already-resolved exact PostgreSQL tool image ID and a private pgpass mount. A
  connection error, wrong database/user, read-only transaction, recovery node,
  malformed response, or changed image identity fails closed. A
  `pre-quiesce` failure leaves the writer untouched but is post-build, so the
  durable burned-SHA rule requires a descendant.
- The Registry database URL must encode exactly one host, port, database, and
  user in its authority/path. Query strings and fragments are forbidden because
  psycopg/SQLAlchemy connection parameters such as `host` could otherwise route
  Alembic to a backend different from the one verified by the release gate.
- The dump, restore list, checksum, inventory, backup stage/final directories,
  and backup parent are fsynced before the applied-runtime watermark may
  advance. The inventory records the exact tool image reference/ID and all
  three PostgreSQL client versions.
- The checksum and `pg_restore --list` prove artifact integrity and syntactic
  custom-dump/TOC readability only; they do not prove a restorable recovery
  point. Recovery confidence comes from the
  [required isolated Registry restore rehearsal](#required-isolated-registry-restore-rehearsal)
  below.
- The backup inventory records the actual PostgreSQL backend address and port
  returned by `inet_server_addr()`/`inet_server_port()` when available. This is
  useful HA-routing evidence, but the application account is not required to
  read a privileged cluster identifier. The gate therefore proves configured
  HA endpoint, writable-primary state, exact database/user, and observed
  backend identity; it does not claim cryptographic cluster identity.
- Registry migrations are forward-only. Recovery deploys a reviewed
  descendant commit; it does not downgrade Alembic, reset a database, restore
  in place, or delete a Docker volume.
- The backup database must contain exactly one full Alembic revision, the
  target image must declare exactly one head, and the post-upgrade `alembic
  current` output must contain exactly one canonical revision equal to that
  target head. Empty, malformed, or multi-head state fails closed.
- `/srv/akl/state/applied-runtime.env` is an atomic, mode-`0600` watermark of
  the latest SHA whose migration or runtime start may have been attempted. It
  is written before `alembic upgrade` and before affected services start. If
  it differs from the verified `/srv/akl/current`, ordinary deployment is
  blocked and only a descendant forward-fix from that exact SHA is accepted.
- `/srv/akl/current` advances atomically only after the affected containers are
  running and internal and public health/readiness/smoke checks pass. The
  runtime marker, deployment records, and current-link parent directory are
  durable. If power is lost after the verified marker but before `current`, a
  retry of that same SHA re-verifies the exact running images and completes
  only the missing activation; it does not rebuild or repeat a migration.
  If power is lost after the durable `current` fsync but before the final
  success record, the same no-forward-fix retry re-verifies the already-current
  release and records `reconciled_verified_success` without rebuilding,
  migrating, or rewriting the link.

## Persistent Host Layout

```text
/srv/akl/
  git/AI-KnowledgeBase.git/       # bare mirror; no working tree
  releases/<full-sha>/            # verified, read-only Git archives
  current -> releases/<full-sha>  # last fully verified release
  env/akl.prod.env                # mode 0600, never committed
  env/ingestion-authorization.secret       # Registry proof signing, mode 0600
  env/svc-ingestion.client-secret          # Ingestion -> Registry, mode 0600
  env/akb-rag-service.client-secret        # RAG -> Registry, mode 0600
  env/svc-akb-web-ingestion.client-secret  # web -> Ingestion, mode 0600
  state/applied-runtime.env       # mode 0600, latest possibly applied SHA
  state/burned-shas/<full-sha>    # mode 0600, permanent post-build retry ban
  state/registry-quiescence/*.env # mode 0600, deployment/lock-bound stop proof
  backups/registry-*/             # dump, checksum, restore list, inventory
  restore-rehearsals/*.txt        # mode 0600, isolated restore evidence
  deployments/*.txt               # non-secret attempt records
  repo/                            # optional legacy/maintenance checkout only
```

Do not place mutable data, secrets, backups, or logs below `releases/`.

## One-Time Host Preparation

Install Bash, Git, Docker Compose, Python 3, curl, tar, and `sha256sum`.
PostgreSQL client packages are intentionally not required on the host. Create
the persistent directories and private environment file:

```bash
sudo install -d -m 0700 \
  /srv/akl/env \
  /srv/akl/backups \
  /srv/akl/deployments \
  /srv/akl/git \
  /srv/akl/releases \
  /srv/akl/state \
  /srv/akl/state/burned-shas
sudo install -m 0600 \
  infra/docker-compose/docker-home.env.example \
  /srv/akl/env/akl.prod.env
sudo install -m 0600 /dev/null /srv/akl/env/ingestion-authorization.secret
sudo install -m 0600 /dev/null /srv/akl/env/svc-ingestion.client-secret
sudo install -m 0600 /dev/null /srv/akl/env/akb-rag-service.client-secret
sudo install -m 0600 /dev/null /srv/akl/env/svc-akb-web-ingestion.client-secret
```

Replace every placeholder in the copied file through the approved secret
handling path and populate each empty private file through the approved
Keycloak/secret workflow. Do not print any completed file or secret. The
Registry signing secret is an independent random value of at least 32 bytes;
the other three files contain the corresponding exact confidential-client
secrets. At minimum, keep these release controls explicit:

```dotenv
AKL_RELEASE_GIT_URL=https://github.com/voldzi/AI-KnowledgeBase.git
AKL_RELEASE_TRUSTED_REF=refs/remotes/origin/main
AKL_RELEASE_COMPOSE_PROJECT=akl
AKL_RELEASE_EXPECTED_REGISTRY_DB_HOST=haproxy.home.cz
AKL_RELEASE_EXPECTED_REGISTRY_DB_PORT=5000
AKL_RELEASE_EXPECTED_REGISTRY_DB_NAME=akl_registry
AKL_RELEASE_EXPECTED_REGISTRY_DB_USER=akl_platform
AKL_RELEASE_POSTGRES_TOOL_IMAGE=postgres:18-alpine@sha256:<64-lowercase-hex>
AKL_INGESTION_AUTHORIZATION_SECRET_FILE=/srv/akl/env/ingestion-authorization.secret
AKL_INGESTION_REGISTRY_CLIENT_SECRET_FILE=/srv/akl/env/svc-ingestion.client-secret
AKL_RAG_REGISTRY_CLIENT_SECRET_FILE=/srv/akl/env/akb-rag-service.client-secret
AKL_WEB_INGESTION_CLIENT_SECRET_FILE=/srv/akl/env/svc-akb-web-ingestion.client-secret
```

`AKL_RELEASE_POSTGRES_TOOL_IMAGE` may instead be an exact local
`sha256:<64-lowercase-hex>` image ID. Mutable tags are rejected. Provision the
reviewed image through the normal trusted image-loading process before the
change window, then verify it without pulling:

```bash
TOOL_IMAGE='<the exact value stored in /srv/akl/env/akl.prod.env>'
docker image inspect "$TOOL_IMAGE" >/dev/null
docker run --rm --pull never --network host --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  "$TOOL_IMAGE" pg_dump --version
```

Do not put the production database URL or password in this command or in shell
history. The deployment script creates and removes its private pgpass mount.

`AKL_RELEASE_REGISTRY_STOP_TIMEOUT_SECONDS` is an optional safety tuning value
between 1 and 300 seconds; the default is `30`.

The environment path must be a regular file, not a symlink, and it must not be
group- or world-readable. The workflow rejects placeholder values and unsafe
permissions before preparing or changing runtime state. Invoke the workflow
from a clean shell; an exported key that also exists in the env file is an
error, even when both values happen to match. An exported key interpolated by
the target Compose file is also an error even when it is absent from the env
file; this applies to preparation and first-host bootstrap as well as deploy.
Before the SHA is burned or any image is built, the deploy script also requires
every private file needed by the selected service set to be an absolute,
single-link, non-symlink regular file owned by the release operator with exact
mode `0600` and non-empty content. Registry additionally requires at least 32
bytes. First rollout selects all four services, so all four files are mandatory
even if an older runtime did not use them.

For the first transition, do not invoke an orchestrator from mutable
`/srv/akl/repo`. Use an already prepared, reviewed, read-only immutable release
only to prepare the approved target. Then invoke the one-time bootstrap entry
point from that exact target release:

```bash
BOOTSTRAP_SHA=0123456789abcdef0123456789abcdef01234567
TARGET_SHA=89abcdef0123456789abcdef0123456789abcdef
BOOTSTRAP_RELEASE="/srv/akl/releases/${BOOTSTRAP_SHA}"

test ! -e /srv/akl/current && test ! -L /srv/akl/current
test "$(tr -d '[:space:]' <"${BOOTSTRAP_RELEASE}/.akl-release-sha")" = "$BOOTSTRAP_SHA"
test ! -w "${BOOTSTRAP_RELEASE}/scripts/prepare_docker_home_release.sh"
TARGET_RELEASE="$("${BOOTSTRAP_RELEASE}/scripts/prepare_docker_home_release.sh" "$TARGET_SHA")"
test "$TARGET_RELEASE" = "/srv/akl/releases/${TARGET_SHA}"
"${TARGET_RELEASE}/scripts/bootstrap_docker_home_target.sh" --sha "$TARGET_SHA"
```

The target bootstrap refuses to run from any other path or when `current`
already exists. It re-runs the target's own preparation checks, including the
trusted `origin/main` ancestry, strict release metadata, and extracted-tree
verification, before it executes the target's deployment orchestrator. After
the first successful immutable release, always invoke tooling through
`/srv/akl/current/scripts/`.
The missing regular path and missing symlink checks for `current` are a
first-transition-only invariant; a broken or pre-existing link is not treated
as an uninitialized host.

If a clean host has no already-prepared immutable bootstrap release, establish
the initial root of trust with a disposable exact-SHA checkout. Verify it
before executing only the target `prepare` script; never execute a deploy
orchestrator from this checkout:

```bash
GIT_URL=https://github.com/voldzi/AI-KnowledgeBase.git
TARGET_SHA=89abcdef0123456789abcdef0123456789abcdef
BOOTSTRAP_CHECKOUT="$(mktemp -d /tmp/akl-bootstrap.XXXXXX)"
trap 'rm -rf "$BOOTSTRAP_CHECKOUT"' EXIT

test ! -e /srv/akl/current && test ! -L /srv/akl/current
GIT_TERMINAL_PROMPT=0 git --no-replace-objects clone --no-checkout "$GIT_URL" "$BOOTSTRAP_CHECKOUT"
git --no-replace-objects -C "$BOOTSTRAP_CHECKOUT" fetch --prune origin \
  '+refs/heads/*:refs/remotes/origin/*'
test -z "$(git --no-replace-objects -C "$BOOTSTRAP_CHECKOUT" for-each-ref --format='%(refname)' refs/replace/)"
git --no-replace-objects -C "$BOOTSTRAP_CHECKOUT" checkout --detach "$TARGET_SHA"
test "$(git --no-replace-objects -C "$BOOTSTRAP_CHECKOUT" remote get-url origin)" = "$GIT_URL"
test "$(git --no-replace-objects -C "$BOOTSTRAP_CHECKOUT" rev-parse HEAD)" = "$TARGET_SHA"
git --no-replace-objects -C "$BOOTSTRAP_CHECKOUT" merge-base --is-ancestor \
  "$TARGET_SHA" refs/remotes/origin/main
test -z "$(git --no-replace-objects -C "$BOOTSTRAP_CHECKOUT" status --porcelain --untracked-files=all)"

TARGET_RELEASE="$("${BOOTSTRAP_CHECKOUT}/scripts/prepare_docker_home_release.sh" "$TARGET_SHA")"
test "$TARGET_RELEASE" = "/srv/akl/releases/${TARGET_SHA}"
"${TARGET_RELEASE}/scripts/bootstrap_docker_home_target.sh" --sha "$TARGET_SHA"
```

After the command returns, the trap removes only the disposable checkout. The
prepared target and all deployment state remain under `/srv/akl`. This generic
path and the already-prepared-release path converge on the same invariant: the
only deploy orchestrator executed is inside the verified target release.

## One-Time Upgrade From An Existing Immutable `current`

Use this section only when `/srv/akl/current` already names a verified
immutable release but its `scripts/deploy_docker_home_release.sh` does not
contain the exact line `AKL_IMMUTABLE_ORCHESTRATOR_CONTRACT=2`. This is the
rollout path for the first release that introduces hardened contract 2. It is
not a replacement for ordinary deployment and it is not valid for a dirty
working-tree deployment.

The supported transition trust model is intentionally narrow:

- the release operator owns the canonical `/srv/akl`,
  `/srv/akl/env/akl.prod.env`, `/srv/akl/git/AI-KnowledgeBase.git`, release
  trees, runtime marker, and transition entry scripts; in production this
  operator is `root`;
- the environment is exactly `/srv/akl/env/akl.prod.env`, is a single-link
  regular file with mode `0600`, and is never sourced;
- the bare mirror is exactly `/srv/akl/git/AI-KnowledgeBase.git`; the mirror,
  release root, `releases`, and relevant parent directories are real
  operator-owned directories and are not group/world writable. The mirror is
  self-contained: external/local object alternates, HTTP alternates, grafts,
  shallow/linked-worktree metadata, config includes, symlinked object/ref
  paths, hard-linked files, and group/world-writable object/ref paths are
  rejected;
- `current` is an operator-owned symlink that resolves exactly to
  `/srv/akl/releases/<current-sha>`; current and target trees are recursively
  operator-owned, read-only, single-link for regular files, free of escaping
  symlinks, and byte-for-byte verified against the bare mirror;
- `/srv/akl/state/applied-runtime.env` is an operator-owned, single-link,
  mode-`0600` regular file. A clean attempt requires `state=verified`,
  `phase=verified`, and `applied_sha=<current-sha>`;
- the target is an exact descendant reachable from the configured trusted
  `origin/main`, contains contract 2, has no burned-SHA evidence, has none of
  the three target image tags, and no deployment lock is active.

Run from a clean root shell. First inspect the existing state without invoking
its scripts:

```bash
CURRENT_SHA="$(tr -d '[:space:]' </srv/akl/current/.akl-release-sha)"
test "$(readlink -f /srv/akl/current)" = "/srv/akl/releases/${CURRENT_SHA}"
grep -E '^(applied_sha|state|phase)=' /srv/akl/state/applied-runtime.env
test "$(awk -F= '$1 == "applied_sha" {print $2}' /srv/akl/state/applied-runtime.env)" = "$CURRENT_SHA"
test "$(awk -F= '$1 == "state" {print $2}' /srv/akl/state/applied-runtime.env)" = verified
test "$(awk -F= '$1 == "phase" {print $2}' /srv/akl/state/applied-runtime.env)" = verified
! grep -Fxq 'AKL_IMMUTABLE_ORCHESTRATOR_CONTRACT=2' \
  /srv/akl/current/scripts/deploy_docker_home_release.sh
test ! -e /srv/akl/.immutable-deploy.lock
```

Prepare the approved target with a disposable checkout of that exact target.
This executes the target's `prepare` only; it never executes an old-current or
disposable-checkout deploy script:

```bash
set -Eeuo pipefail
GIT_URL=https://github.com/voldzi/AI-KnowledgeBase.git
TARGET_SHA=89abcdef0123456789abcdef0123456789abcdef
TARGET_CHECKOUT="$(mktemp -d /tmp/akl-contract2-transition.XXXXXX)"
trap 'rm -rf "$TARGET_CHECKOUT"' EXIT

GIT_TERMINAL_PROMPT=0 git --no-replace-objects clone --no-checkout \
  "$GIT_URL" "$TARGET_CHECKOUT"
git --no-replace-objects -C "$TARGET_CHECKOUT" fetch --prune origin \
  '+refs/heads/*:refs/remotes/origin/*'
test -z "$(git --no-replace-objects -C "$TARGET_CHECKOUT" \
  for-each-ref --format='%(refname)' refs/replace/)"
git --no-replace-objects -C "$TARGET_CHECKOUT" checkout --detach "$TARGET_SHA"
test "$(git --no-replace-objects -C "$TARGET_CHECKOUT" rev-parse HEAD)" = "$TARGET_SHA"
git --no-replace-objects -C "$TARGET_CHECKOUT" merge-base --is-ancestor \
  "$TARGET_SHA" refs/remotes/origin/main
test -z "$(git --no-replace-objects -C "$TARGET_CHECKOUT" \
  status --porcelain --untracked-files=all)"
grep -Fxq 'AKL_IMMUTABLE_ORCHESTRATOR_CONTRACT=2' \
  "$TARGET_CHECKOUT/scripts/deploy_docker_home_release.sh"

TARGET_RELEASE="$(
  "$TARGET_CHECKOUT/scripts/prepare_docker_home_release.sh" "$TARGET_SHA"
)"
test "$TARGET_RELEASE" = "/srv/akl/releases/${TARGET_SHA}"
"${TARGET_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$TARGET_SHA" \
  --transition-existing-current
```

The bootstrap performs a read-only preflight and `exec`s the exact target
orchestrator. The target orchestrator creates the normal private linked env
snapshot, acquires the standard deployment lock, skips `prepare`/fetch, and
repeats mirror origin/ref, no-replace, ownership, release-tree, current,
runtime-marker, ancestry, burn, and image-tag guards under that lock. A race
between preflight and lock acquisition therefore ends in lock or revalidation
failure before Docker build, writer stop, or database work. The old `current`
orchestrator is never invoked.

The clean transition is one-time: after contract 2 becomes current, a
descendant must use the ordinary `/srv/akl/current/scripts/` deployment path.
Only same-SHA verified reconciliation remains accepted through the target
bootstrap:

- if power is lost after the durable `verified/verified` target marker but
  before `current`, remove a stale lock only after proving its recorded PID is
  no longer alive, then repeat the exact same target bootstrap command;
- if power is lost after the durable `current` fsync but before final success
  bookkeeping, perform the same stale-lock check and repeat the exact same
  target bootstrap command. It re-verifies durable image/container evidence
  without build, migration, or another activation;
- a post-build pre-apply failure leaves `current` verified but permanently
  burns the failed target. Prepare a reviewed descendant and run the descendant
  through this transition section; never retry the burned SHA;
- if migration or target runtime may have been applied, the marker is
  `applying` or `failed` at the target SHA and ordinary transition re-entry is
  rejected. Prepare a reviewed descendant and invoke recovery from the exact
  failed hardened release, never from the old `current`:

```bash
FAILED_SHA=89abcdef0123456789abcdef0123456789abcdef
FORWARD_FIX_SHA=fedcba9876543210fedcba9876543210fedcba98
/srv/akl/releases/${FAILED_SHA}/scripts/rollback_docker_home_release.sh \
  --failed-sha "$FAILED_SHA" \
  --forward-fix-sha "$FORWARD_FIX_SHA"
```

The recovery command is forward-fix only. It does not authorize a database
downgrade, in-place restore, reset, tag deletion, or volume removal.

## Pre-Deployment Gate

1. Select the exact full SHA after its protected-branch CI and review are
   complete. Do not deploy a branch name or mutable tag.
2. Verify production non-destructively: current symlink and SHA marker,
   `/srv/akl/state/applied-runtime.env`, deployment records, Compose service
   state, health/readiness, database/HAProxy reachability, free disk space
   under `/srv/akl`, and the latest syntactically validated release dump.
   `applied_sha` must equal the
   current SHA and `state` must be `verified` for an ordinary deployment.
3. Confirm the change contains only the supported Registry, Ingestion, RAG, or
   web runtime scope. Shared policy contracts are treated as Registry changes.
   A shared Compose change may alter only complete blocks of these four services;
   any other service or top-level change is rejected.
4. Confirm no database reset, corpus reset, volume removal, Alembic downgrade,
   or network change is included in the change window.
5. Confirm the configured exact PostgreSQL tool image is already present
   locally. Do not pull or retag it during the maintenance window.

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
4. determines the affected Registry/Ingestion/RAG/web services from the Git
   diff and structurally constrains any shared Compose change to those exact
   service blocks;
5. preflights every selected service's private signing/client-secret file before
   the burn/build boundary; when Registry is affected, verifies the configured exact local PostgreSQL
   tool image, records its image ID and client versions, and obtains three
   consecutive writable-primary and exact database/user identity results
   before any target image build or writer-stop boundary;
6. rejects an existing burned-SHA marker or target image tag, durably burns the
   SHA immediately before build, renders Compose, and builds only affected
   services with full-SHA image tags; it immediately resolves and durably
   records each tag's image ID and exact SHA/project/service labels;
7. when Registry is affected, enumerates the exact predecessor with `docker ps
   -a`, captures its image/Compose identity and prior running state, and obtains
   three consecutive `pre-quiesce` writable-primary results;
8. durably records that a writer stop may begin, explicitly stops any captured
   predecessor, writes lock-bound quiescence evidence, and rechecks the exact
   stopped predecessor/no-writer invariant immediately before dump and
   migration. It creates and fsyncs the checksum/TOC-validated custom dump and
   records critical table row counts. It requires exactly one full
   pre-backup database revision and one target head, obtains three consecutive
   `pre-migration` writable-primary results, records the target SHA in the
   applied-runtime watermark, runs target-head inspection, `alembic upgrade
   head`, and post-upgrade inspection directly from the durable Registry image
   ID, and requires exactly
   one post-upgrade current revision equal to the target head;
9. rechecks every recorded target tag/ID/label, renders affected-service image
   variables as the durable IDs, recreates only affected services with `--pull
   never --no-build --no-deps`, and requires the recreated containers to name
   and run those same IDs;
10. checks the exact durable image tag/ID, image and container release labels, Compose
   ownership/config labels, running state, and exact release version for every affected service,
   runs Ingestion readiness inside its container with the exact
   `svc-ingestion` credential (never as anonymous HTTP), plus public
   health/readiness and a fail-closed anonymous request for a
   guaranteed-missing public slug (an unaffected web keeps its prior image
   SHA); the missing-slug response must be the structured AKB JSON contract
   with `Cache-Control: no-store`, not a generic proxy 404; after all smokes it
   repeats the tag and sole-container durable-ID/provenance gate;
11. durably records activation intent, atomically changes `/srv/akl/current`,
    fsyncs its parent, and durably records success.

For a Registry release, inspect the generated backup without printing secrets:

```bash
BACKUP_DIR=/srv/akl/backups/registry-<utc>-<full-sha>
cd "$BACKUP_DIR"
sha256sum --check registry.dump.sha256
test -s pg_restore.list
sed -n '1,40p' inventory.txt
```

Keep the dump, checksum, restore list, and inventory together. Their creation
does not authorize an in-place restore.

### Required isolated Registry restore rehearsal

A backup becomes an approved restore point only after this rehearsal succeeds
on an isolated, unpublished Docker network. Run it from the local default
Docker socket; never pass the production database URL, never attach the
rehearsal containers to a production network, and never restore into the HA
endpoint. Replace only `BACKUP_DIR` with the selected immutable artifact:

```bash
set -Eeuo pipefail
umask 077
BACKUP_DIR=/srv/akl/backups/registry-<utc>-<full-sha>
ENV_FILE=/srv/akl/env/akl.prod.env
REHEARSAL_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
NETWORK="akl-registry-restore-${REHEARSAL_ID}"
SERVER="akl-registry-restore-db-${REHEARSAL_ID}"
EVIDENCE_DIR=/srv/akl/restore-rehearsals
EVIDENCE="${EVIDENCE_DIR}/registry-${REHEARSAL_ID}.txt"

test "$(docker context show)" = default
test "$(docker context inspect default --format '{{.Endpoints.docker.Host}}')" = \
  unix:///var/run/docker.sock
test -d "$BACKUP_DIR" && test ! -L "$BACKUP_DIR"
(cd "$BACKUP_DIR" && sha256sum --check registry.dump.sha256)
test -s "$BACKUP_DIR/pg_restore.list"
TOOL_IMAGE="$(awk -F= '$1 == "AKL_RELEASE_POSTGRES_TOOL_IMAGE" {print substr($0, index($0, "=") + 1)}' "$ENV_FILE")"
test -n "$TOOL_IMAGE"
TOOL_ID="$(docker image inspect --format '{{.Id}}' "$TOOL_IMAGE")"
test "${TOOL_ID#sha256:}" != "$TOOL_ID"

cleanup_restore_rehearsal() {
  local status=0
  docker rm -f "$SERVER" >/dev/null 2>&1 || status=1
  docker network rm "$NETWORK" >/dev/null 2>&1 || status=1
  return "$status"
}
trap 'cleanup_restore_rehearsal || true' EXIT
docker network create --internal "$NETWORK" >/dev/null
docker run -d --pull never --name "$SERVER" --network "$NETWORK" \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=2g \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=akl_registry_restore \
  -e POSTGRES_USER=akl_restore \
  "$TOOL_IMAGE" >/dev/null

for attempt in $(seq 1 30); do
  if docker run --rm --pull never --network "$NETWORK" --read-only \
    --cap-drop ALL --security-opt no-new-privileges \
    "$TOOL_IMAGE" pg_isready -h "$SERVER" -p 5432 \
      -U akl_restore -d akl_registry_restore >/dev/null 2>&1; then
    break
  fi
  test "$attempt" -lt 30
  sleep 1
done

docker run --rm --pull never --network "$NETWORK" --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,src=${BACKUP_DIR},dst=/backup,readonly" \
  "$TOOL_IMAGE" pg_restore --exit-on-error --single-transaction \
    --no-owner --no-privileges \
    --dbname="postgresql://akl_restore@${SERVER}:5432/akl_registry_restore" \
    /backup/registry.dump

RESTORED_HEAD="$(docker run --rm --pull never --network "$NETWORK" --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  "$TOOL_IMAGE" psql --no-psqlrc --tuples-only --no-align \
    --host "$SERVER" --username akl_restore --dbname akl_registry_restore \
    --command='SELECT version_num FROM alembic_version ORDER BY version_num')"
RESTORED_HEAD="$(printf '%s' "$RESTORED_HEAD" | tr -d '[:space:]')"
EXPECTED_HEAD="$(awk -F= '$1 == "alembic_before" {print $2}' "$BACKUP_DIR/inventory.txt")"
test -n "$RESTORED_HEAD" && test "$RESTORED_HEAD" = "$EXPECTED_HEAD"

RESTORED_COUNTS="$(docker run --rm --pull never --network "$NETWORK" --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  "$TOOL_IMAGE" psql --no-psqlrc --tuples-only --no-align --field-separator='|' \
    --host "$SERVER" --username akl_restore --dbname akl_registry_restore \
    --command='SELECT (SELECT COUNT(*) FROM documents), (SELECT COUNT(*) FROM document_versions), (SELECT COUNT(*) FROM document_files), (SELECT COUNT(*) FROM document_access_policies), (SELECT COUNT(*) FROM audit_events)')"
RESTORED_COUNTS="$(printf '%s' "$RESTORED_COUNTS" | tr -d '[:space:]')"
EXPECTED_COUNTS="$(awk -F= '
  $1 == "documents_count" {a=$2}
  $1 == "document_versions_count" {b=$2}
  $1 == "document_files_count" {c=$2}
  $1 == "document_access_policies_count" {d=$2}
  $1 == "audit_events_count" {e=$2}
  END {print a "|" b "|" c "|" d "|" e}
' "$BACKUP_DIR/inventory.txt")"
test "$RESTORED_COUNTS" = "$EXPECTED_COUNTS"

cleanup_restore_rehearsal
trap - EXIT
if docker inspect "$SERVER" >/dev/null 2>&1; then
  printf 'restore rehearsal container still exists after cleanup\n' >&2
  exit 1
fi
if docker network inspect "$NETWORK" >/dev/null 2>&1; then
  printf 'restore rehearsal network still exists after cleanup\n' >&2
  exit 1
fi

mkdir -p -m 0700 "$EVIDENCE_DIR"
DUMP_SHA="$(awk 'NR == 1 {print $1}' "$BACKUP_DIR/registry.dump.sha256")"
{
  printf 'schema_version=1\nstatus=passed\n'
  printf 'backup_dir=%s\ndump_sha256=%s\n' "$BACKUP_DIR" "$DUMP_SHA"
  printf 'postgres_tool_image_ref=%s\npostgres_tool_image_id=%s\n' "$TOOL_IMAGE" "$TOOL_ID"
  printf 'restored_alembic_head=%s\ncritical_row_counts=%s\n' "$RESTORED_HEAD" "$RESTORED_COUNTS"
  printf 'completed_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$EVIDENCE"
chmod 0600 "$EVIDENCE"
python3 - "$EVIDENCE" <<'PY'
import os
import sys
from pathlib import Path
path = Path(sys.argv[1])
with path.open("rb") as handle:
    os.fsync(handle.fileno())
directory_fd = os.open(path.parent, os.O_RDONLY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
PY
```

Attach the mode-`0600` evidence file, `inventory.txt`, checksum result, and
change-ticket/reviewer identity to the recovery record. A second operator must
confirm the network had no published port, the database was initially empty,
the restored Alembic head and all five critical row counts matched, and cleanup
removed both temporary objects before `status=passed` was written. Until that evidence exists, label the backup
`artifact-valid / restore-readiness-unproven`; do not claim full recovery
readiness and do not authorize an in-place restore.

## Failed Verification And Forward-Fix Recovery

On any failure, the script leaves `/srv/akl/current` unchanged and writes a
failed record below `/srv/akl/deployments`. If the applied-runtime watermark
was advanced but verification did not finish, it remains on the target SHA
with `state=failed`, including when readiness fails. On a handled verification
failure, every affected target container is quarantined before failed evidence
is published; inspect `target_registry_quarantined`,
`target_rag_quarantined`, `target_web_quarantined`, and their corresponding
`*_quarantine_failed` fields. A hard power loss, SIGKILL, or failed quarantine
can still leave a target container present, and a Registry migration may already
be committed; therefore the old symlink is evidence of the last verified
release, not permission to start old code against a newer schema. The separate
fully-verified marker/current crash boundary is handled by the reconciliation
path below.

The exact stopped old Registry container is restarted automatically only when
it was captured as running and the failure occurs before the applied-runtime
watermark advances (for example, a failed dump or the post-backup gate reporting
read-only/recovery). A predecessor captured as already stopped is still
explicitly stopped and verified, but is never started as failure recovery.
Pre-stop and pre-quiesce writable-primary failures both happen before the
durable stop boundary and therefore leave writer state untouched; only the
pre-stop failure is before build and same-SHA retryable. Deployment records
expose `old_registry_was_running`, `writable_primary_pre_stop_checked`,
`writable_primary_pre_quiesce_checked`, and
`writable_primary_pre_migration_checked` without database credentials.

Once `/srv/akl/state/burned-shas/<full-sha>` exists or the record says
`target_build_may_have_started=true`, retain any partial immutable tags and
deploy only a reviewed descendant; `retry_requires_descendant_sha=true`
expressly applies even when no tag exists and `migration_started=false`. Never
delete a burn marker to manufacture a retry. Once migration or runtime start is
possible, the old container is never restarted automatically. Do not edit or
delete the runtime watermark to bypass recovery. This pre-apply restoration
also applies to the captured dirty-checkout predecessor during the first
immutable transition; the workflow restarts that exact container only when it
was originally running and verifies the captured image and Compose identities
rather than recreating it from `/srv/akl/repo`.

If a killed host process leaves `/srv/akl/.immutable-deploy.lock`, inspect its
`owner` file and prove that the recorded PID is absent and that no related
Compose, backup, or migration process is running before removing the stale
directory. Never remove the lock merely to bypass a live deployment.
The same lock is intentionally retained after a failed quarantine, failed
failure-evidence write, or any owner-file removal, lock-directory removal, or
lock-owner validation failure. The durable failed/activation record reports
`deploy_lock_preserved=true`; do not treat a failed cleanup syscall as a
released lock. In that case, inspect every affected Compose service and
force-remove only a container whose project, service, durable configured/running
image ID, release labels, and Compose-file identity prove it is the unverified
target;
do not infer identity from a container name alone and do not restart an older
image after migration. Also inspect the matching durable deployment record. A
`registry_stop_may_have_started=true` record is deliberately conservative: the
old Registry container may already be stopped even when
`registry_quiesced=false`. Reconcile that exact captured container state before
removing a stale lock. Never infer writer state only from `/srv/akl/current`.

A killed process can also leave exactly one private directory matching
`/srv/akl/env/.akl-release-env.<full-sha>.*`. Do not delete it with a wildcard.
After completing the stale-lock investigation above and removing only the proven
dead lock, invoke the cleanup script from the exact hardened release that created
the snapshot:

```bash
SNAPSHOT_DIR=/srv/akl/env/.akl-release-env.0123456789abcdef0123456789abcdef01234567.AbCd12
/srv/akl/releases/0123456789abcdef0123456789abcdef01234567/scripts/cleanup_stale_release_env_snapshot.sh \
  --snapshot-dir "$SNAPSHOT_DIR"
```

The command refuses an active lock, paths outside the exact naming pattern,
symlinks, hardlinks, unexpected entries, wrong ownership/modes, or another
filesystem. It removes one validated `akl.prod.env` and its now-empty directory,
then fsyncs `/srv/akl/env`. A new deploy refuses to start while any matching stale
snapshot remains.

A killed primary gate or backup can instead leave one directory below
`/srv/akl/state/postgres-credentials`. Do not read or print its `pgpass`, and do
not delete it recursively or by wildcard. After the same stale-lock/process
investigation, pass the exact directory to the hardened cleanup entry point:

```bash
CREDENTIAL_DIR=/srv/akl/state/postgres-credentials/<deployment-id>--<purpose>
/srv/akl/releases/<hardened-release-sha>/scripts/cleanup_stale_release_postgres_credentials.sh \
  --credential-dir "$CREDENTIAL_DIR"
```

The command refuses an active deployment lock and validates the canonical
parent, exact narrow name, ownership, modes, filesystem, regular-file type,
single-link count, and allowlisted filenames before unlinking anything. A new
deploy refuses to start while any entry remains in this private root.

If the applied-runtime marker is `state=verified`, `phase=verified`, and names
the requested SHA while `current` still points to its predecessor, rerun the
same exact SHA after the stale-lock investigation. The workflow enters the
verified-activation reconciliation path: it loads the original post-build image
IDs from the strict deployment record named by the runtime marker, rechecks the
tag and exact containers against those IDs before and after public smoke tests,
fsyncs the current link, and records
`reconciled_verified_activation` without rebuilding or migrating.

If `current` already names that same verified target but the last durable
record is still `activating_current`, rerun the exact SHA without a
forward-fix context. The workflow re-verifies the target and records
`reconciled_verified_success` without rebuilding, migrating, or replacing the
already durable link. A rollback wrapper or mismatched `--failed-sha` is never
accepted as a reconciliation shortcut.

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
proves exact single-head Alembic handling, exact containerized PostgreSQL
tooling without host clients, three-check writable-primary gates before build,
immediately before writer stop, and immediately before migration, fail-closed
read-only/recovery behavior, minimal
credential/data mounts, release/backup fsync
ordering, SIGKILL evidence and strict stale env-snapshot and PostgreSQL-credential
recovery at writer-stop and marker/current boundaries, safe
pre-apply Registry restoration (including an already-stopped restart-gap
predecessor and the dirty predecessor on the first immutable rollout),
target-only first bootstrap, strict metadata/Git-replace provenance, literal
env-file values, xtrace secret suppression, reopenable linked env-snapshot binding
despite a persistent-file swap before Alembic, local Docker daemon binding, and ambient Compose isolation,
verified activation and post-current-fsync success reconciliation,
durable burned-SHA descendant retry even before tag creation, persistent recovery
after failed readiness, rejection of mutable/missing tool images and ordinary
or non-descendant recovery attempts, external writer restart/restarting-state
races, unsupported shared Compose changes, and fail-closed post-build image
retag/missing-tag/label verification including retarget immediately before
Alembic execution, partial multi-service Compose-up failure, retag/recreate
during Compose up, during smoke, and before verified reconciliation, plus
four-service selection, per-service private-secret preflight before SHA burn,
immutable Ingestion image identity, authenticated `svc-ingestion` readiness,
and the invocation/failure boundary of an exact-container `nextjs` probe whose
production implementation reads the private tmpfs credential, performs the
`svc-akb-web-ingestion` client-credentials exchange, and validates the exact
non-mutating Ingestion transport response without printing a token or secret,
including fail-closed quarantine on simulated probe failure, plus
truthful lock-preservation evidence for owner/unlink/rmdir failures, with temporary Git, Docker, Compose, and
HTTP fixtures. Before the fake runtime, it also runs real `docker compose
config --quiet` and `config --format json` against a linked mode-`0600` probe
snapshot; this parses configuration only and does not contact the Docker daemon
or start a container.
