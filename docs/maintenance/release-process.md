# Release Process

This process keeps `main` stable and reproducible.

## Branch Rules

The `main` branch is protected:

- changes must go through a pull request,
- required CI checks must pass before merge,
- required checks must be up to date with `main`,
- force pushes and branch deletion are disabled,
- unresolved PR conversations block merge,
- the rule applies to administrators too.

Required checks:

- `Web`
- `Python / registry-api`
- `Python / ingestion-service`
- `Python / rag-retrieval-service`
- `Python / llm-gateway-service`
- `Python / evaluation-service`
- `Python / governance-service`
- `Docker Compose Config`
- `Immutable docker.home.cz release`

## CI Runtime

AKB pull-request and `main` CI run on the repository-specific self-hosted
runner `akb-ci`. It is hosted on the isolated `stratos-ci-runner-01` VM and
has no production secrets, production SSH credential, or access to
VM 125 (`stratos-ci-runner-01`) hosts three AKB runners. Two workers use the
`akb-ci-light` label for independent standards, web, Python and Compose checks.
One `akb-ci-exclusive` worker runs the immutable release and Registry/PostgreSQL
jobs serially because they use Docker, fixed local ports or release-state
fixtures. CI jobs must request their explicit label together with the standard
self-hosted Linux/X64 labels; do not route Docker integration work to a light
worker.

The production immutable release remains a separate operator action on
`docker.home.cz`, and accepts only a full SHA reachable from protected `main`.
CI must never use the production deployment runner or production environment.

The CI VM owns its non-secret build prerequisites. Its baseline includes Docker,
Ruby 3.3, `shellcheck`, and the Chromium runtime libraries required by the web
end-to-end test. CI jobs must not use `sudo`; a repository workflow can execute
arbitrary pull-request code and therefore receives only the `akbci` service
account.

### Persistent CI caches

The AKB runner keeps dependency caches on the VM instead of uploading them to
GitHub Actions cache storage:

- pnpm store: `/home/akbci/.cache/akb-ci/pnpm-store`
- pip download cache: `/home/akbci/.cache/akb-ci/pip`
- Playwright browsers: `/home/akbci/.cache/akb-ci/playwright`
- Docker image and build layers: the persistent Docker data root managed by the
  VM Docker daemon

These paths contain only public build dependencies and generated build layers;
they must never contain repository credentials, production secrets, `.env`
files, user uploads, or test output containing document content. Workflow jobs
must not use GitHub-hosted dependency cache actions on the self-hosted runner.
The Python and Node toolchains installed by their setup actions remain in the
runner tool cache and are also reused between jobs.

Do not run `docker system prune`, `docker builder prune`, or delete the shared
Docker data root from a workflow. The Docker daemon is shared with the STRATOS
CI runner on this VM. Cache maintenance is an operator action and must run only
while both runners are idle. Keep at least 20 GB free on the VM; when cleanup is
needed, remove package-cache entries older than 30 days first, then remove only
unused Docker build cache older than 30 days. Never prune running containers,
volumes, or images used by another repository.

## Pull Request Flow

1. Create a branch from current `main`.
2. Keep the PR scoped to one coherent change.
3. Run relevant local validation before pushing.
4. Push the branch and open a PR.
5. Wait for GitHub CI to pass.
6. Review the diff for runtime contracts, generated files, secrets, and documentation drift.
7. Squash merge into `main` after checks are green.
8. Delete the feature branch.

Do not push directly to `main`.

## Optimized Release Candidate Workflow

Use this sequence for every production-bound change. It keeps the existing
fail-closed release controls while avoiding repeated merge/build/deploy loops.

1. **Establish the baseline.** Record the clean candidate branch, the full
   current production SHA, current public health, and the diff between them.
2. **Classify runtime impact.** List the services whose source, Docker
   definition, runtime contract, or complete Compose block actually changed.
   A CI helper, documentation generator, or other non-runtime script must not
   silently justify rebuilding all services. Investigate any unexpectedly
   broad service selection before release.
