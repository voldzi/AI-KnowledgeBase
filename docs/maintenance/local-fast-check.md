# Local Fast Check

The local fast check catches ordinary AKB defects on a developer MacBook before
the final candidate is sent to trusted Gitea CI. It is a preliminary check, not
a release approval, and cannot build, approve, or deploy a production release.

## Boundary

The host needs only Git, Docker Desktop with BuildKit, Bash, Ruby, and its
standard Python interpreter. Application Python packages are never installed
into macOS Python. Every selected Python service uses a distinct Python 3.12
image whose complete test dependency set is pinned with package hashes. The web
uses the pinned Node image, exact pnpm archive checksum, and frozen lockfile.

Before an application test, the orchestrator copies only files returned by
`git ls-files --cached --others --exclude-standard` into a private temporary
snapshot. It rejects unsafe paths, symlinks, private-key filenames, `.npmrc`,
and every `.env` other than the committed examples. The complete sanitized
repository layout is mounted read-only so service tests keep their real path
relationships. Each test copies it into its own disposable tmpfs.

Application-test containers run as UID/GID 65532 with:

- no network;
- a read-only root filesystem;
- all Linux capabilities dropped and `no-new-privileges` enabled;
- no Docker socket, SSH directory, production configuration, tokens, or
  repository credentials;
- independent writable tmpfs workspaces and no shared virtual environment.

The dependency-build phase can contact only the public registries named in the
pinned Dockerfiles and lockfiles. Test execution itself is offline. Any absent
lock, unhashed dependency, unsafe source file, unavailable Docker boundary, or
failed check stops the run. The tool never runs Docker prune.

## Commands

Run the checks selected from all committed, staged, unstaged, and untracked
changes relative to current Gitea main:

```bash
scripts/ci/local-fast-check.sh --base origin/main
```

For a production-bound candidate, also bind lineage to the independently
verified full production SHA:

```bash
scripts/ci/local-fast-check.sh \
  --base origin/main \
  --production-sha <verified-full-production-sha>
```

Run the full local suite explicitly:

```bash
scripts/ci/local-fast-check.sh --base origin/main --full
```

After one successful run, prove that all dependency images are already local
and execute without dependency downloads:

```bash
scripts/ci/local-fast-check.sh --base origin/main --full --skip-install
```

`--skip-install` now means fail on any missing dependency image; it never falls
back to host package installation. Use `--platform linux/amd64` only when an
explicit production-architecture rehearsal is needed. Normal Apple Silicon
feedback uses native `linux/arm64`.

## Impact Matrix

The local check imports `scripts/ci/affected_components.py`, the same
classifier used by trusted Gitea CI. Documentation and local-CI-only changes
run repository standards. Repeated paths owned by one runtime component remain
narrow. More than one runtime owner, a runtime plus release infrastructure, a
shared contract, an unknown path, or an unavailable comparison base selects
the complete runtime, Compose, and immutable-release verification set.

Independent selected services run concurrently, but never share a writable
workspace or environment. The default concurrency is three to avoid exhausting
Docker Desktop memory. Override it with `--jobs` between 1 and 8.

## Cache And Evidence

Docker Desktop retains:

- one BuildKit pip cache scope per Python service and platform;
- one BuildKit pnpm store per platform;
- content-addressed local test images keyed by Dockerfile, lockfile, and
  platform;
- normal BuildKit layers.

These caches contain public dependencies and generated build layers only. They
must not contain `.env`, credentials, documents, uploads, prompts, answers, or
user data. Cache cleanup is manual and outside this tool. Less than 20 GiB free
produces a warning and less than 10 GiB a critical warning. A new image build
is blocked below 5 GiB; already cached offline checks remain available. No
threshold deletes anything.

Every successful run writes `reports/local-fast-check/latest.json`, validated
against `infra/ci/local-fast-check/local-fast-check-summary.schema.json`. The
closed summary contains the commit and base SHA, explicit working-tree dirty
state, impact profile, snapshot digest, platform, individual durations, total
duration, cache hit/miss state, and the mandatory
`trusted_gitea_ci_required=true`. It contains no environment values, paths,
source content, test output, credentials, or application data.

Record the first successful image-miss run as the cold dependency-image time
and the immediate `--skip-install` repetition as the warm time. The final exact
SHA must still pass trusted Gitea CI, same-SHA evidence, immutable image gate,
and the normal production promotion process.
