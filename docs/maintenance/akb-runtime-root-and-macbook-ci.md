# AKB runtime root and MacBook CI preparation

## Release-root cutover

The active production release remains under `/srv/akl` until its successor has
completed the normal immutable release gates. The cutover is a new, separately
reviewed release candidate; it must not be appended to a candidate already in
CI.

1. Parameterise every release script, forced-command gateway, test fixture,
   deployment record and runbook with `AKB_RELEASE_ROOT`, defaulting to `/srv/akb` for the new root.
2. Add canonical `AKB_*` configuration names. A legacy `AKL_*` alias is accepted
   only when the canonical name is absent. Supplying both with different values
   fails before a Docker, database or object-store operation.
3. Build the exact production Dockerfiles locally with repository-root contexts,
   then run the targeted release-root transition fixture and all required CI.
4. On `docker.home.cz`, create `/srv/akb` with the documented ownership and
   private modes. Install the reviewed gateway from the exact merged release and
   prove its forced-command rejection before it receives a deployment key.
5. Promote the exact verified SHA into `/srv/akb`; verify SHA, image identity,
   health, readiness, governed ProjectFlow/ArchFlow intake, ClamAV, approval,
   indexing, Chat citation and access revocation.
6. Keep `/srv/akl/current` available only as a rollback source during the
   agreed window. Retire it after the cutover record, backups and restore test
   are independently accepted.

## MacBook high-throughput profile

Current Docker Desktop capacity is 16 CPUs and about 15.6 GiB memory. CPU is
already fully available; memory is the limiting setting for parallel isolated
builds. Set Docker Desktop Resources to 16 CPUs and at least 32 GiB memory, then
restart Docker Desktop while no CI job is running.

Run the local preflight from a clean candidate after caches have been warmed:

```bash
scripts/ci/local-fast-check.sh --base origin/main --full --jobs 6
scripts/ci/local-fast-check.sh --base origin/main --full --jobs 6 --skip-install
```

The first command builds or refreshes content-addressed native arm64 dependency
images. The second must run offline from those caches and is the timing evidence
for the 15-minute target. Use `--platform linux/amd64` only for the separate
production-architecture rehearsal.

Do not increase the trusted Gitea runner's capacity while it has a host Docker
socket and a shared writable cache. Instead, split the immutable release
contract into independent one-job workers and give each worker its own private
workspace. This preserves the trusted boundary and makes the MacBook's CPU
available to local feedback rather than competing final-release jobs.

Record the warm-run duration from `reports/local-fast-check/latest.json`.
If it exceeds 15 minutes, inspect the per-check durations and cache state before
changing concurrency; do not hide an I/O, network or emulation bottleneck by
merely adding workers.