3. **Run focused validation.** Start with tests, type checking, contract
   checks, and schema checks owned by the affected components. Fix failures
   before starting the expensive image gate.
4. **Build the exact production images.** Use the same Dockerfile, repository
   root context, build arguments, contract paths, and service profile as
   `docker-compose.docker-home.yml`. For the web profiles, the minimum exact
   preflight from the repository root is:

   ```bash
   docker build \
     --file apps/web/Dockerfile \
     --build-arg NEXT_PUBLIC_AKL_BASE_PATH=/akb \
     --build-arg AKL_IMAGE_SERVICE=web \
     --tag akl/web:release-preflight \
     .

   docker build \
     --file apps/web/Dockerfile \
     --build-arg NEXT_PUBLIC_AKL_BASE_PATH= \
     --build-arg AKL_IMAGE_SERVICE=chat-web \
     --tag akl/chat-web:release-preflight \
     .
   ```

   Build every other affected service with its production Dockerfile and exact
   production context. A successful native framework build and successful
   Compose rendering do not replace this gate.
5. **Finish the candidate before merge.** Keep all fixes in the same PR.
   Push only the final candidate, wait for every required check, review the
   resulting diff and generated contracts, and merge once. Do not use
   production as a Docker build test.
6. **Refresh retrieval.** Incrementally reindex the final meaningful working
   tree in Chroma using the exact managed repository root from
   `list_repositories`, currently
   `/Users/voldzi/Developer/18 2026/AI KnowledgeBase`. Verify at least one
   focused query finds the changed implementation or documentation. When MCP
   is unavailable, use:

   ```bash
   "/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" \
     reindex --root .
   ```

7. **Deploy the exact merge SHA once.** Confirm the SHA is reachable from
   protected `origin/main`, then start the immutable release through the
   current verified release. Run it detached with a durable owner-only
   operator log so an SSH or agent transport interruption cannot terminate or
   obscure the release.
8. **Monitor durable evidence.** Follow the deployment PID, deployment record,
   and operator log until completion. Do not report success while the process
   is still running.
9. **Verify production.** Confirm `/srv/akl/current`, image revisions,
   container health, public `/akb/api/health`, `/akb/api/ready`, and one narrow
   authorized application/source smoke. For a shadow integration, separately
   verify service-token issuance, exact single audience, pinned manifest
   loading, and upstream readiness before any active promotion.
10. **Close the release.** Record the merge SHA, active release SHA, affected
    services, checks run, health result, known shadow blockers, and Chroma
    reindex result.

### Failure loop

- A failure before production build is fixed in the same PR and repeats only
  the relevant local gate before required CI.
- A failed production build that has crossed the immutable SHA-burn boundary
  requires a reviewed descendant. Do not retry the burned SHA.
- Before opening that descendant PR, reproduce and fix the exact production
  image failure locally, then rerun the full production image preflight.
- A failure after migration or runtime side effects follows only the
  documented forward-fix/recovery procedure. Never improvise rollback by
  moving `current`, retagging an image, or rewriting Git history.

### Timing targets

These are operating targets, not reasons to weaken a gate:

- final PR CI: at most 8 minutes where runner capacity permits;
- prebuilt release images: at most 6 minutes and completed off production;
- production activation after verified images exist: at most 3 minutes;
- ordinary final-candidate-to-production path: at most 15 minutes;
- forward-fix or rollback decision: within 2 minutes of a verified failure.

The target architecture is build-once promotion: CI publishes signed,
content-addressed images and a release manifest, and production pulls and
verifies those digests instead of compiling source. Until that pipeline exists,
the exact local production-image preflight above is mandatory.

## Release Tag

Create a release tag only from a known-good `main` commit:

```bash
git switch main
git pull --ff-only origin main
git status -sb
git tag -a vX.Y.Z-name -m "vX.Y.Z-name"
git push origin vX.Y.Z-name
```

Create the GitHub Release from the pushed tag:

```bash
gh release create vX.Y.Z-name \
  --title "vX.Y.Z-name" \
  --notes "Release notes."
```

## Current Stable Release

Current stable local platform baseline:

- tag: `v0.1.0-local-platform`
- commit: `6e1713b91fbbd4643788584c4385c119c1c044d6`
- release: `https://github.com/voldzi/AI-KnowledgeBase/releases/tag/v0.1.0-local-platform`

## Rollback

For code rollback, create a revert PR instead of rewriting history:

```bash
git switch main
git pull --ff-only origin main
git switch -c revert/<short-description>
git revert <commit-or-range>
```

For local runtime rollback, check out the stable tag and rebuild:

```bash
git fetch --tags origin
git switch --detach v0.1.0-local-platform
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml --profile ai up -d --build
```

Use detached tag checkout only for verification or emergency local recovery. Normal development continues from `main`.

## Immutable `docker.home.cz` Release

Production is released by an approved full Git SHA, not by refreshing the
mutable `/srv/akl/repo` checkout. Do not run `git pull`, `git checkout`, or
`git switch` there as part of deployment. The release workflow fetches a bare
mirror, verifies that the exact SHA is reachable from protected `origin/main`,
and extracts it read-only under `/srv/akl/releases/<full-sha>`.

After the first immutable release, deploy through the last verified release:

```bash
RELEASE_SHA=0123456789abcdef0123456789abcdef01234567
/srv/akl/current/scripts/deploy_docker_home_release.sh --sha "$RELEASE_SHA"
```

When `current` does not yet exist, never invoke the orchestrator from
`/srv/akl/repo`. Use an already reviewed read-only release to prepare the
target, then run the target's own
`scripts/bootstrap_docker_home_target.sh --sha <target-full-sha>`. The full
two-stage command and validation sequence is in the operations runbook.

When `current` exists but predates
`AKL_IMMUTABLE_ORCHESTRATOR_CONTRACT=2`, the first hardened release is also a
special one-time transition. Do not run the old current `prepare` or deploy
script. Prepare an exact approved target through a disposable checkout of that
same target, then execute only:

```bash
/srv/akl/releases/<target-full-sha>/scripts/bootstrap_docker_home_target.sh \
  --sha <target-full-sha> \
  --transition-existing-current
```

The target-side path proves the existing verified current, runtime marker,
trusted self-contained mirror and ancestry (no alternates, grafts, external
includes, or symlinked object/ref paths), recursively trusted read-only release trees,
unburned target and absent target tags. The target orchestrator repeats the
state-sensitive checks under the standard lock and skips prepare/fetch. After
contract 2 is active, the same target-side entry point remains available only
for a declared exact-next `AKL_IMMUTABLE_MANAGED_BOUNDARY_REVISION`. This is
the controlled path for adding a newly managed service to the immutable
boundary. Equal, skipped, duplicate, or decreasing revisions fail before image
build, writer stop, backup, or migration.
After contract 2 is current, use the ordinary current entry point for every
descendant. Exact commands and crash/forward-fix handling are in
`docs/OPERATIONS/immutable-docker-home-release.md`, section `One-Time Upgrade
From An Existing Immutable current`.

The persistent production environment remains
`/srv/akl/env/akl.prod.env`; each attempt copies it once into the private linked
snapshot described below. Every Compose operation receives that snapshot, the
Compose project, and the target release compose file explicitly. The managed
immutable set is Registry, Ingestion, RAG, Evaluation, Governance, web, and
standalone chat. Before the SHA burn/build
boundary the workflow requires the Registry proof-signing file and each
selected Ingestion/RAG/web confidential-client secret to be an absolute,
operator-owned, single-link regular file with exact mode `0600`. When Director
Copilot is enabled and either web profile changes, the same preflight applies
to its dedicated client-secret file. First rollout
selects all seven services. A Registry
change first quiesces the Registry writer and is then backed up and verified
before Alembic runs. PostgreSQL clients come only from the already-local exact
digest or image ID configured by `AKL_RELEASE_POSTGRES_TOOL_IMAGE`; no mutable
pull or host PostgreSQL client package is allowed. Three exact-container
`psql` connections must each prove `transaction_read_only=off` and
`pg_is_in_recovery()=false` plus the configured exact database and user before
build, three more repeat after build immediately before the writer-stop
boundary, and three more do so after backup immediately before migration. Any
gate fails closed on a read-only/recovery or wrong-identity HA connection. The
database URL may not contain query/fragment routing overrides. Writer
quiescence is private per-deployment evidence bound to the active lock and is
rechecked immediately before dump and migration. The
backup database, target image, and post-upgrade database must each resolve to
exactly one Alembic revision/head, with the post-upgrade revision equal to the
target. The release tree
and every backup artifact and directory are fsynced before their durable state boundary.
Before migration or runtime start, the workflow records
the target in `/srv/akl/state/applied-runtime.env`; every affected post-build
tag→image ID and exact SHA/project/service label are durably recorded and
rechecked before DB/runtime side effects, after recreation, and again after
smoke against the original durable IDs. Alembic and affected-service recreation
are executed with the durable IDs directly; the full-SHA tags remain separately
checked provenance and cannot retarget execution. Verified reconciliation loads those
IDs from the strict deployment record named by the marker instead of resolving
the tag as new evidence. Readiness, exact image ID/tag and Compose/release labels, and smoke must pass before
`/srv/akl/current` advances.

Run this from a clean shell and never source the production env file. Any
ambient variable colliding with an env-file key is rejected before the deploy
lock or runtime side effects. Any ambient variable interpolated by the exact
target Compose file is also rejected even when absent from the env file. The
same isolation applies during preparation and first-host bootstrap. Literal
production env values may not contain `$`; Git replace/config injection and
ambient Docker daemon routing are also rejected. Entry scripts disable xtrace
before reading secrets. One linked single-link mode-`0600` snapshot inside an
operator-owned mode-`0700` directory below `/srv/akl/env`, bound by root,
directory and file device/inode plus size/SHA-256, supplies every configuration
read for the attempt and is identity-checked and removed on normal exit. A stale
SIGKILL snapshot blocks the next release until the exact cleanup procedure in the
operations runbook is completed. PostgreSQL pgpass material follows the same
fail-closed model below `/srv/akl/state/postgres-credentials`: it is never
printed, and a SIGKILL remnant blocks deployment until the exact validated
cleanup command in the runbook is used. A change to the shared
production Compose file is accepted only when its top-level envelope and every
unmanaged service block are byte-identical and changes are confined to complete
Registry/Ingestion/RAG/web blocks. All other Compose changes fail before build.
The realm export and `infra/keycloak/update-stratos-public-routing.sh` are
non-runtime resources: immutable AKB deployment ignores them and their live
application and verification remain a separate Keycloak administration step.

A failed pre-stop writable-primary gate occurs before build and can retry the
same approved SHA. Immediately before build, a durable
`/srv/akl/state/burned-shas/<full-sha>` marker makes the SHA permanently
descendant-only; a pre-existing target tag does the same. The marker remains
authoritative even when build failed before tag creation or a tag disappeared.
Immutable tags are retained and a reviewed descendant is required even when no
migration ran. A crash after verified activation can retry the same SHA
only without forward-fix context: the workflow re-verifies and reconciles the
missing activation or success record without rebuilding or migrating.

Production rollback is forward-fix only. If an image or migration may have
been applied, ordinary deployment is blocked; prepare a reviewed descendant
of the exact applied-runtime SHA and use:

```bash
/srv/akl/current/scripts/rollback_docker_home_release.sh \
  --failed-sha 0123456789abcdef0123456789abcdef01234567 \
  --forward-fix-sha 89abcdef0123456789abcdef0123456789abcdef
```

The full host preparation, backup artifact, failure, and recovery procedure is
in `docs/OPERATIONS/immutable-docker-home-release.md`.
